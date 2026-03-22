import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { type ServerHandle, startServer } from "../commands/server.js";
import { createHttpHandler } from "../http.js";
import { IpcClient, IpcServer } from "../ipc.js";
import { TokenStore } from "../token-store.js";

function getSocketPath(): string {
  return path.join(os.tmpdir(), `codoc-test-${process.pid}-${Date.now()}.sock`);
}

function getTokensPath(): string {
  return path.join(os.tmpdir(), `codoc-test-tokens-${process.pid}-${Date.now()}.json`);
}

function httpGet(
  port: number,
  urlPath: string,
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode!, body, headers: res.headers });
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

describe("TokenStore", () => {
  let store: TokenStore;
  let tokensPath: string;

  beforeEach(() => {
    tokensPath = getTokensPath();
    store = new TokenStore(tokensPath);
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
  });

  it("should register a file and return a token", () => {
    const result = store.register("/tmp/test.md", false);
    expect(result.token).toBeTruthy();
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
  });

  it("should resolve a token to its file path", () => {
    const result = store.register("/tmp/test.md", false);
    const entry = store.resolve(result.token);
    expect(entry).not.toBeNull();
    expect(entry?.filePath).toBe("/tmp/test.md");
    expect(entry?.readonly).toBe(false);
  });

  it("should return null for unknown token", () => {
    const entry = store.resolve("nonexistent");
    expect(entry).toBeNull();
  });

  it("should list all registered tokens", () => {
    store.register("/tmp/a.md", false);
    store.register("/tmp/b.md", false);
    const list = store.list();
    expect(list.length).toBe(2);
  });

  it("should revoke a token", () => {
    const result = store.register("/tmp/test.md", false);
    store.revoke(result.token);
    expect(store.resolve(result.token)).toBeNull();
  });

  it("should persist tokens to disk and reload", () => {
    const result = store.register("/tmp/test.md", false);
    const store2 = new TokenStore(tokensPath);
    const entry = store2.resolve(result.token);
    expect(entry).not.toBeNull();
    expect(entry?.filePath).toBe("/tmp/test.md");
  });

  it("should return same token for same file path", () => {
    const r1 = store.register("/tmp/test.md", false);
    const r2 = store.register("/tmp/test.md", false);
    expect(r1.token).toBe(r2.token);
  });
});

describe("HTTP Server", () => {
  let tokenStore: TokenStore;
  let server: http.Server;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;

  beforeAll(async () => {
    tokensPath = getTokensPath();
    tokenStore = new TokenStore(tokensPath);
    testFilePath = path.join(os.tmpdir(), `codoc-test-file-${process.pid}.md`);
    fs.writeFileSync(testFilePath, "# Hello World\n\nThis is test content.\n");

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    server = http.createServer(handler);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const addr = server.address() as net.AddressInfo;
    port = addr.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("GET /edit/:token should return HTML", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const res = await httpGet(port, `/edit/${reg.token}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<html");
  });

  it("GET /edit/:token should return 404 for unknown token", async () => {
    const res = await httpGet(port, "/edit/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/file/:token should return file content", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const res = await httpGet(port, `/api/file/${reg.token}`);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.content).toContain("# Hello World");
    expect(data.filePath).toBe(testFilePath);
  });

  it("GET /api/file/:token should return 404 for unknown token", async () => {
    const res = await httpGet(port, "/api/file/nonexistent");
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/file/:token should save file content", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const newContent = "# Updated Content\n\nChanged.\n";
    const res = await httpPost(
      port,
      `/api/file/${reg.token}`,
      JSON.stringify({ content: newContent }),
    );
    expect(res.statusCode).toBe(200);
    const saved = fs.readFileSync(testFilePath, "utf-8");
    expect(saved).toBe(newContent);
    // Restore original
    fs.writeFileSync(testFilePath, "# Hello World\n\nThis is test content.\n");
  });

  it("POST /api/file/:token should return 404 for unknown token", async () => {
    const res = await httpPost(
      port,
      "/api/file/nonexistent",
      JSON.stringify({ content: "x" }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("GET /static/* should serve static files or 404", async () => {
    const res = await httpGet(port, "/static/nonexistent.js");
    expect(res.statusCode).toBe(404);
  });
});

describe("IPC Server and Client", () => {
  let ipcServer: IpcServer;
  let tokenStore: TokenStore;
  let socketPath: string;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    socketPath = getSocketPath();
    tokensPath = getTokensPath();
    tokenStore = new TokenStore(tokensPath);
    testFilePath = path.join(os.tmpdir(), `codoc-ipc-test-${process.pid}.md`);
    fs.writeFileSync(testFilePath, "# IPC Test\n");
    ipcServer = new IpcServer(socketPath, tokenStore, 3000);
    await ipcServer.start();
  });

  afterEach(async () => {
    await ipcServer.stop();
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should bind Unix socket", () => {
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it("should handle share request and return URL", async () => {
    const client = new IpcClient(socketPath);
    const response = await client.send({
      method: "share",
      params: { filePath: testFilePath },
    });
    expect(response.ok).toBe(true);
    expect(response.data).toBeDefined();
    const data = response.data as { token: string; url: string };
    expect(data.token).toBeTruthy();
    expect(data.url).toContain("/edit/");
    expect(data.url).toContain("3000");
  });

  it("should handle status request", async () => {
    const client = new IpcClient(socketPath);
    const response = await client.send({ method: "status", params: {} });
    expect(response.ok).toBe(true);
  });

  it("should handle stop request", async () => {
    const client = new IpcClient(socketPath);
    const response = await client.send({ method: "stop", params: {} });
    expect(response.ok).toBe(true);
  });
});

describe("Server lifecycle (startServer)", () => {
  let handle: ServerHandle | null;
  let socketPath: string;
  let tokensPath: string;

  beforeEach(() => {
    socketPath = getSocketPath();
    tokensPath = getTokensPath();
    handle = null;
  });

  afterEach(async () => {
    if (handle) {
      await handle.shutdown();
    }
    try {
      fs.unlinkSync(socketPath);
    } catch {}
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
  });

  it("should bind HTTP port and Unix socket", async () => {
    handle = await startServer({ port: 0, socketPath, tokensPath });
    expect(handle.port).toBeGreaterThan(0);
    expect(fs.existsSync(socketPath)).toBe(true);
  });

  it("should refuse to start when socket already exists and is active", async () => {
    handle = await startServer({ port: 0, socketPath, tokensPath });
    await expect(startServer({ port: 0, socketPath, tokensPath })).rejects.toThrow(
      /already running/i,
    );
  });

  it("should clean up stale socket and start successfully", async () => {
    // Create a stale socket file (just a regular file, no server behind it)
    fs.writeFileSync(socketPath, "");
    handle = await startServer({ port: 0, socketPath, tokensPath });
    expect(handle.port).toBeGreaterThan(0);
  });

  it("codoc share via IPC returns URL", async () => {
    handle = await startServer({ port: 0, socketPath, tokensPath });
    const testFile = path.join(os.tmpdir(), `codoc-lifecycle-${process.pid}.md`);
    fs.writeFileSync(testFile, "# Lifecycle Test\n");

    try {
      const client = new IpcClient(socketPath);
      const response = await client.send({
        method: "share",
        params: { filePath: testFile },
      });
      expect(response.ok).toBe(true);
      const data = response.data as { token: string; url: string };
      expect(data.url).toContain(`http://127.0.0.1:${handle.port}/edit/`);
    } finally {
      try {
        fs.unlinkSync(testFile);
      } catch {}
    }
  });

  it("codoc stop shuts down server and removes socket", async () => {
    handle = await startServer({ port: 0, socketPath, tokensPath });
    const client = new IpcClient(socketPath);
    const response = await client.send({ method: "stop", params: {} });
    expect(response.ok).toBe(true);

    // Wait briefly for cleanup
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(fs.existsSync(socketPath)).toBe(false);
    handle = null; // Already stopped
  });
});
