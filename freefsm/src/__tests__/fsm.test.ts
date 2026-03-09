import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { FsmError, loadFsm } from "../fsm.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-test-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeYaml(name: string, content: string): string {
  const p = join(tmp, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// Minimal valid FSM used as baseline for mutation tests
const MINIMAL_VALID = `
version: 1
guide: "A simple workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

// --- Valid cases ---

describe("loadFsm — valid inputs", () => {
  test("minimal valid FSM", () => {
    const p = writeYaml("valid-minimal.yaml", MINIMAL_VALID);
    const fsm = loadFsm(p);

    expect(fsm.version).toBe(1);
    expect(fsm.guide).toBe("A simple workflow");
    expect(fsm.initial).toBe("start");
    expect(Object.keys(fsm.states)).toEqual(expect.arrayContaining(["start", "done"]));
    expect(fsm.states.start.prompt).toBe("Begin here.");
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
    expect(fsm.states.done.prompt).toBe("Finished.");
    expect(fsm.states.done.transitions).toEqual({});
  });

  test("FSM with todos", () => {
    const p = writeYaml(
      "valid-todos.yaml",
      `
version: 1
guide: "Workflow with todos"
initial: start
states:
  start:
    prompt: "Do things."
    todos:
      - "Write code"
      - "Run tests"
    transitions:
      finish: done
  done:
    prompt: "Done."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.states.start.todos).toEqual(["Write code", "Run tests"]);
    expect(fsm.states.done.todos).toBeUndefined();
  });

  test("multi-state FSM with complex transitions", () => {
    const p = writeYaml(
      "valid-multi.yaml",
      `
version: 1
guide: "Multi-step workflow"
initial: plan
states:
  plan:
    prompt: "Plan the work."
    transitions:
      approved: implement
      rejected: plan
  implement:
    prompt: "Write code."
    transitions:
      tests-pass: review
      tests-fail: implement
  review:
    prompt: "Review the code."
    transitions:
      accepted: done
      changes-requested: implement
  done:
    prompt: "All done."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(Object.keys(fsm.states)).toHaveLength(4);
    expect(fsm.states.plan.transitions).toEqual({
      approved: "implement",
      rejected: "plan",
    });
    expect(fsm.states.review.transitions).toEqual({
      accepted: "done",
      "changes-requested": "implement",
    });
  });

  test("state names with hyphens and underscores", () => {
    const p = writeYaml(
      "valid-names.yaml",
      `
version: 1
guide: "Name test"
initial: step_1
states:
  step_1:
    prompt: "First."
    transitions:
      go: step-2
  step-2:
    prompt: "Second."
    transitions:
      finish: done
  done:
    prompt: "End."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.states.step_1).toBeDefined();
    expect(fsm.states["step-2"]).toBeDefined();
  });

  test("done state with transitions is valid", () => {
    const p = writeYaml(
      "valid-done-transitions.yaml",
      `
version: 1
guide: "Done with transitions"
initial: start
states:
  start:
    prompt: "Go."
    transitions:
      next: done
  done:
    prompt: "End."
    transitions:
      restart: start
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.states.done.transitions).toEqual({ restart: "start" });
  });
});

// --- Invalid cases ---

function expectSchemaInvalid(yaml: string, name: string, msgMatch?: RegExp) {
  const p = writeYaml(name, yaml);
  try {
    loadFsm(p);
    expect.fail(`Expected FsmError for ${name}`);
  } catch (e) {
    expect(e).toBeInstanceOf(FsmError);
    expect((e as FsmError).code).toBe("SCHEMA_INVALID");
    if (msgMatch) {
      expect((e as FsmError).message).toMatch(msgMatch);
    }
  }
}

describe("loadFsm — invalid YAML structure", () => {
  test("not a mapping (string)", () => {
    expectSchemaInvalid("just a string", "invalid-string.yaml", /mapping/);
  });

  test("not a mapping (array)", () => {
    expectSchemaInvalid("- item1\n- item2", "invalid-array.yaml", /mapping/);
  });

  test("empty document", () => {
    expectSchemaInvalid("", "invalid-empty.yaml", /mapping/);
  });
});

describe("loadFsm — top-level field validation", () => {
  test("missing version", () => {
    expectSchemaInvalid(
      `
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-no-version.yaml",
      /version/,
    );
  });

  test("wrong version (2)", () => {
    expectSchemaInvalid(
      `
version: 2
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-version-2.yaml",
      /version.*must be 1/,
    );
  });

  test("missing guide is valid", () => {
    const p = writeYaml(
      "valid-no-guide.yaml",
      `
version: 1
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.guide).toBeUndefined();
  });

  test("empty guide", () => {
    expectSchemaInvalid(
      `
version: 1
guide: ""
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-empty-guide.yaml",
      /guide/,
    );
  });

  test("missing initial", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-no-initial.yaml",
      /initial/,
    );
  });

  test("missing states", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
`,
      "invalid-no-states.yaml",
      /states/,
    );
  });

  test("empty states", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states: {}
`,
      "invalid-empty-states.yaml",
      /non-empty/,
    );
  });

  test("states is an array", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  - start
  - done
`,
      "invalid-states-array.yaml",
      /states.*object/,
    );
  });
});

describe("loadFsm — state name validation", () => {
  test("state name with spaces", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: "my state"
states:
  "my state":
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-name-spaces.yaml",
      /state name/,
    );
  });

  test("state name starting with digit", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: "1step"
states:
  "1step":
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-name-digit.yaml",
      /state name/,
    );
  });
});

describe("loadFsm — structural validation", () => {
  test("initial not in states", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: missing
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-initial-missing.yaml",
      /initial.*missing.*does not exist/,
    );
  });

  test("done state missing", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: end
  end:
    prompt: "x"
    transitions:
      back: start
`,
      "invalid-no-done.yaml",
      /done.*must exist/,
    );
  });

  test("state missing prompt", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-no-prompt.yaml",
      /prompt/,
    );
  });

  test("state with empty prompt", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: ""
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-empty-prompt.yaml",
      /prompt/,
    );
  });

  test("state missing transitions", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-no-transitions.yaml",
      /transitions/,
    );
  });

  test("non-done state with empty transitions", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions: {}
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-empty-transitions.yaml",
      /non-done.*must have at least one transition/,
    );
  });
});

describe("loadFsm — todo validation", () => {
  test("todos not an array", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    todos: "not an array"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-todos-string.yaml",
      /todos.*array/,
    );
  });

  test("empty todo item", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    todos:
      - "valid"
      - ""
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-empty-todo.yaml",
      /todo items.*non-empty/,
    );
  });

  test("duplicate todo items", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    todos:
      - "same task"
      - "same task"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-dup-todo.yaml",
      /duplicate todo/,
    );
  });
});

describe("loadFsm — transition validation", () => {
  test("transition target is unknown state", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: nowhere
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-unknown-target.yaml",
      /unknown state.*nowhere/,
    );
  });

  test("transition target is not a string", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    transitions:
      go: 42
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-target-number.yaml",
      /transition target/,
    );
  });
});

describe("loadFsm — file errors", () => {
  test("non-existent file throws", () => {
    expect(() => loadFsm("/tmp/does-not-exist.yaml")).toThrow();
  });
});
