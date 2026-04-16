import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFsm } from "../fsm.js";

// T14 — Migration equivalence.
//
// The golden fixtures in fixtures/migration/ were captured from the legacy
// (pre-migration) YAML via the old `from:` + `extends_guide:` loader (see
// scripts/capture-migration-golden.mjs).
//
// After migration to the new top-level `extends:` syntax the loaded Fsm
// MUST preserve effective behavior on every state that existed pre-migration:
// guide text, initial state, and each state's prompt / transitions / todos / guide.
//
// Note: moving from `extends_guide:` (guide-only inheritance) to `extends:`
// (full state inheritance) legitimately adds parent states to the child's
// state set (e.g. `create-structure` from spec-gen). These extra inherited
// states are unreachable under the migrated `initial:` and do not affect the
// runtime behavior of the pre-existing states; we verify the pre-migration
// state set is a subset of the post-migration state set, with exact match on
// each common state.

const repoRoot = resolve(__dirname, "..", "..", "..", "..");

interface GoldenFsm {
  guide?: string;
  initial: string;
  states: Record<
    string,
    {
      prompt: string;
      transitions: Record<string, string>;
      todos?: string[];
      guide?: string;
      subagent?: boolean;
    }
  >;
}

function loadGolden(relPath: string): GoldenFsm {
  const absPath = resolve(__dirname, "fixtures", "migration", relPath);
  return JSON.parse(readFileSync(absPath, "utf-8")) as GoldenFsm;
}

function assertEquivalent(
  label: string,
  workflowRelPath: string,
  goldenFile: string,
): void {
  const fsm = loadFsm(resolve(repoRoot, workflowRelPath));
  const golden = loadGolden(goldenFile);

  expect(fsm.guide, `${label}: workflow-level guide mismatch`).toBe(golden.guide);
  expect(fsm.initial, `${label}: initial state mismatch`).toBe(golden.initial);

  for (const [name, goldenState] of Object.entries(golden.states)) {
    const migratedState = fsm.states[name];
    expect(
      migratedState,
      `${label}: pre-migration state "${name}" missing in migrated FSM`,
    ).toBeDefined();
    expect(migratedState.prompt, `${label}: prompt mismatch for state "${name}"`).toBe(
      goldenState.prompt,
    );
    expect(
      migratedState.transitions,
      `${label}: transitions mismatch for state "${name}"`,
    ).toEqual(goldenState.transitions);
    expect(migratedState.todos, `${label}: todos mismatch for state "${name}"`).toEqual(
      goldenState.todos,
    );
    expect(
      migratedState.guide,
      `${label}: per-state guide mismatch for state "${name}"`,
    ).toBe(goldenState.guide);
    expect(
      migratedState.subagent,
      `${label}: subagent mismatch for state "${name}"`,
    ).toBe(goldenState.subagent);
  }
}

describe("T14 — migration equivalence", () => {
  it("issue-to-spec: migrated FSM matches pre-migration golden fixture", () => {
    assertEquivalent(
      "issue-to-spec",
      "packages/freeflow/workflows/issue-to-spec/workflow.yaml",
      "issue-to-spec.golden.json",
    );
  });

  it("issue-to-pr: migrated FSM matches pre-migration golden fixture", () => {
    assertEquivalent(
      "issue-to-pr",
      "packages/freeflow/workflows/issue-to-pr/workflow.yaml",
      "issue-to-pr.golden.json",
    );
  });
});

describe("runtime smoke test — migrated workflows load cleanly", () => {
  it("issue-to-spec: loadFsm succeeds with expected initial state", () => {
    const fsm = loadFsm(
      resolve(repoRoot, "packages/freeflow/workflows/issue-to-spec/workflow.yaml"),
    );
    expect(fsm.initial).toBe("create-issue");
    expect(fsm.states[fsm.initial]).toBeDefined();
  });

  it("issue-to-pr: loadFsm succeeds with expected initial state", () => {
    const fsm = loadFsm(
      resolve(repoRoot, "packages/freeflow/workflows/issue-to-pr/workflow.yaml"),
    );
    expect(fsm.initial).toBe("start");
    expect(fsm.states[fsm.initial]).toBeDefined();
  });
});
