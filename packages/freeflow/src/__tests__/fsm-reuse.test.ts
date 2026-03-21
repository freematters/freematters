import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { CliError } from "../errors.js";
import { FsmError, loadFsm } from "../fsm.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- Basic ref (no override) → inherits prompt + transitions + todos ---

describe("loadFsm — from ref: basic inheritance", () => {
  test("inherits prompt, transitions, and todos from base state", () => {
    const fsm = loadFsm(fixture("child-inherit.workflow.yaml"));
    expect(fsm.states.start.prompt).toBe("Base start prompt.");
    expect(fsm.states.start.transitions).toEqual({
      next: "review",
    });
    expect(fsm.states.start.todos).toEqual(["Base todo 1", "Base todo 2"]);
  });
});

// --- Prompt with {{base}} → correct insertion ---

describe("loadFsm — from ref: prompt with {{base}}", () => {
  test("inserts base prompt at {{base}} placeholder", () => {
    const fsm = loadFsm(fixture("child-prompt-base.workflow.yaml"));
    expect(fsm.states.start.prompt).toContain("Base start prompt.");
    expect(fsm.states.start.prompt).toContain("Extra child instructions.");
    // base prompt should come before child content
    const baseIdx = fsm.states.start.prompt.indexOf("Base start prompt.");
    const childIdx = fsm.states.start.prompt.indexOf("Extra child instructions.");
    expect(baseIdx).toBeLessThan(childIdx);
  });
});

// --- Prompt without {{base}} → full replace ---

describe("loadFsm — from ref: prompt without {{base}}", () => {
  test("completely replaces base prompt", () => {
    const fsm = loadFsm(fixture("child-prompt-replace.workflow.yaml"));
    expect(fsm.states.start.prompt).toBe("Completely new prompt.");
    expect(fsm.states.start.prompt).not.toContain("Base start prompt.");
  });
});

// --- Transitions merge → base + local, local wins ---

describe("loadFsm — from ref: transitions merge", () => {
  test("merges base and local transitions, local wins on conflict", () => {
    const fsm = loadFsm(fixture("child-transitions-merge.workflow.yaml"));
    // base had next: review, local overrides next: done and adds extra: review
    expect(fsm.states.start.transitions).toEqual({
      next: "done",
      extra: "review",
    });
  });
});

// --- Transitions not specified → inherit base ---

describe("loadFsm — from ref: transitions inherit", () => {
  test("inherits base transitions when not specified", () => {
    const fsm = loadFsm(fixture("child-inherit.workflow.yaml"));
    expect(fsm.states.start.transitions).toEqual({
      next: "review",
    });
  });
});

// --- Todos append → local appended after base ---

describe("loadFsm — from ref: todos append", () => {
  test("appends local todos after base todos", () => {
    const fsm = loadFsm(fixture("child-todos-append.workflow.yaml"));
    expect(fsm.states.start.todos).toEqual([
      "Base todo 1",
      "Base todo 2",
      "Child todo 1",
      "Child todo 2",
    ]);
  });
});

// --- Todos not specified → inherit base ---

describe("loadFsm — from ref: todos inherit", () => {
  test("inherits base todos when not specified", () => {
    const fsm = loadFsm(fixture("child-inherit.workflow.yaml"));
    expect(fsm.states.start.todos).toEqual(["Base todo 1", "Base todo 2"]);
  });
});

// --- Circular reference → SCHEMA_INVALID ---

describe("loadFsm — from ref: circular reference", () => {
  test("detects circular reference and throws SCHEMA_INVALID", () => {
    expect(() => loadFsm(fixture("circular-a.workflow.yaml"))).toThrow(FsmError);
    try {
      loadFsm(fixture("circular-a.workflow.yaml"));
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/circular/i);
    }
  });
});

// --- Chain ref A→B→C → correct resolution ---

describe("loadFsm — from ref: chain resolution", () => {
  test("resolves chain A→B→C correctly", () => {
    const fsm = loadFsm(fixture("chain-a.workflow.yaml"));
    // chain-a refs chain-b#start, chain-b refs chain-c#start
    // chain-c start prompt: "Chain C start prompt."
    // chain-b adds "Chain B addition." via {{base}}
    // chain-a inherits prompt from chain-b (no prompt override)
    expect(fsm.states.start.prompt).toContain("Chain C start prompt.");
    expect(fsm.states.start.prompt).toContain("Chain B addition.");
    // chain-a specifies todos ["A todo"], chain-b has no todos override so inherits chain-c ["C todo"]
    // chain-a appends to chain-b's resolved todos
    expect(fsm.states.start.todos).toEqual(["C todo", "A todo"]);
    // transitions inherited from chain-c via chain-b
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
  });
});

// --- Missing workflow → WORKFLOW_NOT_FOUND ---

describe("loadFsm — from ref: missing workflow", () => {
  test("throws WORKFLOW_NOT_FOUND for nonexistent workflow", () => {
    try {
      loadFsm(fixture("child-missing-workflow.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      // resolveWorkflow throws CliError with WORKFLOW_NOT_FOUND
      expect((e as CliError).code).toBe("WORKFLOW_NOT_FOUND");
    }
  });
});

// --- Missing state → SCHEMA_INVALID ---

describe("loadFsm — from ref: missing state", () => {
  test("throws SCHEMA_INVALID for nonexistent state in base", () => {
    try {
      loadFsm(fixture("child-missing-state.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/nonexistent/);
    }
  });
});

// --- Bad from format → SCHEMA_INVALID ---

describe("loadFsm — from ref: bad format", () => {
  test("throws SCHEMA_INVALID for from without #", () => {
    try {
      loadFsm(fixture("child-bad-from.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/format/);
    }
  });
});

// --- No from → backwards compatible ---

describe("loadFsm — from ref: backwards compatible", () => {
  test("workflows without from work exactly as before", () => {
    const fsm = loadFsm(fixture("base.workflow.yaml"));
    expect(fsm.version).toBe(1);
    expect(fsm.initial).toBe("start");
    expect(fsm.states.start.prompt).toBe("Base start prompt.");
    expect(fsm.states.start.transitions).toEqual({ next: "review" });
    expect(fsm.states.start.todos).toEqual(["Base todo 1", "Base todo 2"]);
    expect(fsm.states.review.prompt).toBe("Base review prompt.");
  });
});

// --- extends_guide tests ---

describe("loadFsm — extends_guide: guide with {{base}}", () => {
  test("inserts base guide at {{base}} placeholder", () => {
    const fsm = loadFsm(fixture("child-extends-guide-with-base.workflow.yaml"));
    expect(fsm.guide).toContain("Base guide content.");
    expect(fsm.guide).toContain("Extra child rules.");
    // base guide should come before child content
    // biome-ignore lint/style/noNonNullAssertion: guide is asserted non-null by prior toContain checks
    const baseIdx = fsm.guide!.indexOf("Base guide content.");
    // biome-ignore lint/style/noNonNullAssertion: guide is asserted non-null by prior toContain checks
    const childIdx = fsm.guide!.indexOf("Extra child rules.");
    expect(baseIdx).toBeLessThan(childIdx);
  });
});

describe("loadFsm — extends_guide: no local guide", () => {
  test("inherits base guide when local guide is not specified", () => {
    const fsm = loadFsm(fixture("child-extends-guide-no-local.workflow.yaml"));
    expect(fsm.guide).toBe("Base guide content.");
  });
});

describe("loadFsm — extends_guide: guide without {{base}}", () => {
  test("fully replaces base guide", () => {
    const fsm = loadFsm(fixture("child-extends-guide-replace.workflow.yaml"));
    expect(fsm.guide).toBe("Completely new guide.");
    expect(fsm.guide).not.toContain("Base guide content.");
  });
});

describe("loadFsm — extends_guide: missing workflow", () => {
  test("throws WORKFLOW_NOT_FOUND for nonexistent base workflow", () => {
    try {
      loadFsm(fixture("child-extends-guide-missing-workflow.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect((e as CliError).code).toBe("WORKFLOW_NOT_FOUND");
    }
  });
});

describe("loadFsm — extends_guide: base has no guide", () => {
  test("throws SCHEMA_INVALID when base workflow has no guide", () => {
    try {
      loadFsm(fixture("child-extends-guide-no-base-guide.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).code).toBe("SCHEMA_INVALID");
      expect((e as FsmError).message).toMatch(/has no guide/);
    }
  });
});

describe("loadFsm — extends_guide: not present", () => {
  test("behavior unchanged when extends_guide is absent", () => {
    const fsm = loadFsm(fixture("base-with-guide.workflow.yaml"));
    expect(fsm.guide).toBe("Base guide content.");
    expect(fsm.version).toBe(1);
  });
});
