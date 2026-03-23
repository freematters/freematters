import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DaemonConfig,
  DaemonToGateway,
  GatewayToDaemon,
} from "../../gateway/types.js";

// ── Mock WebSocket ────────────────────────────────────────────────

/** Minimal mock that simulates a WebSocket connection to Gateway. */
class MockWebSocket {
  sent: string[] = [];
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  /** Simulate receiving a message from Gateway. */
  receive(msg: GatewayToDaemon): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Simulate the connection opening. */
  simulateOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Get parsed sent messages. */
  sentMessages(): DaemonToGateway[] {
    return this.sent.map((s) => JSON.parse(s));
  }
}

// We mock the ws module so GatewayClient doesn't open real connections
vi.mock("ws", () => {
  function MockWS(_url: string) {
    const mock = new MockWebSocket();
    return mock;
  }
  return { default: MockWS };
});


// Import after mocking
const { createDaemon } = await import("../index.js");
const { AgentPool } = await import("../agent-pool.js");
const { GatewayClient } = await import("../gateway-client.js");

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    gateway_url: "ws://localhost:8080/ws/daemon",
    api_key: "test-key",
    max_agents: 5,
    agent_idle_timeout_ms: 300000,
    store_root: "/tmp/freeflow-test",
    cli_path: "/tmp/fake-cli.js",
    ...overrides,
  };
}

// ── Unit Tests ────────────────────────────────────────────────────

describe("GatewayClient", () => {
  it("sends register message on connect", async () => {
    const config = makeConfig();
    const client = new GatewayClient(config);
    const sentMessages: DaemonToGateway[] = [];

    client.onSend = (msg) => sentMessages.push(msg);
    client.connect("daemon-001", 5);

    // Simulate the register being sent on open
    const registerMsg = sentMessages.find((m) => m.type === "register");
    expect(registerMsg).toBeDefined();
    expect(registerMsg).toEqual({
      type: "register",
      daemon_id: "daemon-001",
      capacity: 5,
    });
  });

  it("forwards GatewayToDaemon messages to handler", () => {
    const config = makeConfig();
    const client = new GatewayClient(config);
    const received: GatewayToDaemon[] = [];

    client.onMessage = (msg) => received.push(msg);
    client.connect("daemon-001", 5);

    // Simulate receiving a start_run from gateway
    client.handleIncoming({
      type: "start_run",
      run_id: "run-123",
      workflow: "test.fsm.yml",
      prompt: "hello",
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: "start_run",
      run_id: "run-123",
      workflow: "test.fsm.yml",
      prompt: "hello",
    });
  });

  it("sends agent_output messages to gateway", () => {
    const config = makeConfig();
    const client = new GatewayClient(config);
    const sentMessages: DaemonToGateway[] = [];

    client.onSend = (msg) => sentMessages.push(msg);
    client.connect("daemon-001", 5);

    client.sendMessage({
      type: "agent_output",
      run_id: "run-123",
      content: "Hello from agent",
      stream: true,
    });

    const outputMsg = sentMessages.find((m) => m.type === "agent_output");
    expect(outputMsg).toBeDefined();
    expect(outputMsg).toEqual({
      type: "agent_output",
      run_id: "run-123",
      content: "Hello from agent",
      stream: true,
    });
  });
});

describe("AgentPool", () => {
  it("creates a new agent for a run", async () => {
    const pool = new AgentPool({
      max_agents: 5,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    const handle = await pool.startAgent({
      run_id: "run-123",
      workflow: "test.fsm.yml",
      prompt: "do stuff",
    });

    expect(handle.run_id).toBe("run-123");
    // Agent transitions starting → running via microtask, so by the time
    // the await resolves, it may already be "running".
    expect(["starting", "running"]).toContain(handle.status);
    expect(handle.session_id).toBeTruthy();
  });

  it("tracks agent status transitions", async () => {
    const pool = new AgentPool({
      max_agents: 5,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    const handle = await pool.startAgent({
      run_id: "run-456",
      workflow: "test.fsm.yml",
    });

    // After await, microtask may have already moved it to "running"
    expect(["starting", "running"]).toContain(handle.status);

    pool.updateStatus("run-456", "idle");
    const idled = pool.getAgent("run-456");
    expect(idled?.status).toBe("idle");

    pool.updateStatus("run-456", "stopped");
    const stopped = pool.getAgent("run-456");
    expect(stopped?.status).toBe("stopped");
  });

  it("rejects when pool is full", async () => {
    const pool = new AgentPool({
      max_agents: 1,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    await pool.startAgent({ run_id: "run-1", workflow: "a.yml" });

    await expect(
      pool.startAgent({ run_id: "run-2", workflow: "b.yml" }),
    ).rejects.toThrow(/capacity/i);
  });

  it("returns all agents", async () => {
    const pool = new AgentPool({
      max_agents: 5,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    await pool.startAgent({ run_id: "run-a", workflow: "a.yml" });
    await pool.startAgent({ run_id: "run-b", workflow: "b.yml" });

    const agents = pool.getAgents();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.run_id).sort()).toEqual(["run-a", "run-b"]);
  });

  it("forwards user input to agent", async () => {
    const pool = new AgentPool({
      max_agents: 5,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    await pool.startAgent({ run_id: "run-input", workflow: "a.yml" });
    pool.updateStatus("run-input", "running");

    // Should not throw — input is queued/forwarded
    pool.sendInput("run-input", "user says hello");
  });

  it("removes stopped agents", async () => {
    const pool = new AgentPool({
      max_agents: 5,
      agent_idle_timeout_ms: 300000,
      store_root: "/tmp/freeflow-test",
      cli_path: "/tmp/fake-cli.js",
    });

    await pool.startAgent({ run_id: "run-rm", workflow: "a.yml" });
    expect(pool.getAgent("run-rm")).toBeDefined();

    pool.removeAgent("run-rm");
    expect(pool.getAgent("run-rm")).toBeUndefined();
  });
});

describe("createDaemon", () => {
  it("returns start, stop, and getAgents functions", () => {
    const config = makeConfig();
    const daemon = createDaemon(config);

    expect(typeof daemon.start).toBe("function");
    expect(typeof daemon.stop).toBe("function");
    expect(typeof daemon.getAgents).toBe("function");
  });

  it("getAgents returns empty array initially", () => {
    const config = makeConfig();
    const daemon = createDaemon(config);

    expect(daemon.getAgents()).toEqual([]);
  });
});

