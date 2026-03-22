import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { FileWatcher } from "../file-watcher.js";
import { createHttpHandler } from "../http.js";
import { TokenStore } from "../token-store.js";
import { WebSocketServer as CodocWsServer } from "../websocket.js";

function getTokensPath(): string {
  return path.join(
    os.tmpdir(),
    `codoc-ws-test-tokens-${process.pid}-${Date.now()}.json`,
  );
}

function createTestFile(content: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `codoc-ws-test-${process.pid}-${Date.now()}.md`,
  );
  fs.writeFileSync(filePath, content);
  return filePath;
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

function waitForMessage(ws: WebSocket): Promise<{ type: string; payload: unknown }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for message"));
    }, 5000);
    ws.on("message", (data: WebSocket.Data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

describe("WebSocket Server", () => {
  let tokenStore: TokenStore;
  let httpServer: http.Server;
  let wsServer: CodocWsServer;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    tokensPath = getTokensPath();
    tokenStore = new TokenStore(tokensPath);
    testFilePath = createTestFile("# WebSocket Test\n\nHello from WS.\n");

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    httpServer = http.createServer(handler);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const addr = httpServer.address() as net.AddressInfo;
    port = addr.port;

    wsServer = new CodocWsServer(httpServer, tokenStore);
  });

  afterEach(async () => {
    wsServer.close();
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
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

  it("should accept WebSocket connections", async () => {
    const ws = await connectWs(port);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("should send file:content after file:subscribe", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const ws = await connectWs(port);
    const msgPromise = waitForMessage(ws);

    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token: reg.token } }));

    const msg = await msgPromise;
    expect(msg.type).toBe("file:content");
    const payload = msg.payload as { content: string; version: number };
    expect(payload.content).toContain("# WebSocket Test");
    expect(typeof payload.version).toBe("number");

    ws.close();
  });

  it("should broadcast file:saved when notifySaved is called", async () => {
    const reg = tokenStore.register(testFilePath, false);

    const ws1 = await connectWs(port);
    const ws2 = await connectWs(port);

    ws1.send(JSON.stringify({ type: "file:subscribe", payload: { token: reg.token } }));
    await waitForMessage(ws1);

    ws2.send(JSON.stringify({ type: "file:subscribe", payload: { token: reg.token } }));
    await waitForMessage(ws2);

    const savedPromise1 = waitForMessage(ws1);
    const savedPromise2 = waitForMessage(ws2);
    wsServer.notifySaved(reg.token, "testuser");

    const savedMsg1 = await savedPromise1;
    expect(savedMsg1.type).toBe("file:saved");
    const payload1 = savedMsg1.payload as { by: string; version: number };
    expect(payload1.by).toBe("testuser");

    const savedMsg2 = await savedPromise2;
    expect(savedMsg2.type).toBe("file:saved");

    ws1.close();
    ws2.close();
  });

  it("should broadcast file:changed when notifyFileChanged is called", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const ws = await connectWs(port);

    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token: reg.token } }));
    await waitForMessage(ws); // consume file:content

    const changedPromise = waitForMessage(ws);
    wsServer.notifyFileChanged(reg.token, "new content here", []);

    const msg = await changedPromise;
    expect(msg.type).toBe("file:changed");

    ws.close();
  });
});

describe("FileWatcher", () => {
  let watcher: FileWatcher;
  let testFilePath: string;

  beforeEach(() => {
    watcher = new FileWatcher();
    testFilePath = createTestFile("initial content\n");
  });

  afterEach(async () => {
    await watcher.close();
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should detect external file changes", async () => {
    const changed = new Promise<{ filePath: string; newContent: string }>((resolve) => {
      watcher.watch(testFilePath, (filePath: string, newContent: string) => {
        resolve({ filePath, newContent });
      });
    });

    // Wait for watcher to be ready, then modify file
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(testFilePath, "modified content\n");

    const result = await changed;
    expect(result.filePath).toBe(testFilePath);
    expect(result.newContent).toBe("modified content\n");
  });

  it("should unwatch a file", async () => {
    let callCount = 0;
    watcher.watch(testFilePath, () => {
      callCount++;
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    watcher.unwatch(testFilePath);

    fs.writeFileSync(testFilePath, "should not trigger\n");
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(callCount).toBe(0);
  });
});

describe("HTTP SPA serving", () => {
  let tokenStore: TokenStore;
  let httpServer: http.Server;
  let port: number;
  let tokensPath: string;
  let testFilePath: string;

  beforeEach(async () => {
    tokensPath = getTokensPath();
    tokenStore = new TokenStore(tokensPath);
    testFilePath = createTestFile("# SPA Test\n");

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      undefined,
      undefined,
      undefined,
    );
    httpServer = http.createServer(handler);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });
    const addr = httpServer.address() as net.AddressInfo;
    port = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
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

  it("GET /edit/:token should serve index.html from dist/static/ if it exists", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const res = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/edit/${reg.token}`, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            res.on("end", () => {
              resolve({ statusCode: res.statusCode!, body });
            });
          })
          .on("error", reject);
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<html");
    expect(res.body).toContain('<div id="root">');
  });

  it("GET /assets/* should serve built frontend assets", async () => {
    const assetsDir = path.join(__dirname, "..", "..", "dist", "static", "assets");
    let assetFile: string | null = null;
    try {
      const files = fs.readdirSync(assetsDir);
      assetFile = files.find((f: string) => f.endsWith(".js")) ?? null;
    } catch {}
    if (!assetFile) return;

    const res = await new Promise<{ statusCode: number; body: string }>(
      (resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/assets/${assetFile}`, (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += chunk.toString();
            });
            res.on("end", () => {
              resolve({ statusCode: res.statusCode!, body });
            });
          })
          .on("error", reject);
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
