import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { loadFsm } from "../fsm.js";
import { runCli } from "./e2e/helpers.js";
import { cleanupTempDir, createTempDir, uniqueRunId } from "./fixtures.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

/** Workflow where the initial state is a subagent state */
const SUBAGENT_INITIAL_FSM = `
version: 1.3
guide: "Subagent workflow"
initial: work
states:
  work:
    prompt: "Do the heavy lifting."
    subagent: true
    transitions:
      complete: done
  done:
    prompt: "Finished."
    transitions: {}
`;

/** Mixed workflow: greet (normal) → work (subagent) → done */
const MIXED_FSM = `
version: 1.3
guide: "Mixed workflow"
initial: greet
states:
  greet:
    prompt: "Say hello."
    transitions:
      next: work
  work:
    prompt: "Do the heavy lifting."
    subagent: true
    transitions:
      complete: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmSubagentInitial: string;
let fsmMixed: string;

beforeAll(() => {
  tmp = createTempDir("subagent-dispatch");
  fsmSubagentInitial = join(tmp, "subagent-initial.yaml");
  fsmMixed = join(tmp, "mixed.yaml");
  writeFileSync(fsmSubagentInitial, SUBAGENT_INITIAL_FSM, "utf-8");
  writeFileSync(fsmMixed, MIXED_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

const defaultRoot = () => join(tmp, "root");

// ─── Test 10: current always uses normal format ──────────────────────

describe("current: always normal format (no dispatch)", () => {
  test("shows raw state prompt even for subagent states", () => {
    const id = uniqueRunId("current-sub");
    runCli(`start ${fsmSubagentInitial} --run-id ${id}`, {
      root: defaultRoot(),
    });
    const { stdout, exitCode } = runCli(`current --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Your instructions:");
    expect(stdout).toContain("Do the heavy lifting.");
    expect(stdout).not.toContain("subagent execution");
  });
});

// ─── Test 11: Mixed workflow transitions ─────────────────────────────

describe("mixed workflow: normal and subagent states", () => {
  test("start (normal) → goto work (subagent dispatch) → current (normal) → goto done (normal)", () => {
    const id = uniqueRunId("mixed-e2e");
    const root = join(tmp, "mixed-root");

    // Start on greet (normal state) — should have normal card
    const startResult = runCli(`start ${fsmMixed} --run-id ${id}`, { root });
    expect(startResult.exitCode).toBe(0);
    expect(startResult.stdout).toContain("Your instructions:");
    expect(startResult.stdout).toContain("Say hello.");
    expect(startResult.stdout).not.toContain("subagent execution");

    // Goto work (subagent state) — should have dispatch card
    const gotoWork = runCli(`goto work --run-id ${id} --on next`, { root });
    expect(gotoWork.exitCode).toBe(0);
    expect(gotoWork.stdout).toContain("subagent execution");
    expect(gotoWork.stdout).not.toContain("Your instructions:");

    // Current on work (subagent state) — should have normal card
    const current = runCli(`current --run-id ${id}`, { root });
    expect(current.exitCode).toBe(0);
    expect(current.stdout).toContain("Your instructions:");
    expect(current.stdout).toContain("Do the heavy lifting.");
    expect(current.stdout).not.toContain("subagent execution");

    // Goto done (normal terminal state) — should have normal card
    const gotoDone = runCli(`goto done --run-id ${id} --on complete`, {
      root,
    });
    expect(gotoDone.exitCode).toBe(0);
    expect(gotoDone.stdout).toContain("terminal state");
    expect(gotoDone.stdout).not.toContain("subagent execution");
  });
});

// ─── from: inheritance of subagent flag ───────────────────────────

describe("subagent — from: inheritance", () => {
  test("child inherits subagent: true from base when not overridden", () => {
    const fsm = loadFsm(fixture("child-inherit-subagent.workflow.yaml"));
    expect(fsm.states.start.subagent).toBe(true);
  });
});

// ─── from: override of subagent flag ──────────────────────────────

describe("subagent — from: override", () => {
  test("child overrides subagent: true with subagent: false", () => {
    const fsm = loadFsm(fixture("child-override-subagent.workflow.yaml"));
    expect(fsm.states.start.subagent).toBe(false);
  });
});
