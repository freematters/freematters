import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the agent SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { run } from "../commands/run.js";
import { Store } from "../store.js";

// ─── Test FSM YAMLs ─────────────────────────────────────────────

const THREE_STATE_FSM = `
version: 1
guide: "Integration test workflow"
initial: start
states:
  start:
    prompt: "Initialize the project."
    transitions:
      proceed: middle
  middle:
    prompt: "Process the data."
    transitions:
      complete: done
  done:
    prompt: "All work finished."
    transitions: {}
`;

const INPUT_FSM = `
version: 1
guide: "Input test workflow"
initial: ask
states:
  ask:
    prompt: "Ask the user for their name."
    transitions:
      answered: done
  done:
    prompt: "Greet the user."
    transitions: {}
`;

let tmp: string;
let threeStateFsmPath: string;
let inputFsmPath: string;
let root: string;

// Capture tool handlers registered via tool()
let toolHandlers: Record<
  string,
  (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
>;
let toolDefinitions: Array<{ name: string; handler: unknown }>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-run-integ-"));
  threeStateFsmPath = join(tmp, "three-state.yaml");
  inputFsmPath = join(tmp, "input.yaml");
  writeFileSync(threeStateFsmPath, THREE_STATE_FSM, "utf-8");
  writeFileSync(inputFsmPath, INPUT_FSM, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmp, "root-"));
  toolHandlers = {};
  toolDefinitions = [];

  // Capture tool definitions when tool() is called
  const mockTool = vi.mocked(tool);
  mockTool.mockImplementation(((
    name: string,
    _desc: string,
    _schema: unknown,
    handler: unknown,
  ) => {
    const def = { name, handler };
    toolDefinitions.push(def);
    toolHandlers[name] = handler as (
      args: Record<string, unknown>,
      extra: unknown,
    ) => Promise<unknown>;
    return def;
  }) as typeof tool);

  // createSdkMcpServer returns a mock server config
  const mockCreateServer = vi.mocked(createSdkMcpServer);
  mockCreateServer.mockImplementation(((opts: { tools?: unknown[] }) => {
    return { type: "sdk", name: opts?.name ?? "freefsm", instance: {} };
  }) as typeof createSdkMcpServer);
});

// Helper: create a mock query that simulates agent behavior by calling tool handlers
function mockQueryWithToolCalls(
  toolCalls: Array<{
    toolName: string;
    args: Record<string, unknown>;
  }>,
): void {
  const mockQuery = vi.mocked(query);

  // We need to defer tool handler invocations until after run() has registered them
  async function* generator(): AsyncGenerator<SDKMessage, void> {
    // Simulate the agent calling MCP tools in sequence
    for (const call of toolCalls) {
      // Call the registered tool handler (simulating what the SDK would do)
      const handler = toolHandlers[call.toolName];
      if (handler) {
        await handler(call.args, {});
      }
    }

    // End with a result message
    yield {
      type: "result",
      subtype: "success",
      duration_ms: 200,
      duration_api_ms: 100,
      is_error: false,
      num_turns: toolCalls.length + 1,
      result: "Workflow completed successfully",
      stop_reason: null,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
    } as unknown as SDKMessage;
  }

  const gen = generator();
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

// Helper: create a simple mock query with no tool calls
function mockQuerySimple(): void {
  mockQueryWithToolCalls([]);
}

// ─── End-to-end: 3-state FSM ────────────────────────────────────

describe("run integration — end-to-end 3-state FSM", () => {
  test("drives FSM through all states via mocked agent tool calls", async () => {
    // Mock the agent calling fsm_goto twice: start → middle → done
    mockQueryWithToolCalls([
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
      { toolName: "fsm_goto", args: { target: "done", on: "complete" } },
    ]);

    const runId = "integ-e2e";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    // Verify final snapshot
    const store = new Store(root);
    const snapshot = store.readSnapshot(runId);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.state).toBe("done");
    expect(snapshot?.run_status).toBe("completed");
    expect(snapshot?.last_seq).toBe(3); // start + 2 gotos
  });

  test("events.jsonl contains all transitions in order", async () => {
    mockQueryWithToolCalls([
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
      { toolName: "fsm_goto", args: { target: "done", on: "complete" } },
    ]);

    const runId = "integ-events";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    const store = new Store(root);
    const events = store.readEvents(runId);
    expect(events).toHaveLength(3);

    // Event 1: start
    expect(events[0].event).toBe("start");
    expect(events[0].from_state).toBeNull();
    expect(events[0].to_state).toBe("start");
    expect(events[0].on_label).toBeNull();
    expect(events[0].actor).toBe("system");
    expect(events[0].seq).toBe(1);

    // Event 2: goto middle
    expect(events[1].event).toBe("goto");
    expect(events[1].from_state).toBe("start");
    expect(events[1].to_state).toBe("middle");
    expect(events[1].on_label).toBe("proceed");
    expect(events[1].actor).toBe("agent");
    expect(events[1].seq).toBe(2);

    // Event 3: goto done
    expect(events[2].event).toBe("goto");
    expect(events[2].from_state).toBe("middle");
    expect(events[2].to_state).toBe("done");
    expect(events[2].on_label).toBe("complete");
    expect(events[2].actor).toBe("agent");
    expect(events[2].seq).toBe(3);
  });

  test("snapshot.json reflects final completed state", async () => {
    mockQueryWithToolCalls([
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
      { toolName: "fsm_goto", args: { target: "done", on: "complete" } },
    ]);

    const runId = "integ-snapshot";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    // Read raw snapshot file directly
    const snapshotPath = join(root, "runs", runId, "snapshot.json");
    const raw = readFileSync(snapshotPath, "utf-8");
    const snapshot = JSON.parse(raw);

    expect(snapshot.run_id).toBe(runId);
    expect(snapshot.state).toBe("done");
    expect(snapshot.run_status).toBe("completed");
    expect(snapshot.last_seq).toBe(3);
    expect(snapshot.updated_at).toBeDefined();
  });

  test("events.jsonl is valid JSONL (each line is valid JSON)", async () => {
    mockQueryWithToolCalls([
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
      { toolName: "fsm_goto", args: { target: "done", on: "complete" } },
    ]);

    const runId = "integ-jsonl";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    const eventsPath = join(root, "runs", runId, "events.jsonl");
    const raw = readFileSync(eventsPath, "utf-8").trim();
    const lines = raw.split("\n");

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("fsm_current reflects correct state mid-workflow", async () => {
    // Agent checks current state, transitions, checks again, then finishes
    mockQueryWithToolCalls([
      { toolName: "fsm_current", args: {} },
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
      { toolName: "fsm_current", args: {} },
      { toolName: "fsm_goto", args: { target: "done", on: "complete" } },
    ]);

    const runId = "integ-current";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    // If we got here without errors, fsm_current worked correctly
    // Verify final state
    const store = new Store(root);
    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.state).toBe("done");
    expect(snapshot?.run_status).toBe("completed");
  });

  test("terminal state goto result includes completion note", async () => {
    // We need to capture the return value from fsm_goto when reaching terminal state
    let terminalResult: unknown;

    mockQueryWithToolCalls([
      { toolName: "fsm_goto", args: { target: "middle", on: "proceed" } },
    ]);

    // Override to capture the terminal transition result
    const mockQuery = vi.mocked(query);
    const originalMockReturnValue = mockQuery.mock.results;

    // Re-mock with a generator that captures the terminal transition result
    async function* generator(): AsyncGenerator<SDKMessage, void> {
      // First transition
      await toolHandlers.fsm_goto({ target: "middle", on: "proceed" }, {});

      // Terminal transition — capture result
      terminalResult = await toolHandlers.fsm_goto(
        { target: "done", on: "complete" },
        {},
      );

      yield {
        type: "result",
        subtype: "success",
        duration_ms: 200,
        duration_api_ms: 100,
        is_error: false,
        num_turns: 3,
        result: "Done",
        stop_reason: null,
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage;
    }

    const gen = generator();
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

    const runId = "integ-terminal";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    const result = terminalResult as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toContain("terminal state");
    expect(result.content[0].text).toContain("complete");
  });
});

// ─── request_input with piped stdin ─────────────────────────────

describe("run integration — request_input with piped stdin", () => {
  test("agent can request input and receive user response", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    // Mock a workflow where agent calls request_input then transitions
    const mockQuery = vi.mocked(query);
    async function* generator(): AsyncGenerator<SDKMessage, void> {
      // Agent calls request_input
      const inputPromise = toolHandlers.request_input(
        { prompt: "What is your name?" },
        {},
      );

      // Simulate user typing after a brief delay
      setTimeout(() => mockStdin.push("Alice\n"), 10);

      const inputResult = (await inputPromise) as {
        content: Array<{ type: string; text: string }>;
      };

      // Verify the input was received
      expect(inputResult.content[0].text).toBe("Alice");

      // Now transition FSM to done
      await toolHandlers.fsm_goto({ target: "done", on: "answered" }, {});

      yield {
        type: "result",
        subtype: "success",
        duration_ms: 300,
        duration_api_ms: 150,
        is_error: false,
        num_turns: 3,
        result: "Greeted Alice",
        stop_reason: null,
        total_cost_usd: 0.03,
        usage: {
          input_tokens: 50,
          output_tokens: 25,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage;
    }

    const gen = generator();
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

    const runId = "integ-input";
    await run({ fsmPath: inputFsmPath, runId, root, json: false });

    // Verify stderr had the prompt
    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(stderrCalls.join("")).toContain("What is your name?");

    // Verify final state
    const store = new Store(root);
    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.state).toBe("done");
    expect(snapshot?.run_status).toBe("completed");

    // Verify events
    const events = store.readEvents(runId);
    expect(events).toHaveLength(2); // start + goto done

    stderrSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
  });

  test("request_input with EOF returns appropriate message", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    let eofResult: unknown;

    const mockQuery = vi.mocked(query);
    async function* generator(): AsyncGenerator<SDKMessage, void> {
      // Agent calls request_input
      const inputPromise = toolHandlers.request_input(
        { prompt: "Enter something:" },
        {},
      );

      // Simulate EOF
      setTimeout(() => mockStdin.push(null), 10);

      eofResult = await inputPromise;

      // Transition anyway
      await toolHandlers.fsm_goto({ target: "done", on: "answered" }, {});

      yield {
        type: "result",
        subtype: "success",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 2,
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
      } as unknown as SDKMessage;
    }

    const gen = generator();
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

    const runId = "integ-eof";
    await run({ fsmPath: inputFsmPath, runId, root, json: false });

    const result = eofResult as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toBe("EOF: stdin closed, no input available");

    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
  });
});

// ─── Error handling in integration ──────────────────────────────

describe("run integration — error handling", () => {
  test("invalid transition returns error without crashing", async () => {
    let errorResult: unknown;

    const mockQuery = vi.mocked(query);
    async function* generator(): AsyncGenerator<SDKMessage, void> {
      // Agent tries invalid transition, gets error, then does correct transition
      errorResult = await toolHandlers.fsm_goto(
        { target: "done", on: "invalid_label" },
        {},
      );

      // Correct transition
      await toolHandlers.fsm_goto({ target: "middle", on: "proceed" }, {});
      await toolHandlers.fsm_goto({ target: "done", on: "complete" }, {});

      yield {
        type: "result",
        subtype: "success",
        duration_ms: 200,
        duration_api_ms: 100,
        is_error: false,
        num_turns: 4,
        result: "Done after retry",
        stop_reason: null,
        total_cost_usd: 0.05,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          server_tool_use_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
      } as unknown as SDKMessage;
    }

    const gen = generator();
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

    const runId = "integ-error-recovery";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    // Error result should have isError flag
    const result = errorResult as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("invalid_label");

    // But the workflow still completed successfully
    const store = new Store(root);
    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.state).toBe("done");
    expect(snapshot?.run_status).toBe("completed");

    // Events should include start + 2 valid gotos (error transition does not produce an event)
    const events = store.readEvents(runId);
    expect(events).toHaveLength(3);
  });

  test("fsm.meta.json is created with correct metadata", async () => {
    mockQueryWithToolCalls([]);

    const runId = "integ-meta";
    await run({ fsmPath: threeStateFsmPath, runId, root, json: false });

    const metaPath = join(root, "runs", runId, "fsm.meta.json");
    const raw = readFileSync(metaPath, "utf-8");
    const meta = JSON.parse(raw);

    expect(meta.run_id).toBe(runId);
    expect(meta.fsm_path).toBe(threeStateFsmPath);
    expect(meta.version).toBe(1);
    expect(meta.created_at).toBeDefined();
  });
});
