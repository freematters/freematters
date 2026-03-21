import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createFsmTools } from "../commands/run.js";
import { loadFsm } from "../fsm.js";
import type { Fsm } from "../fsm.js";
import { Store } from "../store.js";
import {
  LINEAR_3STATE_FSM,
  cleanupTempDir,
  createTempDir,
  writeFsmFile,
} from "./fixtures.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

let tmp: string;
let fsmPath: string;
let fsm: Fsm;

beforeAll(() => {
  tmp = createTempDir("mcp-test");
  fsmPath = writeFsmFile(tmp, "test.yaml", LINEAR_3STATE_FSM);
  fsm = loadFsm(fsmPath);
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let store: Store;
let runId: string;
let tools: ReturnType<typeof createFsmTools>;
let runCounter = 0;

beforeEach(() => {
  runCounter++;
  runId = `test-run-${runCounter}`;
  store = new Store(createTempDir("mcp-root"));

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

  tools = createFsmTools(fsm, store, runId);
});

// ─── fsm_goto handler ────────────────────────────────────────────

describe("fsm_goto handler", () => {
  test("valid transition commits event and updates snapshot", async () => {
    await tools.fsm_goto({ target: "middle", on: "next" }, {});

    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.state).toBe("middle");
    expect(snapshot?.run_status).toBe("active");

    const events = store.readEvents(runId);
    expect(events).toHaveLength(2);
    expect(events[1].event).toBe("goto");
    expect(events[1].from_state).toBe("start");
    expect(events[1].to_state).toBe("middle");
    expect(events[1].on_label).toBe("next");
  });

  test("returns state card on success", async () => {
    const result = (await tools.fsm_goto(
      { target: "middle", on: "next" },
      {},
    )) as ToolResult;

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("middle");
    expect(result.content[0].text).toContain("Middle step.");
  });

  test("returns error content (not throw) on invalid transition", async () => {
    const result = (await tools.fsm_goto(
      { target: "done", on: "invalid" },
      {},
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("invalid");
  });

  test("returns error on nonexistent target state", async () => {
    const result = (await tools.fsm_goto(
      { target: "nonexistent", on: "next" },
      {},
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nonexistent");
  });
});

// ─── fsm_current handler ────────────────────────────────────────

describe("fsm_current handler", () => {
  test("returns current state card", async () => {
    const result = (await tools.fsm_current({}, {})) as ToolResult;

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("start");
    expect(result.content[0].text).toContain("Begin here.");
  });

  test("returns updated card after goto", async () => {
    await tools.fsm_goto({ target: "middle", on: "next" }, {});

    const result = (await tools.fsm_current({}, {})) as ToolResult;

    expect(result.content[0].text).toContain("middle");
    expect(result.content[0].text).toContain("Middle step.");
  });
});

// ─── Terminal state detection ───────────────────────────────────

describe("terminal state detection", () => {
  test("goto to done includes 'terminal state' note", async () => {
    await tools.fsm_goto({ target: "middle", on: "next" }, {});
    const result = (await tools.fsm_goto(
      { target: "done", on: "finish" },
      {},
    )) as ToolResult;

    expect(result.content[0].text).toContain("terminal state");
    expect(result.content[0].text).toContain("complete");
  });

  test("sets run_status to completed", async () => {
    await tools.fsm_goto({ target: "middle", on: "next" }, {});
    await tools.fsm_goto({ target: "done", on: "finish" }, {});

    const snapshot = store.readSnapshot(runId);
    expect(snapshot?.run_status).toBe("completed");
    expect(snapshot?.state).toBe("done");
  });

  test("returns error when run is completed", async () => {
    await tools.fsm_goto({ target: "middle", on: "next" }, {});
    await tools.fsm_goto({ target: "done", on: "finish" }, {});

    const result = (await tools.fsm_goto(
      { target: "middle", on: "next" },
      {},
    )) as ToolResult;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not active");
  });
});
