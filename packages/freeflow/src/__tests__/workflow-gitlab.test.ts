import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { type Fsm, loadFsm } from "../fsm.js";

const WORKFLOWS = resolve(
  import.meta.dirname ?? __dirname,
  "../../workflows",
);

function workflow(name: string): string {
  return resolve(WORKFLOWS, name, "workflow.yaml");
}

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

// --- gitlab-spec-gen ---

describe("gitlab-spec-gen workflow", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1.1);
    expect(fsm.initial).toBe("create-issue");
  });

  test("has all expected states", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    const expectedStates = [
      "create-issue",
      "requirements",
      "research",
      "design",
      "plan",
      "e2e-gen",
      "done",
    ];
    for (const name of expectedStates) {
      expect(fsm.states[name]).toBeDefined();
    }
    expect(Object.keys(fsm.states)).toHaveLength(expectedStates.length);
  });

  test("each state prompt contains base content and GitLab Adaptation", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    // States that use from: with GitLab Adaptation
    const fromStates = ["requirements", "research", "design", "plan", "e2e-gen"];
    for (const name of fromStates) {
      expect(fsm.states[name].prompt).toContain("GitLab Adaptation");
    }
  });

  test("research state has only 'back to requirements' transition", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    const research = fsm.states.research;
    expect(research.transitions).toEqual({
      "back to requirements": "requirements",
    });
    // Explicitly verify no "proceed to design" transition
    expect(research.transitions["proceed to design"]).toBeUndefined();
  });

  test("done state is terminal", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    expect(fsm.states.done.transitions).toEqual({});
  });

  test("guide contains base spec-gen guide and GitLab override", () => {
    fsm = loadFsm(workflow("gitlab-spec-gen"));
    expect(fsm.guide).toContain("Spec-Gen");
    expect(fsm.guide).toContain("GitLab Issue Override");
  });
});

// --- gitlab-mr-lifecycle ---

describe("gitlab-mr-lifecycle workflow", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(workflow("gitlab-mr-lifecycle"));
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1);
    expect(fsm.initial).toBe("create-mr");
  });

  test("has all expected states", () => {
    fsm = loadFsm(workflow("gitlab-mr-lifecycle"));
    const expectedStates = [
      "create-mr",
      "poll",
      "fix",
      "rebase",
      "address",
      "push",
      "done",
    ];
    for (const name of expectedStates) {
      expect(fsm.states[name]).toBeDefined();
    }
    expect(Object.keys(fsm.states)).toHaveLength(expectedStates.length);
  });

  test("poll state has correct transitions", () => {
    fsm = loadFsm(workflow("gitlab-mr-lifecycle"));
    expect(fsm.states.poll.transitions).toEqual({
      "needs fix": "fix",
      "needs rebase": "rebase",
      "needs address": "address",
      "MR merged": "done",
      "MR closed": "done",
    });
  });

  test("done state is terminal", () => {
    fsm = loadFsm(workflow("gitlab-mr-lifecycle"));
    expect(fsm.states.done.transitions).toEqual({});
  });
});

// --- gitlab-issue-to-mr (composition) ---

describe("gitlab-issue-to-mr workflow — composition", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1.2);
    expect(fsm.initial).toBe("start");
  });

  test("gitlab-spec-gen states expanded under spec/ prefix", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    const specStates = [
      "spec/create-issue",
      "spec/requirements",
      "spec/research",
      "spec/design",
      "spec/plan",
      "spec/e2e-gen",
      "spec/done",
    ];
    for (const name of specStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("spec-to-code states expanded under implement/ prefix", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    const implementStates = [
      "implement/setup",
      "implement/implement",
      "implement/review",
    ];
    for (const name of implementStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("gitlab-mr-lifecycle states expanded under submit-mr/ prefix", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    const mrStates = ["submit-mr/create-mr", "submit-mr/poll"];
    for (const name of mrStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("spec/done transitions to decide (composition exit mapping)", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm.states["spec/done"].transitions).toEqual({
      completed: "decide",
    });
  });

  test("implement/done transitions to confirm-mr", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm.states["implement/done"].transitions).toEqual({
      completed: "confirm-mr",
    });
  });

  test("submit-mr/done transitions to done", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm.states["submit-mr/done"].transitions).toEqual({
      completed: "done",
    });
  });

  test("inline states exist", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    const inlineStates = [
      "start",
      "decide",
      "confirm-implement",
      "confirm-mr",
      "done",
    ];
    for (const name of inlineStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("done state is terminal", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm.states.done.transitions).toEqual({});
  });

  test("start transitions to spec/create-issue", () => {
    fsm = loadFsm(workflow("gitlab-issue-to-mr"));
    expect(fsm.states.start.transitions.proceed).toBe("spec/create-issue");
  });
});

// --- github-pr-lifecycle (renamed from pr-lifecycle) ---

describe("github-pr-lifecycle workflow (renamed)", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(workflow("github-pr-lifecycle"));
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1);
    expect(fsm.initial).toBe("create-pr");
  });

  test("has all expected states", () => {
    fsm = loadFsm(workflow("github-pr-lifecycle"));
    const expectedStates = [
      "create-pr",
      "poll",
      "fix",
      "rebase",
      "address",
      "push",
      "done",
    ];
    for (const name of expectedStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("poll state has correct transitions", () => {
    fsm = loadFsm(workflow("github-pr-lifecycle"));
    expect(fsm.states.poll.transitions).toEqual({
      "needs fix": "fix",
      "needs rebase": "rebase",
      "needs address": "address",
      "PR merged": "done",
      "PR closed": "done",
    });
  });
});

// --- issue-to-pr backward compatibility ---

describe("issue-to-pr workflow — backward compatibility after rename", () => {
  let fsm: Fsm;

  test("loads without errors", () => {
    fsm = loadFsm(workflow("issue-to-pr"));
    expect(fsm).toBeDefined();
    expect(fsm.version).toBe(1.2);
    expect(fsm.initial).toBe("start");
  });

  test("still has expected inline states", () => {
    fsm = loadFsm(workflow("issue-to-pr"));
    const inlineStates = [
      "start",
      "decide",
      "confirm-implement",
      "confirm-pr",
      "done",
    ];
    for (const name of inlineStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("github-spec-gen states expanded under spec/ prefix", () => {
    fsm = loadFsm(workflow("issue-to-pr"));
    const specStates = [
      "spec/create-issue",
      "spec/requirements",
      "spec/research",
      "spec/design",
      "spec/plan",
    ];
    for (const name of specStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("github-pr-lifecycle states expanded under submit-pr/ prefix", () => {
    fsm = loadFsm(workflow("issue-to-pr"));
    const prStates = ["submit-pr/create-pr", "submit-pr/poll"];
    for (const name of prStates) {
      expect(fsm.states[name]).toBeDefined();
    }
  });

  test("spec/done transitions to decide", () => {
    fsm = loadFsm(workflow("issue-to-pr"));
    expect(fsm.states["spec/done"].transitions).toEqual({
      completed: "decide",
    });
  });
});

// --- Research transition constraint (both spec-gen variants) ---

describe("research state — transition constraints", () => {
  test("github-spec-gen research has only 'back to requirements'", () => {
    const fsm = loadFsm(workflow("github-spec-gen"));
    const research = fsm.states.research;
    expect(Object.keys(research.transitions)).toEqual([
      "back to requirements",
    ]);
    expect(research.transitions["back to requirements"]).toBe("requirements");
  });

  test("gitlab-spec-gen research has only 'back to requirements'", () => {
    const fsm = loadFsm(workflow("gitlab-spec-gen"));
    const research = fsm.states.research;
    expect(Object.keys(research.transitions)).toEqual([
      "back to requirements",
    ]);
    expect(research.transitions["back to requirements"]).toBe("requirements");
  });

  test("base spec-gen research has only 'back to requirements'", () => {
    const fsm = loadFsm(workflow("spec-gen"));
    const research = fsm.states.research;
    expect(Object.keys(research.transitions)).toEqual([
      "back to requirements",
    ]);
    expect(research.transitions["back to requirements"]).toBe("requirements");
  });
});
