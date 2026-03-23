import http from "node:http";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { GatewayCliClient } from "../cli-client.js";
import type { GatewayToClient } from "../types.js";

// --- Helpers ---

/** Create a minimal WS server that captures incoming messages. */
function createMockGateway(apiKey?: string): {
  server: http.Server;
  wss: WebSocketServer;
  received: unknown[];
  clients: WebSocket[];
  port: () => number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  send: (msg: GatewayToClient) => void;
} {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const received: unknown[] = [];
  const clients: WebSocket[] = [];

  server.on("upgrade", (req, socket, head) => {
    // Validate API key if configured
    if (apiKey) {
      const key = req.headers["x-api-key"];
      if (key !== apiKey) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    if (req.url === "/ws/client") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.push(ws);
        wss.emit("connection", ws, req);
      });
    } else {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
    }
  });

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      received.push(JSON.parse(data.toString()));
    });
  });

  return {
    server,
    wss,
    received,
    clients,
    port: () => {
      const addr = server.address();
      if (addr && typeof addr === "object") return addr.port;
      throw new Error("Server not listening");
    },
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        for (const ws of clients) ws.close();
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    send: (msg: GatewayToClient) => {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      }
    },
  };
}

// --- Unit Tests: Gateway client connects and authenticates ---

describe("GatewayCliClient connection and auth", () => {
  let gw: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    gw = createMockGateway("valid-key");
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
  });

  test("connects to /ws/client with API key", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    await client.connect();
    expect(gw.clients).toHaveLength(1);
    client.close();
  });

  test("rejects connection with invalid API key", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "wrong-key",
    });

    await expect(client.connect()).rejects.toThrow();
    client.close();
  });
});

// --- Integration Test: User Input Routing ---

describe("Integration: User Input Routing", () => {
  let gw: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    gw = createMockGateway("valid-key");
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
  });

  test("full round-trip: create run, receive output, send input, receive completion", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const events: Array<{ type: string; data: unknown }> = [];
    client.on("run_created", (msg) => events.push({ type: "run_created", data: msg }));
    client.on("agent_output", (msg) =>
      events.push({ type: "agent_output", data: msg }),
    );
    client.on("state_changed", (msg) =>
      events.push({ type: "state_changed", data: msg }),
    );
    client.on("run_completed", (msg) =>
      events.push({ type: "run_completed", data: msg }),
    );

    await client.connect();

    // Step 1: Client creates run
    client.createRun("workflow.yaml");
    await new Promise((r) => setTimeout(r, 50));
    expect(gw.received[0]).toMatchObject({ type: "create_run" });

    // Step 2: Gateway sends run_created
    gw.send({ type: "run_created", run_id: "r1" });
    await new Promise((r) => setTimeout(r, 50));

    // Step 3: Gateway sends agent_output (request_input prompt)
    gw.send({
      type: "agent_output",
      run_id: "r1",
      content: "What is your name?",
    });
    await new Promise((r) => setTimeout(r, 50));

    // Step 4: Client sends user input
    client.sendInput("r1", "James");
    await new Promise((r) => setTimeout(r, 50));
    expect(gw.received[1]).toEqual({
      type: "user_input",
      run_id: "r1",
      input: "James",
    });

    // Step 5: Gateway sends state_changed + run_completed
    gw.send({ type: "state_changed", run_id: "r1", from: "init", to: "done" });
    gw.send({ type: "run_completed", run_id: "r1", status: "completed" });
    await new Promise((r) => setTimeout(r, 50));

    // Verify all events received in order
    expect(events.map((e) => e.type)).toEqual([
      "run_created",
      "agent_output",
      "state_changed",
      "run_completed",
    ]);

    client.close();
  });
});

// --- Reconnection Test ---

describe("Reconnection", () => {
  let gw: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    gw = createMockGateway("valid-key");
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
  });

  test("reconnects on unexpected close", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
      reconnectDelayMs: 50,
      maxReconnectAttempts: 3,
    });

    await client.connect();
    expect(gw.clients).toHaveLength(1);

    // Server-side close the connection
    gw.clients[0].close();

    // Wait for reconnect
    await new Promise((r) => setTimeout(r, 200));

    // Should have reconnected
    expect(gw.clients.filter((c) => c.readyState === WebSocket.OPEN)).toHaveLength(1);

    client.close();
  });
});
