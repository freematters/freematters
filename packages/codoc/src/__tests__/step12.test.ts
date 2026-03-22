import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function getSocketPath(): string {
  return path.join(os.tmpdir(), `codoc-step12-${process.pid}-${Date.now()}.sock`);
}

function getTokensPath(): string {
  return path.join(
    os.tmpdir(),
    `codoc-step12-tokens-${process.pid}-${Date.now()}.json`,
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

describe("hooks.json format", () => {
  it("should contain SessionStart hook with 'codoc server' command", () => {
    const hooksPath = path.join(projectRoot, "hooks/hooks.json");
    const content = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    expect(content.hooks.SessionStart).toBeInstanceOf(Array);
    expect(content.hooks.SessionStart.length).toBeGreaterThan(0);
    const hook = content.hooks.SessionStart[0];
    expect(hook.hooks).toBeInstanceOf(Array);
    expect(hook.hooks[0].type).toBe("command");
    expect(hook.hooks[0].command).toMatch(/server$/);
    expect(hook.hooks[0].timeout).toBe(30);
  });

  it("should contain SessionEnd hook with 'codoc stop' command", () => {
    const hooksPath = path.join(projectRoot, "hooks/hooks.json");
    const content = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    expect(content.hooks.SessionEnd).toBeInstanceOf(Array);
    expect(content.hooks.SessionEnd.length).toBeGreaterThan(0);
    const hook = content.hooks.SessionEnd[0];
    expect(hook.hooks).toBeInstanceOf(Array);
    expect(hook.hooks[0].type).toBe("command");
    expect(hook.hooks[0].command).toMatch(/stop$/);
    expect(hook.hooks[0].timeout).toBe(10);
  });

  it("should contain PostToolUse hook with 'codoc _hook post-tool-use' command", () => {
    const hooksPath = path.join(projectRoot, "hooks/hooks.json");
    const content = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    expect(content.hooks.PostToolUse).toBeInstanceOf(Array);
    expect(content.hooks.PostToolUse.length).toBeGreaterThan(0);
    const hook = content.hooks.PostToolUse[0];
    expect(hook.matcher).toBe("");
    expect(hook.hooks).toBeInstanceOf(Array);
    expect(hook.hooks[0].type).toBe("command");
    expect(hook.hooks[0].command).toMatch(/_hook post-tool-use$/);
    expect(hook.hooks[0].timeout).toBe(10);
  });
});

describe("Server idempotency", () => {
  let handle1: import("../commands/server.js").ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;

  afterEach(async () => {
    if (handle1) {
      await handle1.shutdown();
      handle1 = null;
    }
  });

  it("should exit gracefully when server is already running (exit code 0 behavior)", async () => {
    const { startServer } = await import("../commands/server.js");
    socketPath = getSocketPath();
    tokensPath = getTokensPath();
    handle1 = await startServer({ port: 0, socketPath, tokensPath });

    await expect(startServer({ port: 0, socketPath, tokensPath })).rejects.toThrow(
      /already running/i,
    );
  });

  it("should remove stale socket and start fresh", async () => {
    const { startServer } = await import("../commands/server.js");
    socketPath = getSocketPath();
    tokensPath = getTokensPath();
    fs.writeFileSync(socketPath, "stale");
    handle1 = await startServer({ port: 0, socketPath, tokensPath });
    expect(handle1.port).toBeGreaterThan(0);
    expect(fs.existsSync(socketPath)).toBe(true);
  });
});

describe("Stop graceful handling", () => {
  it("should exit gracefully when server is not running (no error)", async () => {
    const { runStop } = await import("../commands/stop.js");
    const socketPath = getSocketPath();
    const result = await runStop(socketPath, true, "test");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/not running/i);
  });

  it("should exit gracefully when socket file does not exist", async () => {
    const { runStop } = await import("../commands/stop.js");
    const socketPath = "/tmp/nonexistent-codoc-step12.sock";
    const result = await runStop(socketPath, true, "test");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/not running/i);
  });

  it("should stop a running server successfully", async () => {
    const { startServer } = await import("../commands/server.js");
    const { runStop } = await import("../commands/stop.js");
    const socketPath = getSocketPath();
    const tokensPath = getTokensPath();
    const handle = await startServer({ port: 0, socketPath, tokensPath });

    const result = await runStop(socketPath, true, "test");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/stopped/i);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

describe("Full integration: all CLI commands and API routes", () => {
  let handle: import("../commands/server.js").ServerHandle | null = null;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
      handle = null;
    }
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should support full lifecycle: start → share → API routes → stop", async () => {
    const { startServer } = await import("../commands/server.js");
    const { IpcClient } = await import("../ipc.js");
    const { runStop } = await import("../commands/stop.js");

    socketPath = getSocketPath();
    tokensPath = getTokensPath();
    testFilePath = path.join(
      os.tmpdir(),
      `codoc-step12-integration-${process.pid}-${Date.now()}.md`,
    );
    fs.writeFileSync(testFilePath, "# Integration Test\n\nHello world.\n");

    // 1. Start server
    handle = await startServer({ port: 0, socketPath, tokensPath });
    expect(handle.port).toBeGreaterThan(0);
    expect(fs.existsSync(socketPath)).toBe(true);

    // 2. Share file via IPC
    const client = new IpcClient(socketPath);
    const shareResponse = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    expect(shareResponse.ok).toBe(true);
    const shareData = shareResponse.data as { token: string; url: string };
    expect(shareData.token).toBeTruthy();
    expect(shareData.url).toContain(`/edit/${shareData.token}`);
    const token = shareData.token;

    // 3. GET /edit/:token - serves SPA
    const editRes = await httpGet(handle.port, `/edit/${token}`);
    expect(editRes.statusCode).toBe(200);
    expect(editRes.body).toContain("<html");

    // 4. GET /api/file/:token - returns file content
    const fileRes = await httpGet(handle.port, `/api/file/${token}`);
    expect(fileRes.statusCode).toBe(200);
    const fileData = JSON.parse(fileRes.body);
    expect(fileData.content).toContain("# Integration Test");
    expect(fileData.readonly).toBe(false);

    // 5. POST /api/file/:token - saves content
    const newContent = "# Integration Test\n\nUpdated content.\n";
    const saveRes = await httpPost(
      handle.port,
      `/api/file/${token}`,
      JSON.stringify({ content: newContent }),
    );
    expect(saveRes.statusCode).toBe(200);
    const savedContent = fs.readFileSync(testFilePath, "utf-8");
    expect(savedContent).toBe(newContent);

    // 6. GET /api/status/:token - returns agent online status
    const statusRes = await httpGet(handle.port, `/api/status/${token}`);
    expect(statusRes.statusCode).toBe(200);
    const statusData = JSON.parse(statusRes.body);
    expect(statusData.agentOnline).toBe(false);

    // 7. IPC status
    const client2 = new IpcClient(socketPath);
    const statusIpcRes = await client2.send({ method: "status", params: {} });
    expect(statusIpcRes.ok).toBe(true);

    // 8. Stop via runStop
    const stopResult = await runStop(socketPath, true, "test");
    expect(stopResult.ok).toBe(true);
    handle = null;

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

describe("npm pack includes correct files", () => {
  it("should include dist/, hooks/, .claude-plugin/, skills/ in package.json files", () => {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.files).toContain("dist/");
    expect(pkg.files).toContain("hooks/");
    expect(pkg.files).toContain(".claude-plugin/");
    expect(pkg.files).toContain("skills/");
  });

  it("should have bin field pointing to dist/cli.js", () => {
    const pkgPath = path.join(projectRoot, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    expect(pkg.bin.codoc).toBe("dist/cli.js");
  });
});
