import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FsmError, loadFsm } from "../fsm.js";
import { formatReminder, formatStateCard, stateCardFromFsm } from "../output.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- Schema & Validation ---

describe("loadFsm — version support", () => {
  test("version 1.2 is accepted", () => {
    const fsm = loadFsm(fixture("v12-basic.workflow.yaml"));
    expect(fsm.version).toBe(1.2);
    expect(fsm.initial).toBe("start");
  });

  test("version 1.3 is rejected", () => {
    expect(() => loadFsm(fixture("v13-basic.workflow.yaml"))).toThrow(FsmError);
    try {
      loadFsm(fixture("v13-basic.workflow.yaml"));
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
    }
  });
});

describe("loadFsm — workflow field validation", () => {
  test("workflow + from → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-workflow-from.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/mutually exclusive/);
    }
  });

  test("workflow + prompt → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-workflow-prompt.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/prompt/);
    }
  });

  test("workflow without transitions → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-workflow-no-transitions.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/transitions/);
    }
  });

  test("workflow with version 1 → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-workflow-v1.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/version 1\.2/);
    }
  });
});

describe("STATE_NAME_RE — slash-separated names", () => {
  test("allows foo/bar/baz", () => {
    // This is tested implicitly by loading a composed workflow with namespaced states
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));
    // After expansion, should have build/create, build/review, build/done
    expect(fsm.states["build/create"]).toBeDefined();
    expect(fsm.states["build/review"]).toBeDefined();
    expect(fsm.states["build/done"]).toBeDefined();
  });

  test("rejects foo//bar state name", () => {
    try {
      loadFsm(fixture("compose-bad-name-double-slash.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
    }
  });

  test("rejects /foo state name", () => {
    try {
      loadFsm(fixture("compose-bad-name-leading-slash.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
    }
  });

  test("rejects workflow state with todos", () => {
    try {
      loadFsm(fixture("compose-workflow-todos.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/cannot have "todos"/);
    }
  });

  test("rejects workflow state with append_todos", () => {
    try {
      loadFsm(fixture("compose-workflow-append-todos.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/cannot have "append_todos"/);
    }
  });
});

// --- Expansion Engine ---

describe("loadFsm — workflow composition: basic expansion", () => {
  test("expands workflow state into namespaced child states", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Original workflow state "build" should be removed
    expect(fsm.states.build).toBeUndefined();

    // Child states should be namespaced
    expect(fsm.states["build/create"]).toBeDefined();
    expect(fsm.states["build/review"]).toBeDefined();
    expect(fsm.states["build/done"]).toBeDefined();

    // Prompts should be preserved
    expect(fsm.states["build/create"].prompt).toBe("Create something.");
    expect(fsm.states["build/review"].prompt).toBe("Review what was created.");
  });
});

describe("loadFsm — workflow composition: transition rewriting", () => {
  test("child internal transitions are prefixed with parent state name", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // create → review should become build/create → build/review
    expect(fsm.states["build/create"].transitions.next).toBe("build/review");

    // review → create should become build/review → build/create
    expect(fsm.states["build/review"].transitions.rejected).toBe("build/create");
  });
});

describe("loadFsm — workflow composition: done-state exit mapping", () => {
  test("child done transitions replaced by parent transitions", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Child's done state should have parent's transitions
    expect(fsm.states["build/done"].transitions).toEqual({
      completed: "done",
    });
  });
});

describe("loadFsm — workflow composition: initial state redirect", () => {
  test("parent initial is workflow state → becomes state/child-initial", () => {
    const fsm = loadFsm(fixture("compose-initial-redirect.workflow.yaml"));

    // Parent initial was "build", child initial was "create"
    // So it should become "build/create"
    expect(fsm.initial).toBe("build/create");
  });
});

describe("loadFsm — workflow composition: multiple workflow states", () => {
  test("both expand independently", () => {
    const fsm = loadFsm(fixture("compose-multiple.workflow.yaml"));

    // First workflow (child-simple) under "first"
    expect(fsm.states["first/create"]).toBeDefined();
    expect(fsm.states["first/review"]).toBeDefined();
    expect(fsm.states["first/done"]).toBeDefined();

    // Second workflow (child-no-guide) under "second"
    expect(fsm.states["second/step-one"]).toBeDefined();
    expect(fsm.states["second/done"]).toBeDefined();

    // First's done transitions point to "second" which was a workflow state
    // After expansion of "second", the target should be "second/step-one" (the initial)
    // Wait - actually the first/done transitions should have {completed: "second"}
    // But "second" no longer exists. The self-ref handling should rewrite it.
    // Actually, looking at the spec: parent transitions target parent-level states.
    // "second" is also a workflow state that gets expanded. So "first/done" targets "second"
    // but "second" doesn't exist anymore. This means self-referencing transitions that
    // target other workflow states need special handling.
    // Per the spec item (i): the parent's declared transitions target parent-level states,
    // no prefix is needed. But if those targets are also workflow states, after expansion
    // they won't exist. Let me re-read the algorithm...
    // The expansion iterates all states. When "first" is expanded, its done gets
    // {completed: "second"}. Then "second" is expanded. The target "second" in
    // first/done should be rewritten to "second/<initial>".
    // Actually, I think we need a post-pass to rewrite any transition targets that
    // point to removed workflow states → point to their entry points instead.

    // Let me check: first/done should transition to second's entry point
    expect(fsm.states["first/done"].transitions.completed).toBe("second/step-one");

    // second/done should transition to parent done
    expect(fsm.states["second/done"].transitions.completed).toBe("done");

    // Initial should be redirected
    expect(fsm.initial).toBe("first/create");
  });
});

describe("loadFsm — workflow composition: nested composition", () => {
  test("A→B→C produces a/b/c naming", () => {
    const fsm = loadFsm(fixture("compose-nested.workflow.yaml"));

    // outer → child-nested-middle, which has nested → child-nested-inner
    // child-nested-middle states: mid-start, nested (workflow), done
    // After expanding nested in middle: mid-start, nested/inner-start, nested/done, done
    // After expanding outer in parent: outer/mid-start, outer/nested/inner-start, outer/nested/done, outer/done

    expect(fsm.states["outer/mid-start"]).toBeDefined();
    expect(fsm.states["outer/nested/inner-start"]).toBeDefined();
    expect(fsm.states["outer/nested/done"]).toBeDefined();
    expect(fsm.states["outer/done"]).toBeDefined();

    // Verify triple-nested naming
    expect(fsm.states["outer/nested/inner-start"].prompt).toBe("Inner start.");

    // outer/done should have parent transitions
    expect(fsm.states["outer/done"].transitions).toEqual({
      completed: "done",
    });

    // Initial should chain: outer → mid-start
    expect(fsm.initial).toBe("outer/mid-start");
  });
});

describe("loadFsm — workflow composition: circular reference", () => {
  test("detects circular reference and throws SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-circular-a.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/circular/i);
    }
  });
});

describe("loadFsm — workflow composition: namespace collision", () => {
  test("throws SCHEMA_INVALID when expanded state collides with existing", () => {
    try {
      loadFsm(fixture("compose-collision.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/conflicts/);
    }
  });
});

describe("loadFsm — workflow composition: self-referencing transition", () => {
  test("parent transition targeting workflow state itself → targets entry point", () => {
    const fsm = loadFsm(fixture("compose-self-ref.workflow.yaml"));

    // build/done has transitions: completed → done, retry → build
    // Since "build" was expanded, retry should point to build's entry: build/create
    expect(fsm.states["build/done"].transitions.retry).toBe("build/create");
    expect(fsm.states["build/done"].transitions.completed).toBe("done");
  });
});

// --- Guide Scoping ---

describe("loadFsm — workflow composition: guide scoping", () => {
  test("child with guide → expanded states have state.guide set", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // child-simple has guide "Child guide for simple workflow."
    expect(fsm.states["build/create"].guide).toBe("Child guide for simple workflow.");
    expect(fsm.states["build/review"].guide).toBe("Child guide for simple workflow.");
    expect(fsm.states["build/done"].guide).toBe("Child guide for simple workflow.");
  });

  test("child without guide → no state.guide", () => {
    const fsm = loadFsm(fixture("compose-no-guide.workflow.yaml"));

    expect(fsm.states["build/step-one"].guide).toBeUndefined();
    expect(fsm.states["build/done"].guide).toBeUndefined();
  });
});

describe("output — guide scoping", () => {
  test("state card rendering uses state.guide over fsm.guide", () => {
    const fsmState = {
      prompt: "Do something.",
      transitions: { next: "done" },
      guide: "State-level guide.",
    };
    const card = stateCardFromFsm("test-state", fsmState);
    const output = formatStateCard(card, "Fsm-level guide.");

    // Should contain state-level guide, not fsm-level guide
    expect(output).toContain("State-level guide.");
    expect(output).not.toContain("Fsm-level guide.");
  });

  test("state card rendering falls back to fsm.guide when no state.guide", () => {
    const fsmState = {
      prompt: "Do something.",
      transitions: { next: "done" },
    };
    const card = stateCardFromFsm("test-state", fsmState);
    const output = formatStateCard(card, "Fsm-level guide.");

    expect(output).toContain("Fsm-level guide.");
  });

  test("state card rendering works with no guide at all", () => {
    const fsmState = {
      prompt: "Do something.",
      transitions: { next: "done" },
    };
    const card = stateCardFromFsm("test-state", fsmState);
    const output = formatStateCard(card);

    expect(output).toContain("Do something.");
    expect(output).not.toContain("guide");
  });

  test("reminder rendering uses state.guide over fsm.guide", () => {
    const fsmState = {
      prompt: "Do something.",
      transitions: { next: "done" },
      guide: "State-level guide.",
    };
    const card = stateCardFromFsm("test-state", fsmState);
    const output = formatReminder(card, "Fsm-level guide.");

    expect(output).toContain("State-level guide.");
    expect(output).not.toContain("Fsm-level guide.");
  });

  test("reminder rendering falls back to fsm.guide when no state.guide", () => {
    const fsmState = {
      prompt: "Do something.",
      transitions: { next: "done" },
    };
    const card = stateCardFromFsm("test-state", fsmState);
    const output = formatReminder(card, "Fsm-level guide.");

    expect(output).toContain("Fsm-level guide.");
  });
});
