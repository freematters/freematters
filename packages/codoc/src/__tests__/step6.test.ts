import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeDiff } from "../diff.js";
import { FileWatcher } from "../file-watcher.js";
import { type SessionState, handlePostToolUse } from "../hooks/post-tool-use.js";
import { IpcClient, IpcServer } from "../ipc.js";
import { SessionTracker } from "../session-tracker.js";
import { TokenStore } from "../token-store.js";

function tmpPath(prefix: string): string {
  return path.join(os.tmpdir(), `codoc-step6-${prefix}-${process.pid}-${Date.now()}`);
}

describe("computeDiff", () => {
  it("should return empty string for identical content", () => {
    const result = computeDiff("hello\nworld\n", "hello\nworld\n");
    expect(result).toBe("");
  });

  it("should show added lines", () => {
    const result = computeDiff("line1\n", "line1\nline2\n");
    expect(result).toContain("+ line2");
  });

  it("should show removed lines", () => {
    const result = computeDiff("line1\nline2\n", "line1\n");
    expect(result).toContain("- line2");
  });

  it("should show both added and removed lines", () => {
    const result = computeDiff("aaa\nbbb\n", "aaa\nccc\n");
    expect(result).toContain("- bbb");
    expect(result).toContain("+ ccc");
  });

  it("should handle empty old content", () => {
    const result = computeDiff("", "new line\n");
    expect(result).toContain("+ new line");
  });

  it("should handle empty new content", () => {
    const result = computeDiff("old line\n", "");
    expect(result).toContain("- old line");
  });
});

describe("SessionTracker", () => {
  let tracker: SessionTracker;

  beforeEach(() => {
    tracker = new SessionTracker();
  });

  it("should report agent offline initially", () => {
    expect(tracker.isAgentOnline("some-token")).toBe(false);
  });

  it("should report agent online when poll is active", () => {
    tracker.recordPoll("token1");
    expect(tracker.isAgentOnline("token1")).toBe(true);
  });

  it("should report agent offline after poll removed", () => {
    tracker.recordPoll("token1");
    tracker.removePoll("token1");
    expect(tracker.isAgentOnline("token1")).toBe(false);
  });

  it("should report agent online when heartbeat is recent", () => {
    tracker.recordHeartbeat("session1");
    expect(tracker.isAgentOnline("any-token")).toBe(true);
  });

  it("should report agent offline when heartbeat is stale (>30s)", () => {
    tracker.recordHeartbeat("session1");
    // Manually set lastHeartbeat to 31 seconds ago
    (tracker as unknown as { heartbeats: Map<string, number> }).heartbeats.set(
      "session1",
      Date.now() - 31000,
    );
    expect(tracker.isAgentOnline("any-token")).toBe(false);
  });

  it("should report online without token param if any poll active", () => {
    tracker.recordPoll("token1");
    expect(tracker.isAgentOnline()).toBe(true);
  });

  it("should track multiple poll tokens independently", () => {
    tracker.recordPoll("token1");
    tracker.recordPoll("token2");
    tracker.removePoll("token1");
    expect(tracker.isAgentOnline("token1")).toBe(false);
    expect(tracker.isAgentOnline("token2")).toBe(true);
  });
});

describe("SessionState and PostToolUse hook", () => {
  let sessionsDir: string;
  let tokensPath: string;

  beforeEach(() => {
    sessionsDir = tmpPath("sessions");
    tokensPath = `${tmpPath("tokens")}.json`;
    fs.mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
  });

  it("should output nothing when no watched files exist", async () => {
    const sessionId = "test-session-1";
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    const state: SessionState = {
      watchedTokens: [],
      baselines: {},
      lastCheckAt: 0,
    };
    fs.writeFileSync(sessionFile, JSON.stringify(state));

    const result = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result).toBeNull();
  });

  it("should output nothing when rate limited (<10s since last check)", async () => {
    const sessionId = "test-session-2";
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    const testFile = `${tmpPath("watched")}.md`;
    fs.writeFileSync(testFile, "original content\n");

    const tokenStore = new TokenStore(tokensPath);
    const reg = tokenStore.register(testFile, false);

    const state: SessionState = {
      watchedTokens: [reg.token],
      baselines: {
        [reg.token]: {
          mtime: fs.statSync(testFile).mtimeMs,
          contentHash: "somehash",
          content: "original content\n",
        },
      },
      lastCheckAt: Date.now(),
    };
    fs.writeFileSync(sessionFile, JSON.stringify(state));

    const result = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result).toBeNull();

    try {
      fs.unlinkSync(testFile);
    } catch {}
  });

  it("should output nothing when watched file is unchanged", async () => {
    const sessionId = "test-session-3";
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    const testFile = `${tmpPath("watched")}.md`;
    fs.writeFileSync(testFile, "original content\n");

    const tokenStore = new TokenStore(tokensPath);
    const reg = tokenStore.register(testFile, false);

    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update("original content\n").digest("hex");

    const state: SessionState = {
      watchedTokens: [reg.token],
      baselines: {
        [reg.token]: {
          mtime: fs.statSync(testFile).mtimeMs,
          contentHash: hash,
          content: "original content\n",
        },
      },
      lastCheckAt: Date.now() - 15000,
    };
    fs.writeFileSync(sessionFile, JSON.stringify(state));

    const result = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result).toBeNull();

    try {
      fs.unlinkSync(testFile);
    } catch {}
  });

  it("should output additionalContext when watched file changed", async () => {
    const sessionId = "test-session-4";
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    const testFile = `${tmpPath("watched")}.md`;
    fs.writeFileSync(testFile, "original content\n");

    const tokenStore = new TokenStore(tokensPath);
    const reg = tokenStore.register(testFile, false);

    const crypto = await import("node:crypto");
    const hash = crypto.createHash("sha256").update("original content\n").digest("hex");

    const state: SessionState = {
      watchedTokens: [reg.token],
      baselines: {
        [reg.token]: {
          mtime: fs.statSync(testFile).mtimeMs - 5000,
          contentHash: hash,
          content: "original content\n",
        },
      },
      lastCheckAt: Date.now() - 15000,
    };
    fs.writeFileSync(sessionFile, JSON.stringify(state));

    // Modify the file
    fs.writeFileSync(testFile, "original content\nnew line added\n");

    const result = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result).not.toBeNull();
    expect(result?.hookSpecificOutput).toBeDefined();
    expect(result?.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(result?.hookSpecificOutput.additionalContext).toContain("new line added");

    try {
      fs.unlinkSync(testFile);
    } catch {}
  });

  it("should update session state after detecting change", async () => {
    const sessionId = "test-session-5";
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    const testFile = `${tmpPath("watched")}.md`;
    fs.writeFileSync(testFile, "original\n");

    const tokenStore = new TokenStore(tokensPath);
    const reg = tokenStore.register(testFile, false);

    const crypto = await import("node:crypto");
    const oldHash = crypto.createHash("sha256").update("old content\n").digest("hex");

    const state: SessionState = {
      watchedTokens: [reg.token],
      baselines: {
        [reg.token]: {
          mtime: 0,
          contentHash: oldHash,
          content: "old content\n",
        },
      },
      lastCheckAt: Date.now() - 15000,
    };
    fs.writeFileSync(sessionFile, JSON.stringify(state));

    await handlePostToolUse(sessionId, sessionsDir, tokensPath);

    const updatedState: SessionState = JSON.parse(
      fs.readFileSync(sessionFile, "utf-8"),
    );
    expect(updatedState.lastCheckAt).toBeGreaterThan(state.lastCheckAt);

    const newHash = crypto.createHash("sha256").update("original\n").digest("hex");
    expect(updatedState.baselines[reg.token].contentHash).toBe(newHash);

    try {
      fs.unlinkSync(testFile);
    } catch {}
  });
});

describe("IPC poll method", () => {
  let ipcServer: IpcServer;
  let tokenStore: TokenStore;
  let fileWatcher: FileWatcher;
  let sessionTracker: SessionTracker;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    socketPath = `${tmpPath("poll")}.sock`;
    tokensPath = `${tmpPath("tokens")}.json`;
    testFilePath = `${tmpPath("pollfile")}.md`;
    fs.writeFileSync(testFilePath, "initial content\n");

    tokenStore = new TokenStore(tokensPath);
    fileWatcher = new FileWatcher();
    sessionTracker = new SessionTracker();

    ipcServer = new IpcServer(socketPath, tokenStore, 3000);
    ipcServer.setFileWatcher(fileWatcher);
    ipcServer.setSessionTracker(sessionTracker);
    await ipcServer.start();
  });

  afterEach(async () => {
    await fileWatcher.close();
    await ipcServer.stop();
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should return error for unknown token", async () => {
    const client = new IpcClient(socketPath);
    const response = await client.send({
      method: "poll",
      params: { token: "nonexistent" },
    });
    expect(response.ok).toBe(false);
    expect(response.error).toContain("not found");
  });

  it("should block and return diff when file changes", async () => {
    const reg = tokenStore.register(testFilePath, false);
    fileWatcher.watch(testFilePath, () => {});

    const client = new IpcClient(socketPath);
    // Remove timeout for poll (set high timeout)
    const pollPromise = new Promise<{ ok: boolean; data?: unknown; error?: string }>(
      (resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.write(
            `${JSON.stringify({ method: "poll", params: { token: reg.token } })}\n`,
          );
        });
        let buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.trim().length === 0) continue;
            try {
              const resp = JSON.parse(line);
              socket.end();
              resolve(resp);
            } catch (err: unknown) {
              socket.end();
              reject(err);
            }
            return;
          }
        });
        socket.on("error", reject);
        socket.setTimeout(10000, () => {
          socket.destroy();
          reject(new Error("poll timed out"));
        });
      },
    );

    // Wait a bit then modify file
    setTimeout(() => {
      fs.writeFileSync(testFilePath, "initial content\nmodified line\n");
    }, 500);

    const response = await pollPromise;
    expect(response.ok).toBe(true);
    const data = response.data as { diff: string; newComments: unknown[] };
    expect(data.diff).toContain("modified line");
  });

  it("should record poll in session tracker", async () => {
    const reg = tokenStore.register(testFilePath, false);
    fileWatcher.watch(testFilePath, () => {});

    const socket = net.createConnection(socketPath, () => {
      socket.write(
        `${JSON.stringify({ method: "poll", params: { token: reg.token } })}\n`,
      );
    });

    // Wait for the poll to register
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sessionTracker.isAgentOnline(reg.token)).toBe(true);

    // Trigger file change to end poll
    fs.writeFileSync(testFilePath, "changed\n");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    socket.destroy();
  });

  it("should handle heartbeat method", async () => {
    const client = new IpcClient(socketPath);
    const response = await client.send({
      method: "heartbeat",
      params: { sessionId: "sess1" },
    });
    expect(response.ok).toBe(true);
    expect(sessionTracker.isAgentOnline()).toBe(true);
  });
});
