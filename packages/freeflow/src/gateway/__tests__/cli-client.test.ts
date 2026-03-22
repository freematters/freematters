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

// --- Unit Tests: CLI parses --gateway and --api-key options ---

describe("CLI --gateway and --api-key options", () => {
  test("RunArgs interface includes gateway and apiKey fields", async () => {
    const mod = await import("../../commands/run.js");
    // Verify the type exists by constructing a valid RunArgs object
    const args: (typeof mod)["RunArgs"] extends never
      ? never
      : import("../../commands/run.js").RunArgs = {
      fsmPath: "test.yaml",
      root: "/tmp",
      json: false,
      gateway: "ws://localhost:8080",
      apiKey: "test-key",
    };
    expect(args.gateway).toBe("ws://localhost:8080");
    expect(args.apiKey).toBe("test-key");
  });
});

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

  test("sends create_run message on createRun()", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    await client.connect();
    client.createRun("my-workflow.yaml", "run-123", "hello");

    // Wait briefly for message delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(gw.received).toHaveLength(1);
    expect(gw.received[0]).toEqual({
      type: "create_run",
      workflow: "my-workflow.yaml",
      run_id: "run-123",
      prompt: "hello",
    });

    client.close();
  });
});

// --- Unit Tests: User input forwarding ---

describe("User input forwarding", () => {
  let gw: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    gw = createMockGateway("valid-key");
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
  });

  test("sends user_input message via sendInput()", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    await client.connect();
    client.sendInput("run-1", "yes");

    await new Promise((r) => setTimeout(r, 50));

    expect(gw.received).toHaveLength(1);
    expect(gw.received[0]).toEqual({
      type: "user_input",
      run_id: "run-1",
      input: "yes",
    });

    client.close();
  });

  test("sends abort_run message via abortRun()", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    await client.connect();
    client.abortRun("run-1");

    await new Promise((r) => setTimeout(r, 50));

    expect(gw.received).toHaveLength(1);
    expect(gw.received[0]).toEqual({
      type: "abort_run",
      run_id: "run-1",
    });

    client.close();
  });
});

// --- Unit Tests: Message handling (agent_output, state_changed, etc.) ---

describe("Message handling", () => {
  let gw: ReturnType<typeof createMockGateway>;

  beforeEach(async () => {
    gw = createMockGateway("valid-key");
    await gw.start();
  });

  afterEach(async () => {
    await gw.stop();
  });

  test("emits agent_output events", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const outputs: string[] = [];
    client.on("agent_output", (msg) => {
      outputs.push(msg.content);
    });

    await client.connect();

    gw.send({
      type: "agent_output",
      run_id: "r1",
      content: "hello world",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(outputs).toEqual(["hello world"]);

    client.close();
  });

  test("emits state_changed events", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const changes: Array<{ from: string; to: string }> = [];
    client.on("state_changed", (msg) => {
      changes.push({ from: msg.from, to: msg.to });
    });

    await client.connect();

    gw.send({
      type: "state_changed",
      run_id: "r1",
      from: "init",
      to: "review",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(changes).toEqual([{ from: "init", to: "review" }]);

    client.close();
  });

  test("emits run_completed events", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const completions: string[] = [];
    client.on("run_completed", (msg) => {
      completions.push(msg.status);
    });

    await client.connect();

    gw.send({
      type: "run_completed",
      run_id: "r1",
      status: "completed",
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(completions).toEqual(["completed"]);

    client.close();
  });

  test("emits run_created events", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const runIds: string[] = [];
    client.on("run_created", (msg) => {
      runIds.push(msg.run_id);
    });

    await client.connect();

    gw.send({ type: "run_created", run_id: "r1" });

    await new Promise((r) => setTimeout(r, 50));
    expect(runIds).toEqual(["r1"]);

    client.close();
  });

  test("emits error events", async () => {
    const client = new GatewayCliClient({
      gatewayUrl: `ws://127.0.0.1:${gw.port()}`,
      apiKey: "valid-key",
    });

    const errors: string[] = [];
    client.on("error", (msg) => {
      errors.push(msg.message);
    });

    await client.connect();

    gw.send({ type: "error", message: "something went wrong" });

    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toEqual(["something went wrong"]);

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
