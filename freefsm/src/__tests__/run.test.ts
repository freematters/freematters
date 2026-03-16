import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the agent SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(() => ({
    type: "sdk",
    name: "freefsm",
    instance: {},
  })),
  tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: unknown) => ({
    name,
    handler,
  })),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { run } from "../commands/run.js";
import { Store } from "../store.js";

const MINIMAL_FSM = `
version: 1
guide: "Test guide for the workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

const NO_GUIDE_FSM = `
version: 1
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmPath: string;
let noGuideFsmPath: string;
let root: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-run-test-"));
  fsmPath = join(tmp, "minimal.yaml");
  noGuideFsmPath = join(tmp, "no-guide.yaml");
  writeFileSync(fsmPath, MINIMAL_FSM, "utf-8");
  writeFileSync(noGuideFsmPath, NO_GUIDE_FSM, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  // Each test gets a fresh root
  root = mkdtempSync(join(tmp, "root-"));
});

function mockQueryResult(messages: SDKMessage[]): void {
  const mockQuery = vi.mocked(query);
  // query() returns an AsyncGenerator<SDKMessage>
  async function* generator(): AsyncGenerator<SDKMessage, void> {
    for (const msg of messages) {
      yield msg;
    }
  }
  const gen = generator();
  // Add the Query interface methods as stubs
  Object.assign(gen, {
    interrupt: vi.fn(),
    setPermissionMode: vi.fn(),
    setModel: vi.fn(),
    setMaxThinkingTokens: vi.fn(),
    streamInput: vi.fn(),
    stopTask: vi.fn(),
    close: vi.fn(),
    rewindFiles: vi.fn(),
  });
  mockQuery.mockReturnValue(gen as ReturnType<typeof query>);
}

// ─── run command — FSM initialization ────────────────────────────

describe("run command — FSM initialization", () => {
  test("initializes FSM run via Store (same events as start)", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, root, json: false });

    // Verify store was initialized — there should be exactly one run
    const store = new Store(root);
    const runs = store.listRuns();
    expect(runs).toHaveLength(1);

    // Verify snapshot shows initial state
    const runId = runs[0];
    const snapshot = store.readSnapshot(runId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.state).toBe("start");
    expect(snapshot?.run_status).toBe("active");

    // Verify events include start event
    const events = store.readEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("start");
    expect(events[0].from_state).toBeNull();
    expect(events[0].to_state).toBe("start");
  });

  test("uses provided run ID", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, runId: "my-custom-run", root, json: false });

    const store = new Store(root);
    expect(store.runExists("my-custom-run")).toBe(true);
    const snapshot = store.readSnapshot("my-custom-run");
    expect(snapshot?.state).toBe("start");
  });
});

// ─── run command — system prompt ─────────────────────────────────

describe("run command — system prompt", () => {
  test("system prompt is built from FSM guide field", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, root, json: false });

    const mockQuery = vi.mocked(query);
    expect(mockQuery).toHaveBeenCalledTimes(1);

    const callArgs = mockQuery.mock.calls[0][0];
    const options = callArgs.options;
    expect(options).toBeDefined();

    // systemPrompt should contain the guide text
    const systemPrompt = options?.systemPrompt as string;
    expect(typeof systemPrompt).toBe("string");
    expect(systemPrompt).toContain("Test guide for the workflow");
    expect(systemPrompt).toContain("FSM Guide");
  });

  test("system prompt handles missing guide field", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath: noGuideFsmPath, root, json: false });

    const mockQuery = vi.mocked(query);
    const callArgs = mockQuery.mock.calls[0][0];
    const systemPrompt = callArgs.options?.systemPrompt as string;
    expect(systemPrompt).toContain("No guide provided.");
  });
});

// ─── run command — run ID auto-generation ────────────────────────

describe("run command — run ID auto-generation", () => {
  test("auto-generated run ID follows <name>-<timestamp> format", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, root, json: false });

    const store = new Store(root);
    const runs = store.listRuns();
    expect(runs).toHaveLength(1);

    // Run ID should match <basename>-<timestamp> pattern
    // basename of "minimal.yaml" without extension = "minimal"
    const runId = runs[0];
    expect(runId).toMatch(/^minimal-\d+$/);
  });
});

// ─── run command — query invocation ──────────────────────────────

describe("run command — query invocation", () => {
  test("initial message is formatStateCard() of initial state", async () => {
    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, root, json: false });

    const mockQuery = vi.mocked(query);
    const callArgs = mockQuery.mock.calls[0][0];

    // prompt should be a string containing the state card
    const prompt = callArgs.prompt as string;
    expect(typeof prompt).toBe("string");
    expect(prompt).toContain("You are in **start** state.");
    expect(prompt).toContain("Begin here.");
    expect(prompt).toContain("next → done");
  });

  test("prints result message to stdout", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockQueryResult([
      {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        result: "Agent completed the task",
        stop_reason: null,
        total_cost_usd: 0.01,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage,
    ]);

    await run({ fsmPath, root, json: false });

    // Verify result was printed to stdout
    const calls = writeSpy.mock.calls.map((c) => String(c[0]));
    const output = calls.join("");
    expect(output).toContain("Agent completed the task");

    writeSpy.mockRestore();
  });
});
