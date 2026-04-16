import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FsmError, loadFsm } from "../fsm.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures", "extends");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- T1: Basic extends — no overrides ---

describe("loadFsm — extends: basic inheritance", () => {
  test("T1: child inherits parent's initial and all states", () => {
    const fsm = loadFsm(fixture("t1-child.workflow.yaml"));
    expect(fsm.initial).toBe("a");
    expect(Object.keys(fsm.states).sort()).toEqual(["a", "b", "done"]);
    expect(fsm.states.a.prompt).toBe("A");
    expect(fsm.states.b.prompt).toBe("B");
    expect(fsm.states.a.transitions).toEqual({ next: "b" });
    expect(fsm.states.b.transitions).toEqual({ finish: "done" });
  });
});

// --- T2: Child guide with {{ super }} ---

describe("loadFsm — extends: guide with {{ super }}", () => {
  test("T2: {{ super }} substitutes parent's guide", () => {
    const fsm = loadFsm(fixture("t2-child.workflow.yaml"));
    expect(fsm.guide).toBe("P1\nP2\nC1");
  });
});

// --- T3: Child guide without placeholder ---

describe("loadFsm — extends: guide override without placeholder", () => {
  test("T3: child guide fully replaces parent's", () => {
    const fsm = loadFsm(fixture("t3-child.workflow.yaml"));
    expect(fsm.guide).toBe("CHILD ONLY");
  });
});

// --- T4: Child extends a state prompt ---

describe("loadFsm — extends: state prompt with {{ super }}", () => {
  test("T4: state prompt {{ super }} substitutes parent state's prompt", () => {
    const fsm = loadFsm(fixture("t4-child.workflow.yaml"));
    expect(fsm.states.a.prompt).toBe("ORIGINAL\nEXTRA");
  });
});

// --- T5: Child merges transitions ---

describe("loadFsm — extends: transitions merge", () => {
  test("T5: {...parent, ...child} — child wins on conflict, parent survivors preserved", () => {
    const fsm = loadFsm(fixture("t5-child.workflow.yaml"));
    // parent a transitions: { next: b, skip: done }
    // child a transitions: { next: c, done: done }
    // expected merged: { next: c, skip: done, done: done }
    expect(fsm.states.a.transitions).toEqual({
      next: "c",
      skip: "done",
      done: "done",
    });
  });
});

// --- T6: Child adds new state + overrides initial ---

describe("loadFsm — extends: add new state + override initial", () => {
  test("T6: child initial overrides parent; new state coexists with inherited", () => {
    const fsm = loadFsm(fixture("t6-child.workflow.yaml"));
    expect(fsm.initial).toBe("x");
    expect(fsm.states.x).toBeDefined();
    expect(fsm.states.x.prompt).toBe("X");
    expect(fsm.states.x.transitions).toEqual({ enter: "a" });
    expect(fsm.states.a).toBeDefined();
    expect(fsm.states.a.prompt).toBe("A");
  });
});

// --- T7: {{ super }} with no parent content → empty string ---

describe("loadFsm — extends: {{ super }} with no parent content", () => {
  test("T7: brand-new child state with {{ super }} expands to empty", () => {
    const fsm = loadFsm(fixture("t7-child.workflow.yaml"));
    expect(fsm.states.z.prompt).toBe("\nhello");
  });
});

// --- T8: Circular extends detected ---

describe("loadFsm — extends: circular detection", () => {
  test("T8: circular extends chain throws SCHEMA_INVALID with chain in message", () => {
    let err: unknown;
    try {
      loadFsm(fixture("t8-a.workflow.yaml"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FsmError);
    const fsmErr = err as FsmError;
    expect(fsmErr.code).toBe("SCHEMA_INVALID");
    expect(fsmErr.message).toContain("circular reference detected");
    expect(fsmErr.message).toContain("t8-a.workflow.yaml");
    expect(fsmErr.message).toContain("t8-b.workflow.yaml");
    expect(fsmErr.message).toContain("→");
  });
});

// --- T9: Extends target not found ---

describe("loadFsm — extends: target not found", () => {
  test("T9: error message lists all attempted paths", () => {
    let err: unknown;
    try {
      loadFsm(fixture("t9-child.workflow.yaml"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FsmError);
    const fsmErr = err as FsmError;
    expect(fsmErr.code).toBe("SCHEMA_INVALID");
    // The attempted relative path (absolute form) must appear.
    expect(fsmErr.message).toContain("does-not-exist.yaml");
    // Error message must reference the "extends" feature by name.
    expect(fsmErr.message).toContain("extends");
  });
});

// --- T10: Transition target missing after merge ---

describe("loadFsm — extends: transition-target closure", () => {
  test("T10: error message lists ALL offending (state, label, target) triples", () => {
    let err: unknown;
    try {
      loadFsm(fixture("t10-child.workflow.yaml"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FsmError);
    const fsmErr = err as FsmError;
    expect(fsmErr.code).toBe("SCHEMA_INVALID");
    expect(fsmErr.message).toContain("missing_state");
    expect(fsmErr.message).toContain("another_missing");
    expect(fsmErr.message).toContain('"x"');
    expect(fsmErr.message).toContain('"go"');
    expect(fsmErr.message).toContain('"also"');
  });
});
