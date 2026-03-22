import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createFsmTools } from "../commands/run.js";
import type { Fsm } from "../fsm.js";
import { loadFsm } from "../fsm.js";
import { Store } from "../store.js";
import { MULTI_FSM, cleanupTempDir, createTempDir, writeFsmFile } from "./fixtures.js";

type ToolResult = {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
};

let tmp: string;
let fsmPath: string;
let fsm: Fsm;

beforeAll(() => {
  tmp = createTempDir("run-lite-test");
  fsmPath = writeFsmFile(tmp, "multi.yaml", MULTI_FSM);
  fsm = loadFsm(fsmPath);
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;

function setupRun(lite?: boolean) {
  runCounter++;
  const runId = `run-lite-${runCounter}`;
  const store = new Store(createTempDir("run-lite-root"));

  store.initRun(runId, fsmPath, lite);
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
    {
      run_status: "active",
      state: fsm.initial,
      ...(lite ? { visited_states: [fsm.initial] } : {}),
    },
  );

  const tools = createFsmTools(fsm, store, runId, () => {}, lite);
  return { store, runId, tools };
}

// ─── Lite mode in fsmGotoHandler ─────────────────────────────────

describe("run --lite: fsm_goto returns lite card on re-visit", () => {
  test("first visit returns full state card", async () => {
    const { tools } = setupRun(true);
    const result = (await tools.fsm_goto(
      { target: "review", on: "ready" },
      {},
    )) as ToolResult;

    expect(result.content[0].text).toContain("Your instructions:");
    expect(result.content[0].text).toContain("Review the work.");
  });

  test("re-visit returns lite card", async () => {
    const { tools } = setupRun(true);

    // start → review
    await tools.fsm_goto({ target: "review", on: "ready" }, {});
    // review → start (back to start, which was already visited)
    const result = (await tools.fsm_goto(
      { target: "start", on: "rejected" },
      {},
    )) as ToolResult;

    expect(result.content[0].text).toContain("Re-entering");
    expect(result.content[0].text).toContain("Instructions unchanged");
    expect(result.content[0].text).not.toContain("Your instructions:");
    // MCP path should reference fsm_current tool, not fflow CLI
    expect(result.content[0].text).toContain("fsm_current");
    expect(result.content[0].text).not.toContain("fflow current");
  });

  test("visited_states tracked in snapshot", async () => {
    const { tools, store, runId } = setupRun(true);

    await tools.fsm_goto({ target: "review", on: "ready" }, {});
    const snap = store.readSnapshot(runId);
    expect(snap?.visited_states).toEqual(["start", "review"]);
  });
});

describe("run without --lite: always full card", () => {
  test("re-visit still returns full state card", async () => {
    const { tools } = setupRun(false);

    // start → review → start
    await tools.fsm_goto({ target: "review", on: "ready" }, {});
    const result = (await tools.fsm_goto(
      { target: "start", on: "rejected" },
      {},
    )) as ToolResult;

    expect(result.content[0].text).toContain("Your instructions:");
    expect(result.content[0].text).not.toContain("Re-entering");
  });

  test("no visited_states in snapshot", async () => {
    const { tools, store, runId } = setupRun(false);

    await tools.fsm_goto({ target: "review", on: "ready" }, {});
    const snap = store.readSnapshot(runId);
    expect(snap?.visited_states).toBeUndefined();
  });
});
