import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createHttpHandler } from "../http.js";
import { SessionTracker } from "../session-tracker.js";
import { TokenStore } from "../token-store.js";

function tmpPath(prefix: string): string {
  return path.join(os.tmpdir(), `codoc-step9-${prefix}-${process.pid}-${Date.now()}`);
}

function request(
  port: number,
  method: string,
  urlPath: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path: urlPath,
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: data });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("GET /api/status/:token", () => {
  let server: http.Server;
  let tokenStore: TokenStore;
  let sessionTracker: SessionTracker;
  let tokensPath: string;
  let testFilePath: string;
  let port: number;

  beforeEach(async () => {
    tokensPath = `${tmpPath("tokens")}.json`;
    testFilePath = `${tmpPath("file")}.md`;
    fs.writeFileSync(testFilePath, "# Test\n");

    tokenStore = new TokenStore(tokensPath);
    sessionTracker = new SessionTracker();

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      undefined,
      sessionTracker,
      undefined,
    );
    server = http.createServer(handler);

    port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should return 404 for unknown token", async () => {
    const res = await request(port, "GET", "/api/status/nonexistent");
    expect(res.status).toBe(404);
  });

  it("should return agentOnline false when no activity", async () => {
    const reg = tokenStore.register(testFilePath, false);
    const res = await request(port, "GET", `/api/status/${reg.token}`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.agentOnline).toBe(false);
  });

  it("should return agentOnline true when poll is active", async () => {
    const reg = tokenStore.register(testFilePath, false);
    sessionTracker.recordPoll(reg.token);
    const res = await request(port, "GET", `/api/status/${reg.token}`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.agentOnline).toBe(true);
  });

  it("should return agentOnline true when heartbeat is recent", async () => {
    const reg = tokenStore.register(testFilePath, false);
    sessionTracker.recordHeartbeat("session-abc");
    const res = await request(port, "GET", `/api/status/${reg.token}`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.agentOnline).toBe(true);
  });

  it("should return agentOnline false when heartbeat is stale", async () => {
    const reg = tokenStore.register(testFilePath, false);
    sessionTracker.recordHeartbeat("session-abc");
    (sessionTracker as unknown as { heartbeats: Map<string, number> }).heartbeats.set(
      "session-abc",
      Date.now() - 31000,
    );
    const res = await request(port, "GET", `/api/status/${reg.token}`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.agentOnline).toBe(false);
  });
});

describe("WebSocket agent:status push", () => {
  let server: http.Server;
  let tokenStore: TokenStore;
  let sessionTracker: SessionTracker;
  let tokensPath: string;
  let testFilePath: string;
  let port: number;

  beforeEach(async () => {
    tokensPath = `${tmpPath("ws-tokens")}.json`;
    testFilePath = `${tmpPath("ws-file")}.md`;
    fs.writeFileSync(testFilePath, "# Test\n");

    tokenStore = new TokenStore(tokensPath);
    sessionTracker = new SessionTracker();

    const handler = createHttpHandler(
      tokenStore,
      undefined,
      undefined,
      sessionTracker,
      undefined,
    );
    server = http.createServer(handler);

    port = await new Promise<number>((resolve, reject) => {
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as net.AddressInfo;
        resolve(addr.port);
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    try {
      fs.unlinkSync(tokensPath);
    } catch {}
    try {
      fs.unlinkSync(testFilePath);
    } catch {}
  });

  it("should push agent:status event when broadcastAgentStatus is called", async () => {
    const { WebSocketServer: CodocWsServer } = await import("../websocket.js");
    const wsServer = new CodocWsServer(server, tokenStore);
    const reg = tokenStore.register(testFilePath, false);

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => {
      ws.on("open", resolve);
    });

    ws.send(JSON.stringify({ type: "file:subscribe", payload: { token: reg.token } }));

    // Wait for file:content response
    await new Promise<void>((resolve) => {
      ws.on("message", function handler(data: Buffer) {
        const msg = JSON.parse(data.toString());
        if (msg.type === "file:content") {
          ws.removeListener("message", handler);
          resolve();
        }
      });
    });

    // Now listen for agent:status push
    const statusPromise = new Promise<{ online: boolean }>((resolve) => {
      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "agent:status") {
          resolve(msg.payload as { online: boolean });
        }
      });
    });

    wsServer.broadcastAgentStatus(reg.token, true);

    const statusPayload = await statusPromise;
    expect(statusPayload.online).toBe(true);

    ws.close();
    wsServer.close();
  });
});
