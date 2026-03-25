import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FsmError, loadFsm } from "../fsm.js";
import {
  formatReminder,
  formatStateCard,
  fsmToMermaid,
  stateCardFromFsm,
} from "../output.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

/** Write a temp YAML and return its path. Uses child-simple.workflow.yaml as child ref. */
function tmpYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "fflow-test-"));
  const path = join(dir, "test.workflow.yaml");
  // Copy child-simple into the same dir so relative refs work
  const childSimple = `version: 1\nguide: "Child guide for simple workflow."\ninitial: create\nstates:\n  create:\n    prompt: "Create something."\n    transitions:\n      next: review\n  review:\n    prompt: "Review what was created."\n    transitions:\n      approved: done\n      rejected: create\n  done:\n    prompt: "Child done."\n    transitions: {}\n`;
  writeFileSync(join(dir, "child-simple.workflow.yaml"), childSimple);
  writeFileSync(path, content);
  return path;
}

// --- Schema & Validation ---

describe("workflow composition — schema validation", () => {
  test("version 1.2 and 1.3 accepted, 1.4 rejected", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));
    expect(fsm.version).toBe(1.2);

    const v13 = tmpYaml(
      "version: 1.3\ninitial: s\nstates:\n  s:\n    prompt: x\n    transitions:\n      n: done\n  done:\n    prompt: d\n    transitions: {}\n",
    );
    expect(() => loadFsm(v13)).not.toThrow();

    const v14 = tmpYaml(
      "version: 1.4\ninitial: s\nstates:\n  s:\n    prompt: x\n    transitions:\n      n: done\n  done:\n    prompt: d\n    transitions: {}\n",
    );
    expect(() => loadFsm(v14)).toThrow(FsmError);
  });

  test("rejects forbidden field combinations on workflow states", () => {
    const base = (extra: string) =>
      `version: 1.2\ninitial: build\nstates:\n  build:\n    workflow: ./child-simple.workflow.yaml\n${extra}    transitions:\n      completed: done\n  done:\n    prompt: d\n    transitions: {}\n`;

    const cases: [string, RegExp][] = [
      [base('    from: "x#y"\n'), /mutually exclusive/],
      [base('    prompt: "no"\n'), /prompt/],
      // no transitions
      [
        "version: 1.2\ninitial: build\nstates:\n  build:\n    workflow: ./child-simple.workflow.yaml\n  done:\n    prompt: d\n    transitions: {}\n",
        /transitions/,
      ],
      // version 1
      [
        "version: 1\ninitial: build\nstates:\n  build:\n    workflow: ./child-simple.workflow.yaml\n    transitions:\n      completed: done\n  done:\n    prompt: d\n    transitions: {}\n",
        /version 1\.2/,
      ],
      [base("    todos:\n      - nope\n"), /cannot have "todos"/],
      [base("    append_todos:\n      - nope\n"), /cannot have "append_todos"/],
    ];
    for (const [yaml, pattern] of cases) {
      try {
        loadFsm(tmpYaml(yaml));
        expect.fail(`Expected error for pattern ${pattern}`);
      } catch (e) {
        expect(e).toBeInstanceOf(FsmError);
        expect((e as FsmError).code).toBe("SCHEMA_INVALID");
        expect((e as FsmError).message).toMatch(pattern);
      }
    }
  });

  test("rejects invalid state names", () => {
    const bad = (name: string) =>
      tmpYaml(
        `version: 1.2\ninitial: "${name}"\nstates:\n  "${name}":\n    prompt: x\n    transitions:\n      n: done\n  done:\n    prompt: d\n    transitions: {}\n`,
      );
    expect(() => loadFsm(bad("foo//bar"))).toThrow(FsmError);
    expect(() => loadFsm(bad("/foo"))).toThrow(FsmError);
  });
});

// --- Expansion Engine ---

describe("workflow composition — basic expansion", () => {
  test("expands, namespaces, rewrites transitions, maps done exits, scopes guide", () => {
    const fsm = loadFsm(fixture("compose-basic.workflow.yaml"));

    // Original state removed, child states namespaced
    expect(fsm.states.build).toBeUndefined();
    expect(fsm.states["build/create"]).toBeDefined();
    expect(fsm.states["build/review"]).toBeDefined();
    expect(fsm.states["build/done"]).toBeDefined();

    // Prompts preserved
    expect(fsm.states["build/create"].prompt).toBe("Create something.");

    // Internal transitions prefixed
    expect(fsm.states["build/create"].transitions.next).toBe("build/review");
    expect(fsm.states["build/review"].transitions.rejected).toBe("build/create");

    // Done exits replaced by parent transitions
    expect(fsm.states["build/done"].transitions).toEqual({ completed: "done" });

    // Non-workflow state transitions rewritten to entry point
    expect(fsm.states.setup.transitions.ready).toBe("build/create");

    // Child guide propagated to expanded states
    expect(fsm.states["build/create"].guide).toBe("Child guide for simple workflow.");
    expect(fsm.states["build/done"].guide).toBe("Child guide for simple workflow.");
  });
});

describe("workflow composition — initial state redirect", () => {
  test("parent initial is workflow state → becomes state/child-initial", () => {
    const fsm = loadFsm(fixture("compose-initial-redirect.workflow.yaml"));
    expect(fsm.initial).toBe("build/create");
  });
});

describe("workflow composition — multiple and nested", () => {
  test("multiple workflow states expand independently with cross-boundary transitions", () => {
    const fsm = loadFsm(fixture("compose-multiple.workflow.yaml"));

    expect(fsm.initial).toBe("first/create");
    expect(fsm.states["first/done"].transitions.completed).toBe("second/step-one");
    expect(fsm.states["second/done"].transitions.completed).toBe("done");
  });

  test("nested A→B→C produces a/b/c naming and correct Mermaid", () => {
    const fsm = loadFsm(fixture("compose-nested.workflow.yaml"));

    expect(fsm.initial).toBe("outer/mid-start");
    expect(fsm.states["outer/nested/inner-start"]).toBeDefined();
    expect(fsm.states["outer/nested/inner-start"].prompt).toBe("Inner start.");
    expect(fsm.states["outer/done"].transitions).toEqual({ completed: "done" });

    const mermaid = fsmToMermaid(fsm.states, fsm.initial);
    expect(mermaid).toContain("[*] --> outer_mid_start");
    expect(mermaid).toContain("outer_mid_start: outer/mid-start");
    expect(mermaid).toContain("outer_nested_inner_start --> outer_nested_done: next");
  });
});

describe("workflow composition — error cases", () => {
  test("circular reference → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-circular-a.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).message).toMatch(/circular/i);
    }
  });

  test("namespace collision → SCHEMA_INVALID", () => {
    try {
      loadFsm(fixture("compose-collision.workflow.yaml"));
      expect.fail("Expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(FsmError);
      expect((e as FsmError).message).toMatch(/conflicts/);
    }
  });
});

describe("workflow composition — self-referencing transition", () => {
  test("parent transition targeting workflow state itself → targets entry point", () => {
    const fsm = loadFsm(fixture("compose-self-ref.workflow.yaml"));
    expect(fsm.states["build/done"].transitions.retry).toBe("build/create");
    expect(fsm.states["build/done"].transitions.completed).toBe("done");
  });
});

// --- Guide Scoping ---

describe("workflow composition — guide scoping", () => {
  test("child without guide → no state.guide", () => {
    const fsm = loadFsm(fixture("compose-no-guide.workflow.yaml"));
    expect(fsm.states["build/step-one"].guide).toBeUndefined();
  });

  test("child with extends_guide → merged guide on expanded states, separate from parent", () => {
    const fsm = loadFsm(fixture("compose-extends-guide.workflow.yaml"));

    expect(fsm.guide).toBe("Parent-level guide.");
    expect(fsm.states["sub/step"].guide).toContain("Base guide content.");
    expect(fsm.states["sub/step"].guide).toContain("Extra child rules for compose.");
    expect(fsm.states.done.guide).toBeUndefined();
  });
});

describe("workflow composition — output guide precedence", () => {
  test("state.guide overrides fsm.guide in state card and reminder", () => {
    const withGuide = {
      prompt: "Do something.",
      transitions: { next: "done" },
      guide: "State-level guide.",
    };
    const card = stateCardFromFsm("test", withGuide);

    // Guide is only rendered in fflow start header, not in formatStateCard
    // but the card still carries guide for formatReminder
    expect(card.guide).toBe("State-level guide.");
    expect(formatReminder(card, "Fsm-level guide.")).toContain("State-level guide.");
  });

  test("falls back to fsm.guide when no state.guide", () => {
    const noGuide = { prompt: "Do something.", transitions: { next: "done" } };
    const card = stateCardFromFsm("test", noGuide);

    expect(card.guide).toBeUndefined();
    expect(formatReminder(card, "Fsm-level guide.")).toContain("Fsm-level guide.");
  });
});

// --- Cross-cutting: from: inside composed children ---

describe("workflow composition — from: in child states", () => {
  test("from: resolution works within expanded child states", () => {
    const fsm = loadFsm(fixture("compose-child-with-from.workflow.yaml"));

    expect(fsm.states["phase/start"].prompt).toContain("Base child start.");
    expect(fsm.states["phase/start"].prompt).toContain("Extended with from.");
    expect(fsm.states["phase/start"].todos).toEqual(["Base todo A", "Appended todo B"]);
    expect(fsm.states["phase/start"].transitions.next).toBe("phase/done");
    expect(fsm.states["phase/done"].transitions.completed).toBe("done");
  });
});
