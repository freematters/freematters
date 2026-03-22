import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { type Fsm, loadFsm } from "../fsm.js";

const WORKFLOW = resolve(
  import.meta.dirname ?? __dirname,
  "../../workflows/issue-to-pr/workflow.yaml",
);

/**
 * Walk the FSM from a given state following the specified transition labels.
 * Returns the final state name after all transitions, or throws if a label is missing.
 */
function walkPath(fsm: Fsm, start: string, labels: string[]): string {
  let current = start;
  for (const label of labels) {
    const state = fsm.states[current];
    if (!state) {
      throw new Error(`state "${current}" not found`);
    }
    const next = state.transitions[label];
    if (!next) {
      throw new Error(
        `no transition "${label}" from "${current}" (available: ${Object.keys(state.transitions).join(", ")})`,
      );
    }
    current = next;
  }
  return current;
}

describe("issue-to-pr workflow — schema validation", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(WORKFLOW);
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1.2);
    expect(fsm.initial).toBe("start");
  });

  test("inline states exist", () => {
    fsm = loadFsm(WORKFLOW);
    const inlineStates = ["start", "decide", "confirm-implement", "confirm-pr", "done"];
    for (const name of inlineStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("github-spec-gen states expanded under spec/ prefix", () => {
    fsm = loadFsm(WORKFLOW);
    const specStates = [
      "spec/create-issue",
      "spec/requirements",
      "spec/design",
      "spec/plan",
    ];
    for (const name of specStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("spec-to-code states expanded under implement/ prefix", () => {
    fsm = loadFsm(WORKFLOW);
    const implementStates = [
      "implement/setup",
      "implement/implement",
      "implement/review",
    ];
    for (const name of implementStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("pr-lifecycle states expanded under submit-pr/ prefix", () => {
    fsm = loadFsm(WORKFLOW);
    const prStates = ["submit-pr/create-pr", "submit-pr/poll"];
    for (const name of prStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });
});

describe("issue-to-pr workflow — path reachability", () => {
  let fsm: Fsm;

  test("full auto path reaches done", () => {
    fsm = loadFsm(WORKFLOW);

    // start → spec/create-issue
    let state = walkPath(fsm, "start", ["new idea"]);
    expect(state).toBe("spec/create-issue");

    // Walk through spec-gen to spec/done
    state = walkPath(fsm, state, [
      "start with requirements",
      "fast forward",
      "design approved",
      "plan approved",
      "e2e plan generated",
    ]);
    expect(state).toBe("spec/done");

    // spec/done → decide → implement (full auto)
    state = walkPath(fsm, state, ["completed", "full auto"]);
    expect(state).toBe("implement/setup");

    // Walk through spec-to-code to implement/done
    state = walkPath(fsm, state, [
      "fast forward",
      "all steps complete",
      "no e2e plan",
      "fast forward",
    ]);
    expect(state).toBe("implement/done");

    // implement/done → confirm-pr → submit-pr
    state = walkPath(fsm, state, ["completed", "submit pr"]);
    expect(state).toBe("submit-pr/create-pr");

    // Walk through pr-lifecycle to submit-pr/done → done
    state = walkPath(fsm, state, ["PR ready", "PR merged", "completed"]);
    expect(state).toBe("done");
  });

  test("fast forward path reaches done", () => {
    fsm = loadFsm(WORKFLOW);

    // start → spec/create-issue
    let state = walkPath(fsm, "start", ["existing issue"]);
    expect(state).toBe("spec/create-issue");

    // Walk through spec-gen to spec/done
    state = walkPath(fsm, state, [
      "start with requirements",
      "fast forward",
      "design approved",
      "plan approved",
      "e2e plan generated",
    ]);
    expect(state).toBe("spec/done");

    // spec/done → decide → confirm-implement → implement
    state = walkPath(fsm, state, ["completed", "fast forward", "approved"]);
    expect(state).toBe("implement/setup");

    // Walk through spec-to-code to implement/done
    state = walkPath(fsm, state, [
      "ready",
      "all steps complete",
      "no e2e plan",
      "user approves",
      "finalize",
    ]);
    expect(state).toBe("implement/done");

    // implement/done → confirm-pr → submit-pr
    state = walkPath(fsm, state, ["completed", "submit pr"]);
    expect(state).toBe("submit-pr/create-pr");

    // Walk through pr-lifecycle to done
    state = walkPath(fsm, state, ["PR ready", "PR merged", "completed"]);
    expect(state).toBe("done");
  });
});
