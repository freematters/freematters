import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the agent SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { createFsmMcpServer } from "../commands/run.js";
import { loadFsm } from "../fsm.js";
import { Store } from "../store.js";

const MINIMAL_FSM = `
version: 1
guide: "Test guide for the workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: middle
  middle:
    prompt: "Middle step."
    transitions:
      finish: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmPath: string;
let root: string;

// Capture tool handlers registered via tool()
let toolHandlers: Record<
  string,
  (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
>;
let toolDefinitions: Array<{ name: string; handler: unknown }>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-mcp-test-"));
  fsmPath = join(tmp, "test.yaml");
  writeFileSync(fsmPath, MINIMAL_FSM, "utf-8");
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
  mockCreateServer.mockImplementation(((opts: { name?: string }) => {
    return { type: "sdk", name: opts?.name ?? "freefsm", instance: {} };
  }) as typeof createSdkMcpServer);
});

// Helper: directly create MCP tools (bypasses run() and its retry loop)
function setupHandlers(): {
  handlers: typeof toolHandlers;
  runId: string;
  store: Store;
} {
  const runId = "test-run";
  const store = new Store(root);
  const fsm = loadFsm(fsmPath);

  store.initRun(runId, fsmPath);
  store.commit(
    runId,
    {
      event: "start",
      from_state: null,
      to_state: fsm.initial,
      on_label: null,
      actor: "system",
      reason: null,
    },
    { run_status: "active", state: fsm.initial },
  );

  createFsmMcpServer(fsm, store, runId);
  return { handlers: toolHandlers, runId, store };
}

// ─── MCP tool registration ──────────────────────────────────────

describe("MCP tool registration", () => {
  test("registers fsm_goto and fsm_current tools", () => {
    setupHandlers();

    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("fsm_goto");
    expect(names).toContain("fsm_current");
  });

  test("createSdkMcpServer is called with tool definitions", () => {
    setupHandlers();

    const mockCreateServer = vi.mocked(createSdkMcpServer);
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
    const opts = mockCreateServer.mock.calls[0][0] as { tools?: unknown[] };
    expect(opts.tools).toHaveLength(2);
  });
});

// ─── fsm_goto handler ────────────────────────────────────────────

describe("fsm_goto handler", () => {
  test("validates transition and commits event via Store", async () => {
    const { handlers, runId, store } = setupHandlers();

    // Current state is "start", valid transition: next → middle
    await handlers.fsm_goto({ target: "middle", on: "next" }, {});

    // Check store was updated
    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.state).toBe("middle");
    expect(snapshot?.run_status).toBe("active");

    // Check events — should have start + goto
    const events = store.readEvents(runId);
    expect(events).toHaveLength(2);
    expect(events[1].event).toBe("goto");
    expect(events[1].from_state).toBe("start");
    expect(events[1].to_state).toBe("middle");
    expect(events[1].on_label).toBe("next");
  });

  test("returns new state card on success", async () => {
    const { handlers } = setupHandlers();

    const result = (await handlers.fsm_goto({ target: "middle", on: "next" }, {})) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("middle");
    expect(result.content[0].text).toContain("Middle step.");
  });

  test("returns error text (not throw) on invalid transition", async () => {
    const { handlers } = setupHandlers();

    // Try an invalid transition from "start"
    const result = (await handlers.fsm_goto({ target: "done", on: "invalid" }, {})) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    // Should return error content, not throw
    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("invalid");
  });

  test("returns error on nonexistent target state", async () => {
    const { handlers } = setupHandlers();

    const result = (await handlers.fsm_goto(
      { target: "nonexistent", on: "next" },
      {},
    )) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nonexistent");
  });
});

// ─── fsm_current handler ────────────────────────────────────────

describe("fsm_current handler", () => {
  test("returns current state card", async () => {
    const { handlers } = setupHandlers();

    const result = (await handlers.fsm_current({}, {})) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    // Should be in "start" state (initial state)
    expect(result.content[0].text).toContain("start");
    expect(result.content[0].text).toContain("Begin here.");
  });

  test("returns updated state card after goto", async () => {
    const { handlers } = setupHandlers();

    // Transition to middle
    await handlers.fsm_goto({ target: "middle", on: "next" }, {});

    // Now fsm_current should return middle state
    const result = (await handlers.fsm_current({}, {})) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain("middle");
    expect(result.content[0].text).toContain("Middle step.");
  });
});

// ─── Terminal state detection ───────────────────────────────────

describe("terminal state detection", () => {
  test("fsm_goto to terminal state includes workflow complete note", async () => {
    const { handlers } = setupHandlers();

    // Go start → middle → done
    await handlers.fsm_goto({ target: "middle", on: "next" }, {});
    const result = (await handlers.fsm_goto({ target: "done", on: "finish" }, {})) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain("terminal state");
    expect(result.content[0].text).toContain("complete");
  });

  test("fsm_goto to terminal state sets run_status to completed", async () => {
    const { handlers, runId, store } = setupHandlers();

    await handlers.fsm_goto({ target: "middle", on: "next" }, {});
    await handlers.fsm_goto({ target: "done", on: "finish" }, {});

    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.run_status).toBe("completed");
    expect(snapshot?.state).toBe("done");
  });

  test("fsm_goto returns error when run is not active (completed)", async () => {
    const { handlers } = setupHandlers();

    // Transition to terminal state
    await handlers.fsm_goto({ target: "middle", on: "next" }, {});
    await handlers.fsm_goto({ target: "done", on: "finish" }, {});

    // Try to transition again — run is completed
    const result = (await handlers.fsm_goto({ target: "middle", on: "next" }, {})) as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not active");
  });
});
