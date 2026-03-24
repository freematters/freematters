import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type ServerHandle, startServer } from "../commands/server.js";
import { runStop } from "../commands/stop.js";
import { type SessionState, handlePostToolUse } from "../hooks/post-tool-use.js";
import { IpcClient } from "../ipc.js";
import { TokenStore } from "../token-store.js";

function uniquePath(prefix: string, ext: string): string {
  return path.join(
    os.tmpdir(),
    `codoc-e2e-${prefix}-${process.pid}-${Date.now()}${ext}`,
  );
}

function httpGet(
  port: number,
  urlPath: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode!, body });
        });
      })
      .on("error", reject);
  });
}

function httpPost(
  port: number,
  urlPath: string,
  data: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:${port}${urlPath}`,
      { method: "POST", headers: { "Content-Type": "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode!, body });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on("open", () => {
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

function waitForMessage(
  ws: WebSocket,
  timeoutMs: number,
): Promise<{ type: string; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for WS message"));
    }, timeoutMs);
    ws.once("message", (data: WebSocket.Data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function ipcPoll(
  socketPath: string,
  token: string,
  timeoutMs: number,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      socket.write(`${JSON.stringify({ method: "poll", params: { token } })}\n`);
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
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("poll timed out"));
    });
  });
}

// ============================================================
// Scenario 1: Server Lifecycle
// ============================================================
describe("E2E Scenario 1: Server Lifecycle", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;

  beforeEach(() => {
    socketPath = uniquePath("s1-sock", ".sock");
    tokensPath = uniquePath("s1-tokens", ".json");
    handle = null;
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
  });

  it("should start server, bind socket, detect already-running, stop and cleanup", async () => {
    // 1. Start server
    handle = await startServer({ port: 0, socketPath, tokensPath });
    expect(handle.port).toBeGreaterThan(0);

    // 2. Socket exists
    expect(fs.existsSync(socketPath)).toBe(true);

    // 3. HTTP /api/status responds (use a GET on a known 404 path to confirm server is up)
    const statusRes = await httpGet(handle.port, "/api/file/nonexistent");
    expect(statusRes.statusCode).toBe(404);

    // 4. Second server instance refused
    await expect(startServer({ port: 0, socketPath, tokensPath })).rejects.toThrow(
      /already running/i,
    );

    // 5. Stop server via IPC
    const stopResult = await runStop(socketPath, true, "test");
    expect(stopResult.ok).toBe(true);
    expect(stopResult.message).toMatch(/stopped/i);
    handle = null;

    // 6. Socket cleaned up
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

// ============================================================
// Scenario 2: Share + Poll flow
// ============================================================
describe("E2E Scenario 2: Share + Poll flow", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(() => {
    socketPath = uniquePath("s2-sock", ".sock");
    tokensPath = uniquePath("s2-tokens", ".json");
    testFilePath = uniquePath("s2-file", ".md");
    handle = null;
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should share file, poll blocks, file modification triggers poll with diff", async () => {
    fs.writeFileSync(testFilePath, "# Test\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });

    // Share file via IPC
    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    expect(shareRes.ok).toBe(true);
    const shareData = shareRes.data as { token: string; url: string };
    expect(shareData.url).toContain(`/edit/${shareData.token}`);
    expect(shareData.url).toContain(`${handle.port}`);

    // Start poll (blocks until file changes)
    const pollPromise = ipcPoll(socketPath, shareData.token, 10000);

    // Wait for poll to register, then modify file
    await new Promise((resolve) => setTimeout(resolve, 500));
    fs.writeFileSync(testFilePath, "# Test\n## Changed\n");

    const pollRes = await pollPromise;
    expect(pollRes.ok).toBe(true);
    const pollData = pollRes.data as { diff: string; newComments: unknown[] };
    expect(pollData.diff).toContain("Changed");
  });
});

// ============================================================
// Scenario 3: HTTP API Routes
// ============================================================
describe("E2E Scenario 3: HTTP API Routes", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("s3-sock", ".sock");
    tokensPath = uniquePath("s3-tokens", ".json");
    testFilePath = uniquePath("s3-file", ".md");
    fs.writeFileSync(testFilePath, "# API Test\n\nOriginal content.\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;

    // Wait for git init to complete
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("GET /api/file/:token should return file content", async () => {
    const res = await httpGet(handle?.port, `/api/file/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.content).toContain("# API Test");
    expect(data.fileName).toBe(path.basename(testFilePath));
    expect(data.readonly).toBe(false);
  });

  it("POST /api/file/:token should save content and update file on disk", async () => {
    const newContent = "# API Test\n\nUpdated content.\n";
    const res = await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: newContent }),
    );
    expect(res.statusCode).toBe(200);
    const disk = fs.readFileSync(testFilePath, "utf-8");
    expect(disk).toBe(newContent);
  });

  it("GET /api/blame/:token should return blame data", async () => {
    const res = await httpGet(handle?.port, `/api/blame/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
  });

  it("GET /api/history/:token should return at least 1 version", async () => {
    const res = await httpGet(handle?.port, `/api/history/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/diff/:token should return diff content", async () => {
    const res = await httpGet(handle?.port, `/api/diff/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(typeof data.diff).toBe("string");
  });

  it("GET /api/status/:token should return agent online status", async () => {
    const res = await httpGet(handle?.port, `/api/status/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.agentOnline).toBe(false);
  });

  it("GET /edit/:token should serve SPA HTML", async () => {
    const res = await httpGet(handle?.port, `/edit/${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<html");
  });

  it("should return 404 for unknown tokens on all routes", async () => {
    const fakeToken = "nonexistent-token-xyz";
    const routes = [
      `/api/file/${fakeToken}`,
      `/api/blame/${fakeToken}`,
      `/api/history/${fakeToken}`,
      `/api/diff/${fakeToken}`,
      `/api/status/${fakeToken}`,
      `/edit/${fakeToken}`,
    ];
    for (const route of routes) {
      const res = await httpGet(handle?.port, route);
      expect(res.statusCode).toBe(404);
    }
  });
});

// ============================================================
// Scenario 4: Comment Protocol
// ============================================================
describe("E2E Scenario 4: Comment Protocol", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("s4-sock", ".sock");
    tokensPath = uniquePath("s4-tokens", ".json");
    testFilePath = uniquePath("s4-file", ".md");

    const commentContent = [
      "# Title",
      "Some content",
      "<!--",
      "@human[tid:t1][cid:c1]: Is this right?",
      "[REPLY_TEMPLATE] @agent[tid:t1][cid:NEW_ID][reply:c1]: reply here",
      "-->",
      "More content",
      "<!--",
      "@human[cid:c2]: standalone note",
      "-->",
      "",
    ].join("\n");

    fs.writeFileSync(testFilePath, commentContent);
    handle = await startServer({ port: 0, socketPath, tokensPath });

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should return all comments in file content via GET", async () => {
    const res = await httpGet(handle?.port, `/api/file/${token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.content).toContain("@human[tid:t1][cid:c1]: Is this right?");
    expect(data.content).toContain("[REPLY_TEMPLATE]");
    expect(data.content).toContain("@human[cid:c2]: standalone note");
  });

  it("should save reply replacing REPLY_TEMPLATE and persist", async () => {
    const res = await httpGet(handle?.port, `/api/file/${token}`);
    const originalContent = JSON.parse(res.body).content as string;

    // Replace the REPLY_TEMPLATE line with actual agent reply
    const updatedContent = originalContent.replace(
      "[REPLY_TEMPLATE] @agent[tid:t1][cid:NEW_ID][reply:c1]: reply here",
      "@agent[tid:t1][cid:c3][reply:c1]: Yes it is correct.",
    );

    const saveRes = await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: updatedContent }),
    );
    expect(saveRes.statusCode).toBe(200);

    // Verify persisted content
    const verifyRes = await httpGet(handle?.port, `/api/file/${token}`);
    const verifyData = JSON.parse(verifyRes.body);
    expect(verifyData.content).toContain(
      "@agent[tid:t1][cid:c3][reply:c1]: Yes it is correct.",
    );
    expect(verifyData.content).not.toContain("[REPLY_TEMPLATE]");
  });
});

// ============================================================
// Scenario 5: Readonly Token
// ============================================================
describe("E2E Scenario 5: Readonly Token", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    socketPath = uniquePath("s5-sock", ".sock");
    tokensPath = uniquePath("s5-tokens", ".json");
    testFilePath = uniquePath("s5-file", ".md");
    fs.writeFileSync(testFilePath, "# Readonly Test\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should generate writable and readonly tokens, readonly blocks writes with 403", async () => {
    // Share with readonly=true to generate both tokens
    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath, readonly: true },
    });
    expect(shareRes.ok).toBe(true);
    const shareData = shareRes.data as {
      token: string;
      url: string;
      readonlyToken: string;
      readonlyUrl: string;
    };
    expect(shareData.readonlyToken).toBeTruthy();
    expect(shareData.readonlyUrl).toContain("/view/");

    // GET readonly token: should include readonly=true
    const readonlyGetRes = await httpGet(
      handle?.port,
      `/api/file/${shareData.readonlyToken}`,
    );
    expect(readonlyGetRes.statusCode).toBe(200);
    const readonlyData = JSON.parse(readonlyGetRes.body);
    expect(readonlyData.readonly).toBe(true);
    expect(readonlyData.content).toContain("# Readonly Test");

    // POST to readonly token: should return 403
    const writeRes = await httpPost(
      handle?.port,
      `/api/file/${shareData.readonlyToken}`,
      JSON.stringify({ content: "hack attempt" }),
    );
    expect(writeRes.statusCode).toBe(403);

    // Verify original content unchanged
    const disk = fs.readFileSync(testFilePath, "utf-8");
    expect(disk).toBe("# Readonly Test\n");

    // GET writable token: should include readonly=false
    const writableGetRes = await httpGet(handle?.port, `/api/file/${shareData.token}`);
    expect(writableGetRes.statusCode).toBe(200);
    const writableData = JSON.parse(writableGetRes.body);
    expect(writableData.readonly).toBe(false);
  });
});

// ============================================================
// Scenario 6: WebSocket Sync
// ============================================================
describe("E2E Scenario 6: WebSocket Sync", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("s6-sock", ".sock");
    tokensPath = uniquePath("s6-tokens", ".json");
    testFilePath = uniquePath("s6-file", ".md");
    fs.writeFileSync(testFilePath, "# WS Sync Test\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;
    await new Promise((resolve) => setTimeout(resolve, 300));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should connect, subscribe, and receive file:content", async () => {
    const ws = await connectWs(handle?.port);
    const msgPromise = waitForMessage(ws, 5000);
    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token } }));

    const msg = await msgPromise;
    expect(msg.type).toBe("file:content");
    const payload = msg.payload as { content: string; version: number };
    expect(payload.content).toContain("# WS Sync Test");
    expect(typeof payload.version).toBe("number");

    ws.close();
  });

  it("should receive file:saved event when file is saved via HTTP POST", async () => {
    const ws = await connectWs(handle?.port);

    // Subscribe
    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token } }));
    await waitForMessage(ws, 5000); // consume file:content

    // Listen for saved event
    const savedPromise = waitForMessage(ws, 5000);

    // Save via HTTP
    await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "# WS Sync Test\nSaved via HTTP\n" }),
    );

    const savedMsg = await savedPromise;
    expect(savedMsg.type).toBe("file:saved");

    ws.close();
  });

  it("should receive file:changed event when file is modified externally", async () => {
    const ws = await connectWs(handle?.port);

    // Subscribe
    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token } }));
    await waitForMessage(ws, 5000); // consume file:content

    const changedPromise = waitForMessage(ws, 5000);

    // Modify file externally
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(testFilePath, "# WS Sync Test\nExternal change\n");

    const changedMsg = await changedPromise;
    expect(changedMsg.type).toBe("file:changed");
    const payload = changedMsg.payload as {
      diff: string;
      newComments: unknown[];
      version: number;
    };
    expect(payload.diff).toContain("External change");

    ws.close();
  });
});

// ============================================================
// Scenario 7: PostToolUse Hook
// ============================================================
describe("E2E Scenario 7: PostToolUse Hook", () => {
  let sessionsDir: string;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(() => {
    sessionsDir = uniquePath("s7-sessions", "");
    tokensPath = uniquePath("s7-tokens", ".json");
    testFilePath = uniquePath("s7-file", ".md");
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(testFilePath, "baseline content\n");
  });

  afterEach(() => {
    fs.rmSync(sessionsDir, { recursive: true, force: true });
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should establish baseline (no output), detect change (output additionalContext), then rate limit", async () => {
    const sessionId = "e2e-hook-session";
    const tokenStore = new TokenStore(tokensPath);
    const reg = tokenStore.register(testFilePath, false);

    const baseHash = crypto
      .createHash("sha256")
      .update("baseline content\n")
      .digest("hex");

    // Create initial session state with baselines
    const initialState: SessionState = {
      watchedTokens: [reg.token],
      baselines: {
        [reg.token]: {
          mtime: fs.statSync(testFilePath).mtimeMs,
          contentHash: baseHash,
          content: "baseline content\n",
        },
      },
      lastCheckAt: Date.now() - 15000,
    };
    const sessionFile = path.join(sessionsDir, `${sessionId}.json`);
    fs.writeFileSync(sessionFile, JSON.stringify(initialState));

    // First call: file unchanged => no output
    const result1 = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result1).toBeNull();

    // Modify file
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.writeFileSync(testFilePath, "baseline content\nnew line from human\n");

    // Update lastCheckAt to allow next check (>10s ago)
    const state2: SessionState = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
    state2.lastCheckAt = Date.now() - 15000;
    fs.writeFileSync(sessionFile, JSON.stringify(state2));

    // Second call: file changed => should output additionalContext
    const result2 = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result2).not.toBeNull();
    expect(result2?.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(result2?.hookSpecificOutput.additionalContext).toContain(
      "new line from human",
    );

    // Third call immediately: should be rate limited (lastCheckAt was just set)
    const result3 = await handlePostToolUse(sessionId, sessionsDir, tokensPath);
    expect(result3).toBeNull();
  });
});

// ============================================================
// Scenario 10: Git History + Revert
// ============================================================
describe("E2E Scenario 10: Git History + Revert", () => {
  let handle: ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;
  let token: string;

  beforeEach(async () => {
    socketPath = uniquePath("s10-sock", ".sock");
    tokensPath = uniquePath("s10-tokens", ".json");
    testFilePath = uniquePath("s10-file", ".md");
    fs.writeFileSync(testFilePath, "initial\n");
    handle = await startServer({ port: 0, socketPath, tokensPath });

    const client = new IpcClient(socketPath);
    const shareRes = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    token = (shareRes.data as { token: string }).token;

    // Wait for git init + initial commit
    await new Promise((resolve) => setTimeout(resolve, 800));
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should save multiple versions, list history, and revert to old version", async () => {
    // Save version 1
    const save1 = await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "version 1\n", author: "tester" }),
    );
    expect(save1.statusCode).toBe(200);

    // Save version 2
    const save2 = await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "version 2\n", author: "tester" }),
    );
    expect(save2.statusCode).toBe(200);

    // Save version 3
    const save3 = await httpPost(
      handle?.port,
      `/api/file/${token}`,
      JSON.stringify({ content: "version 3\n", author: "tester" }),
    );
    expect(save3.statusCode).toBe(200);

    // GET /api/history/:token => should have initial commit + 3 saves = 4 entries
    const histRes = await httpGet(handle?.port, `/api/history/${token}`);
    expect(histRes.statusCode).toBe(200);
    const history = JSON.parse(histRes.body) as Array<{
      hash: string;
      message: string;
      author: string;
      date: string;
    }>;
    expect(history.length).toBeGreaterThanOrEqual(4);

    // Find the commit for "version 1" — history is reverse chronological,
    // so "version 1" save should be near the end (before initial)
    // Let's get the content at each hash to find "version 1"
    let version1Hash: string | null = null;
    for (const entry of history) {
      const contentRes = await httpGet(
        handle?.port,
        `/api/history/${token}/${entry.hash}`,
      );
      if (contentRes.statusCode === 200) {
        const contentData = JSON.parse(contentRes.body);
        if (contentData.content === "version 1\n") {
          version1Hash = entry.hash;
          break;
        }
      }
    }
    expect(version1Hash).not.toBeNull();

    // Revert to version 1
    const revertRes = await httpPost(
      handle?.port,
      `/api/revert/${token}/${version1Hash}`,
      "{}",
    );
    expect(revertRes.statusCode).toBe(200);

    // Verify content is now "version 1"
    const fileRes = await httpGet(handle?.port, `/api/file/${token}`);
    expect(fileRes.statusCode).toBe(200);
    const fileData = JSON.parse(fileRes.body);
    expect(fileData.content).toBe("version 1\n");

    // History should have grown (revert creates a new commit)
    const histRes2 = await httpGet(handle?.port, `/api/history/${token}`);
    const history2 = JSON.parse(histRes2.body) as Array<{ hash: string }>;
    expect(history2.length).toBe(history.length + 1);
  });
});
