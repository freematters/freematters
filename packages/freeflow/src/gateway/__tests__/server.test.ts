import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import WebSocket from "ws";
import { Store } from "../../store.js";
import { Router } from "../router.js";
import { createGatewayServer } from "../server.js";
import { validateApiKey } from "../server.js";
import type { GatewayConfig } from "../types.js";

// --- Helpers ---

function makeConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 0, // random port
    host: "127.0.0.1",
    api_keys: ["test-key-1", "test-key-2"],
    store_root: mkdtempSync(join(tmpdir(), "gw-test-")),
    max_concurrent_runs: 20,
    idle_timeout_ms: 3600000,
    ...overrides,
  };
}

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("Server not listening");
}

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: "127.0.0.1",
      port,
      path,
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function connectWs(port: number, path: string, apiKey?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (apiKey) headers["x-api-key"] = apiKey;
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function wsRecv(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString()));
    });
  });
}

function wsSend(ws: WebSocket, msg: unknown): void {
  ws.send(JSON.stringify(msg));
}

// --- Unit Tests: API Key Validation ---

describe("API key validation", () => {
  test("accepts valid Bearer token", () => {
    const keys = ["secret-123"];
    expect(validateApiKey("Bearer secret-123", keys)).toBe(true);
  });

  test("accepts valid X-API-Key", () => {
    const keys = ["secret-123"];
    expect(validateApiKey("secret-123", keys)).toBe(true);
  });

  test("rejects missing key", () => {
    const keys = ["secret-123"];
    expect(validateApiKey(undefined, keys)).toBe(false);
  });

  test("rejects invalid key", () => {
    const keys = ["secret-123"];
    expect(validateApiKey("wrong-key", keys)).toBe(false);
    expect(validateApiKey("Bearer wrong-key", keys)).toBe(false);
  });

  test("accepts any key from the list", () => {
    const keys = ["key-a", "key-b", "key-c"];
    expect(validateApiKey("Bearer key-b", keys)).toBe(true);
    expect(validateApiKey("key-c", keys)).toBe(true);
  });
});

// --- Unit Tests: REST Endpoints ---

describe("REST endpoints", () => {
  let config: GatewayConfig;
  let gw: ReturnType<typeof createGatewayServer>;
  let port: number;

  beforeEach(async () => {
    config = makeConfig();
    gw = createGatewayServer(config);
    await gw.start();
    port = getPort(gw.server);
  });

  afterEach(async () => {
    await gw.stop();
    rmSync(config.store_root, { recursive: true, force: true });
  });

  test("GET /api/health returns ok", async () => {
    const res = await httpRequest(port, "GET", "/api/health", undefined, {
      Authorization: "Bearer test-key-1",
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  test("rejects request without API key", async () => {
    const res = await httpRequest(port, "GET", "/api/health");
    expect(res.status).toBe(401);
  });

  test("rejects request with wrong API key", async () => {
    const res = await httpRequest(port, "GET", "/api/health", undefined, {
      Authorization: "Bearer wrong",
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/runs creates a run", async () => {
    const res = await httpRequest(
      port,
      "POST",
      "/api/runs",
      { workflow: "test.yaml" },
      { Authorization: "Bearer test-key-1" },
    );
    expect(res.status).toBe(201);
    const body = res.body as { run_id: string; status: string };
    expect(body.run_id).toBeDefined();
    expect(body.status).toBe("pending");
  });

  test("GET /api/runs lists runs", async () => {
    // Create a run first
    await httpRequest(
      port,
      "POST",
      "/api/runs",
      { workflow: "a.yaml" },
      {
        Authorization: "Bearer test-key-1",
      },
    );
    const res = await httpRequest(port, "GET", "/api/runs", undefined, {
      Authorization: "Bearer test-key-1",
    });
    expect(res.status).toBe(200);
    const body = res.body as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  test("GET /api/runs/:id returns run details", async () => {
    const createRes = await httpRequest(
      port,
      "POST",
      "/api/runs",
      { workflow: "b.yaml" },
      { Authorization: "Bearer test-key-1" },
    );
    const { run_id } = createRes.body as { run_id: string };

    const res = await httpRequest(port, "GET", `/api/runs/${run_id}`, undefined, {
      Authorization: "Bearer test-key-1",
    });
    expect(res.status).toBe(200);
    const body = res.body as {
      run_id: string;
      workflow: string;
      gateway_status: string;
    };
    expect(body.run_id).toBe(run_id);
    expect(body.gateway_status).toBe("pending");
  });

  test("GET /api/runs/:id returns 404 for nonexistent run", async () => {
    const res = await httpRequest(port, "GET", "/api/runs/no-such-run", undefined, {
      Authorization: "Bearer test-key-1",
    });
    expect(res.status).toBe(404);
  });

  test("DELETE /api/runs/:id aborts a run", async () => {
    const createRes = await httpRequest(
      port,
      "POST",
      "/api/runs",
      { workflow: "c.yaml" },
      { Authorization: "Bearer test-key-1" },
    );
    const { run_id } = createRes.body as { run_id: string };

    const res = await httpRequest(port, "DELETE", `/api/runs/${run_id}`, undefined, {
      Authorization: "Bearer test-key-1",
    });
    expect(res.status).toBe(200);
    const body = res.body as { run_id: string; status: string };
    expect(body.status).toBe("aborted");
  });
});

// --- Unit Tests: WebSocket Message Routing ---

describe("Router", () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  test("registers and retrieves daemon", () => {
    const ws = {} as WebSocket;
    router.registerDaemon("d1", ws, 5);
    const daemon = router.getDaemon("d1");
    expect(daemon).toBeDefined();
    expect(daemon?.capacity).toBe(5);
  });

  test("assigns run to daemon", () => {
    const ws = {} as WebSocket;
    router.registerDaemon("d1", ws, 5);
    router.assignRunToDaemon("run-1", "d1");
    expect(router.getDaemonForRun("run-1")).toBe("d1");
    expect(router.getDaemonWsForRun("run-1")).toBe(ws);
  });

  test("subscribes client to run", () => {
    const ws = {} as WebSocket;
    router.subscribeClient("c1", ws, "run-1");
    const clients = router.getClientsForRun("run-1");
    expect(clients).toHaveLength(1);
    expect(clients[0]).toBe(ws);
  });

  test("removes daemon and its run mappings", () => {
    const ws = {} as WebSocket;
    router.registerDaemon("d1", ws, 5);
    router.assignRunToDaemon("run-1", "d1");
    router.removeDaemon("d1");
    expect(router.getDaemon("d1")).toBeUndefined();
    expect(router.getDaemonForRun("run-1")).toBeUndefined();
  });

  test("removes client subscription", () => {
    const ws = {} as WebSocket;
    router.subscribeClient("c1", ws, "run-1");
    router.removeClient("c1");
    const clients = router.getClientsForRun("run-1");
    expect(clients).toHaveLength(0);
  });

  test("picks daemon with available capacity", () => {
    const ws1 = {} as WebSocket;
    const ws2 = {} as WebSocket;
    router.registerDaemon("d1", ws1, 0);
    router.registerDaemon("d2", ws2, 3);
    const picked = router.pickAvailableDaemon();
    expect(picked).toBe("d2");
  });

  test("returns undefined when no daemon has capacity", () => {
    const ws = {} as WebSocket;
    router.registerDaemon("d1", ws, 0);
    expect(router.pickAvailableDaemon()).toBeUndefined();
  });
});

// --- Integration Test: Gateway-Daemon Connection ---

describe("Integration: Gateway-Daemon Connection", () => {
  let config: GatewayConfig;
  let gw: ReturnType<typeof createGatewayServer>;
  let port: number;

  beforeEach(async () => {
    config = makeConfig();
    gw = createGatewayServer(config);
    await gw.start();
    port = getPort(gw.server);
  });

  afterEach(async () => {
    await gw.stop();
    rmSync(config.store_root, { recursive: true, force: true });
  });

  test("daemon connects and registers, gateway acknowledges", async () => {
    const ws = await connectWs(port, "/ws/daemon", "test-key-1");
    try {
      // Send register message
      wsSend(ws, { type: "register", daemon_id: "daemon-1", capacity: 5 });

      // Expect registered acknowledgment
      const ack = (await wsRecv(ws)) as { type: string; daemon_id: string };
      expect(ack.type).toBe("registered");
      expect(ack.daemon_id).toBe("daemon-1");
    } finally {
      ws.close();
    }
  });

  test("rejects daemon WebSocket without API key", async () => {
    await expect(connectWs(port, "/ws/daemon")).rejects.toThrow();
  });

  test("client connects and can create run via WebSocket", async () => {
    // Connect daemon first
    const daemonWs = await connectWs(port, "/ws/daemon", "test-key-1");
    wsSend(daemonWs, { type: "register", daemon_id: "daemon-1", capacity: 5 });
    await wsRecv(daemonWs); // consume registered ack

    // Connect client
    const clientWs = await connectWs(port, "/ws/client", "test-key-1");
    try {
      wsSend(clientWs, { type: "create_run", workflow: "test.yaml" });

      // Client should receive run_created
      const msg = (await wsRecv(clientWs)) as { type: string; run_id: string };
      expect(msg.type).toBe("run_created");
      expect(msg.run_id).toBeDefined();

      // Daemon should receive start_run
      const daemonMsg = (await wsRecv(daemonWs)) as {
        type: string;
        run_id: string;
        workflow: string;
      };
      expect(daemonMsg.type).toBe("start_run");
      expect(daemonMsg.run_id).toBe(msg.run_id);
      expect(daemonMsg.workflow).toBe("test.yaml");
    } finally {
      clientWs.close();
      daemonWs.close();
    }
  });

  test("routes user_input from client to daemon", async () => {
    // Setup: daemon registers
    const daemonWs = await connectWs(port, "/ws/daemon", "test-key-1");
    wsSend(daemonWs, { type: "register", daemon_id: "daemon-1", capacity: 5 });
    await wsRecv(daemonWs);

    // Create run via client
    const clientWs = await connectWs(port, "/ws/client", "test-key-1");
    wsSend(clientWs, { type: "create_run", workflow: "test.yaml" });
    const created = (await wsRecv(clientWs)) as { type: string; run_id: string };
    await wsRecv(daemonWs); // consume start_run

    // Send user input
    wsSend(clientWs, { type: "user_input", run_id: created.run_id, input: "hello" });
    const fwd = (await wsRecv(daemonWs)) as {
      type: string;
      run_id: string;
      input: string;
    };
    expect(fwd.type).toBe("user_input");
    expect(fwd.run_id).toBe(created.run_id);
    expect(fwd.input).toBe("hello");

    clientWs.close();
    daemonWs.close();
  });

  test("routes agent_output from daemon to client", async () => {
    // Setup
    const daemonWs = await connectWs(port, "/ws/daemon", "test-key-1");
    wsSend(daemonWs, { type: "register", daemon_id: "daemon-1", capacity: 5 });
    await wsRecv(daemonWs);

    const clientWs = await connectWs(port, "/ws/client", "test-key-1");
    wsSend(clientWs, { type: "create_run", workflow: "test.yaml" });
    const created = (await wsRecv(clientWs)) as { type: string; run_id: string };
    await wsRecv(daemonWs); // consume start_run

    // Daemon sends agent_output
    wsSend(daemonWs, {
      type: "agent_output",
      run_id: created.run_id,
      content: "output text",
    });
    const output = (await wsRecv(clientWs)) as {
      type: string;
      run_id: string;
      content: string;
    };
    expect(output.type).toBe("agent_output");
    expect(output.run_id).toBe(created.run_id);
    expect(output.content).toBe("output text");

    clientWs.close();
    daemonWs.close();
  });
});
