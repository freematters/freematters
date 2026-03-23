import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadFsm } from "../fsm.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { cleanupTempDir, createTempDir } from "./fixtures.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- Mixed workflow YAML: plan (normal) -> execute (subagent) -> done ---

const MIXED_SUBAGENT_FSM = `
version: 1.3
guide: "Mixed subagent workflow"
initial: plan
states:
  plan:
    prompt: "Plan the work."
    transitions:
      ready: execute
  execute:
    prompt: "Execute the work."
    subagent: true
    transitions:
      complete: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmMixed: string;

beforeAll(() => {
  tmp = createTempDir("subagent-integ");
  fsmMixed = join(tmp, "mixed-subagent.yaml");
  writeFileSync(fsmMixed, MIXED_SUBAGENT_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "run"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultRoot = () => join(tmp, "root");

// --- Test A: Full lifecycle with JSON output ---

describe("subagent — full lifecycle with JSON output", () => {
  test("start shows subagent: false for normal state, goto shows subagent: true for subagent state", () => {
    const id = uniqueRunId("sub-lifecycle");
    const root = join(tmp, "lifecycle-root");

    // 1. Start — plan state has no subagent flag
    const startResult = runCliJson(`start ${fsmMixed} --run-id ${id}`, { root });
    expect(startResult.exitCode).toBe(0);
    const startData = startResult.envelope.data as Record<string, unknown>;
    expect(startData.state).toBe("plan");
    expect(startData.subagent).toBeUndefined();

    // 2. Goto execute — subagent state
    const gotoExec = runCliJson(`goto execute --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoExec.exitCode).toBe(0);
    const execData = gotoExec.envelope.data as Record<string, unknown>;
    expect(execData.state).toBe("execute");
    expect(execData.subagent).toBe(true);

    // 3. Current — subagent is a dispatch signal, NOT included in current
    const cur = runCliJson(`current --run-id ${id}`, { root });
    expect(cur.exitCode).toBe(0);
    const curData = cur.envelope.data as Record<string, unknown>;
    expect(curData.state).toBe("execute");
    expect(curData.subagent).toBeUndefined();

    // 4. Goto done — completes the workflow
    const gotoDone = runCliJson(`goto done --run-id ${id} --on complete`, {
      root,
    });
    expect(gotoDone.exitCode).toBe(0);
    const doneData = gotoDone.envelope.data as Record<string, unknown>;
    expect(doneData.state).toBe("done");
    expect(doneData.run_status).toBe("completed");
    // done state has no subagent flag
    expect(doneData.subagent).toBeUndefined();
  });
});

// --- Test B: from: inheritance of subagent flag ---

describe("subagent — from: inheritance", () => {
  test("child inherits subagent: true from base when not overridden", () => {
    const fsm = loadFsm(fixture("child-inherit-subagent.workflow.yaml"));
    expect(fsm.states.start.subagent).toBe(true);
  });
});

// --- Test C: from: override of subagent flag ---

describe("subagent — from: override", () => {
  test("child overrides subagent: true with subagent: false", () => {
    const fsm = loadFsm(fixture("child-override-subagent.workflow.yaml"));
    expect(fsm.states.start.subagent).toBe(false);
  });
});
