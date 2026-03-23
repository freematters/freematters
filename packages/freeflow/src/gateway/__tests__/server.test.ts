import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import WebSocket from "ws";
import { Router } from "../router.js";
import { createGatewayServer } from "../server.js";
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

      // Expect registered acknowledgment with server-generated ID
      const ack = (await wsRecv(ws)) as { type: string; daemon_id: string };
      expect(ack.type).toBe("registered");
      expect(ack.daemon_id).toMatch(/^daemon-[a-f0-9]{8}$/);
    } finally {
      ws.close();
    }
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
