import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadFsm } from "../fsm.js";
import { formatStateCard, fsmToMermaid, stateCardFromFsm } from "../output.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- Test 1: Full pipeline — load and render state card ---

describe("integration: full pipeline — load and render state card", () => {
  test("composed workflow initial state card has namespaced name, prompt, and transitions", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Initial state should be "setup" (non-workflow state)
    expect(fsm.initial).toBe("setup");

    const state = fsm.states[fsm.initial];
    const card = stateCardFromFsm(fsm.initial, state);
    const output = formatStateCard(card, fsm.guide);

    expect(output).toContain("**setup**");
    expect(output).toContain("Setup the project.");
    expect(output).toContain("ready");
  });

  test("composed workflow namespaced state card renders correctly", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Verify a namespaced child state renders with full namespace
    const childState = fsm.states["build/create"];
    const card = stateCardFromFsm("build/create", childState);
    const output = formatStateCard(card, fsm.guide);

    expect(output).toContain("**build/create**");
    expect(output).toContain("Create something.");
    // Should use child guide, not parent guide (parent has no guide here)
    expect(output).toContain("Child guide for simple workflow.");
    // Check transitions are rendered
    expect(output).toContain("next");
    expect(output).toContain("build/review");
  });

  test("initial-redirect workflow starts at namespaced child initial", () => {
    const fsm = loadFsm(fixture("compose-initial-redirect.workflow.yaml"));

    expect(fsm.initial).toBe("build/create");

    const state = fsm.states[fsm.initial];
    const card = stateCardFromFsm(fsm.initial, state);
    const output = formatStateCard(card, fsm.guide);

    expect(output).toContain("**build/create**");
    expect(output).toContain("Create something.");
  });
});

// --- Test 2: Navigate through composed workflow ---

describe("integration: navigate through composed workflow", () => {
  test("state cards at each step show correct names and transitions", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Step 1: setup → build (which redirects to build/create)
    const setupCard = stateCardFromFsm("setup", fsm.states.setup);
    const setupOutput = formatStateCard(setupCard, fsm.guide);
    expect(setupOutput).toContain("**setup**");
    expect(setupOutput).toContain("ready");

    // Simulate goto: setup --on ready → build, which expanded to build/create
    // (the transition target is "build" but after expansion it's gone;
    //  actually checking the fixture: setup transitions to "build" but
    //  "build" was replaced by build/create, build/review, build/done.
    //  However, "build" in the transition target isn't rewritten because
    //  it's a non-workflow-state's transition. Let me check...)
    // Actually, the post-pass in resolveWorkflowStates rewrites targets
    // that point to removed workflow states → entry points.
    expect(fsm.states.setup.transitions.ready).toBe("build/create");

    // Step 2: build/create
    const createCard = stateCardFromFsm("build/create", fsm.states["build/create"]);
    const createOutput = formatStateCard(createCard, fsm.guide);
    expect(createOutput).toContain("**build/create**");
    expect(createOutput).toContain("Create something.");
    expect(createOutput).toContain("next");
    expect(createOutput).toContain("build/review");

    // Step 3: build/review
    const reviewCard = stateCardFromFsm("build/review", fsm.states["build/review"]);
    const reviewOutput = formatStateCard(reviewCard, fsm.guide);
    expect(reviewOutput).toContain("**build/review**");
    expect(reviewOutput).toContain("Review what was created.");
    expect(reviewOutput).toContain("approved");
    expect(reviewOutput).toContain("build/done");
    expect(reviewOutput).toContain("rejected");
    expect(reviewOutput).toContain("build/create");

    // Step 4: build/done — child→parent boundary
    const buildDoneCard = stateCardFromFsm("build/done", fsm.states["build/done"]);
    const buildDoneOutput = formatStateCard(buildDoneCard, fsm.guide);
    expect(buildDoneOutput).toContain("**build/done**");
    // build/done should have parent's transitions: completed → done
    expect(buildDoneOutput).toContain("completed");
    expect(buildDoneOutput).toContain("done");

    // Step 5: done — terminal state
    const doneCard = stateCardFromFsm("done", fsm.states.done);
    const doneOutput = formatStateCard(doneCard, fsm.guide);
    expect(doneOutput).toContain("**done**");
    expect(doneOutput).toContain("terminal state");
  });

  test("multi-workflow navigation across two children", () => {
    const fsm = loadFsm(fixture("compose-multiple.workflow.yaml"));

    // Initial is first/create (redirected from first)
    expect(fsm.initial).toBe("first/create");

    // Navigate first child: create → review → done
    expect(fsm.states["first/create"].transitions.next).toBe("first/review");
    expect(fsm.states["first/review"].transitions.approved).toBe("first/done");

    // Cross boundary: first/done transitions to second's entry
    expect(fsm.states["first/done"].transitions.completed).toBe("second/step-one");

    // Navigate second child: step-one → done
    expect(fsm.states["second/step-one"].transitions.next).toBe("second/done");

    // Cross boundary: second/done transitions to parent done
    expect(fsm.states["second/done"].transitions.completed).toBe("done");

    // Verify state cards render at each boundary
    const firstDoneCard = stateCardFromFsm("first/done", fsm.states["first/done"]);
    const firstDoneOutput = formatStateCard(firstDoneCard, fsm.guide);
    expect(firstDoneOutput).toContain("**first/done**");
    expect(firstDoneOutput).toContain("second/step-one");

    const secondDoneCard = stateCardFromFsm("second/done", fsm.states["second/done"]);
    const secondDoneOutput = formatStateCard(secondDoneCard, fsm.guide);
    expect(secondDoneOutput).toContain("**second/done**");
    expect(secondDoneOutput).toContain("done");
  });
});

// --- Test 3: Composed workflow with `from:` in child states ---

describe("integration: composed workflow with from: in child states", () => {
  test("from: resolution works correctly within expanded child states", () => {
    const fsm = loadFsm(fixture("compose-child-with-from.workflow.yaml"));

    // The child workflow uses from: to inherit from a base.
    // After expansion, phase/start should have the merged prompt and todos.
    expect(fsm.states["phase/start"]).toBeDefined();
    expect(fsm.states["phase/start"].prompt).toContain("Base child start.");
    expect(fsm.states["phase/start"].prompt).toContain("Extended with from.");

    // Todos should be merged: base todo + appended todo
    expect(fsm.states["phase/start"].todos).toEqual(["Base todo A", "Appended todo B"]);

    // Transitions should be namespaced
    expect(fsm.states["phase/start"].transitions.next).toBe("phase/done");

    // Done state gets parent transitions
    expect(fsm.states["phase/done"].transitions.completed).toBe("done");

    // Verify state card renders the merged content
    const card = stateCardFromFsm("phase/start", fsm.states["phase/start"]);
    const output = formatStateCard(card, fsm.guide);
    expect(output).toContain("**phase/start**");
    expect(output).toContain("Base child start.");
    expect(output).toContain("Extended with from.");
    expect(output).toContain("Base todo A");
    expect(output).toContain("Appended todo B");
  });
});

// --- Test 4: Composed workflow with extends_guide on child ---

describe("integration: composed workflow with extends_guide on child", () => {
  test("guide inheritance chain works with composition", () => {
    const fsm = loadFsm(fixture("compose-extends-guide.workflow.yaml"));

    // Parent has guide "Parent-level guide."
    expect(fsm.guide).toBe("Parent-level guide.");

    // Child used extends_guide from base-with-guide, merging with {{base}}.
    // The child's resolved guide should be "Base guide content.\nExtra child rules for compose.\n"
    const childState = fsm.states["sub/step"];
    expect(childState.guide).toBeDefined();
    expect(childState.guide).toContain("Base guide content.");
    expect(childState.guide).toContain("Extra child rules for compose.");

    // State card for child state should use state.guide (child's), not parent guide
    const childCard = stateCardFromFsm("sub/step", childState);
    const childOutput = formatStateCard(childCard, fsm.guide);
    expect(childOutput).toContain("Base guide content.");
    expect(childOutput).toContain("Extra child rules for compose.");
    expect(childOutput).not.toContain("Parent-level guide.");

    // State card for parent-level state should use fsm.guide
    const doneCard = stateCardFromFsm("done", fsm.states.done);
    const doneOutput = formatStateCard(doneCard, fsm.guide);
    expect(doneOutput).toContain("Parent-level guide.");
    expect(doneOutput).not.toContain("Extra child rules for compose.");
  });
});

// --- Test 5: Mermaid visualization ---

describe("integration: Mermaid visualization of composed workflows", () => {
  test("basic composed workflow produces correct Mermaid diagram", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));
    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    // Header
    expect(mermaid).toContain("stateDiagram-v2");

    // Initial arrow points to setup (non-namespaced)
    expect(mermaid).toContain("[*] --> setup");

    // Setup transitions
    expect(mermaid).toContain("setup --> build/create: ready");

    // Namespaced child transitions
    expect(mermaid).toContain("build/create --> build/review: next");
    expect(mermaid).toContain("build/review --> build/done: approved");
    expect(mermaid).toContain("build/review --> build/create: rejected");

    // Done-state exit transition (child done → parent done)
    expect(mermaid).toContain("build/done --> done: completed");

    // Terminal done state
    expect(mermaid).toContain("done --> [*]");
  });

  test("initial-redirect workflow Mermaid starts at namespaced state", () => {
    const fsm = loadFsm(fixture("compose-initial-redirect.workflow.yaml"));
    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    // Initial arrow should point to the namespaced child initial
    expect(mermaid).toContain("[*] --> build/create");
  });

  test("nested composed workflow Mermaid has triple-namespaced states", () => {
    const fsm = loadFsm(fixture("compose-nested.workflow.yaml"));
    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    expect(mermaid).toContain("[*] --> outer/mid-start");
    expect(mermaid).toContain("outer/mid-start --> outer/nested/inner-start: next");
    expect(mermaid).toContain("outer/nested/inner-start --> outer/nested/done: next");
    expect(mermaid).toContain("outer/nested/done --> outer/done: completed");
    expect(mermaid).toContain("outer/done --> done: completed");
    expect(mermaid).toContain("done --> [*]");
  });

  test("multi-workflow Mermaid has correct cross-boundary transitions", () => {
    const fsm = loadFsm(fixture("compose-multiple.workflow.yaml"));
    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    expect(mermaid).toContain("[*] --> first/create");
    // Cross-boundary: first/done → second/step-one
    expect(mermaid).toContain("first/done --> second/step-one: completed");
    // second/done → done
    expect(mermaid).toContain("second/done --> done: completed");
  });
});
