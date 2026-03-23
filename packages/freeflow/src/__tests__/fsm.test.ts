import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { FsmError, loadFsm } from "../fsm.js";
import {
  MINIMAL_FSM,
  cleanupTempDir,
  createTempDir,
  writeFsmFile,
} from "./fixtures.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("test");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

function writeYaml(name: string, content: string): string {
  return writeFsmFile(tmp, name, content);
}

// --- Valid cases ---

describe("loadFsm — valid inputs", () => {
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
      /transition/,
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

describe("loadFsm — allowed_tools validation", () => {
  test("accepts YAML with allowed_tools field", () => {
    const p = writeYaml(
      "valid-allowed-tools.yaml",
      `
version: 1
guide: "Tool-restricted workflow"
initial: start
allowed_tools:
  - Read
  - Bash
  - Edit
states:
  start:
    prompt: "Do something."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.allowed_tools).toEqual(["Read", "Bash", "Edit"]);
  });

  test("accepts YAML without allowed_tools (backward compatible)", () => {
    const p = writeYaml("valid-no-allowed-tools.yaml", MINIMAL_FSM);
    const fsm = loadFsm(p);
    expect(fsm.allowed_tools).toBeUndefined();
  });

  test("allowed_tools must be an array", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
allowed_tools: "Read"
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-allowed-tools-string.yaml",
      /allowed_tools.*array/,
    );
  });

  test("allowed_tools items must be strings", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
allowed_tools:
  - Read
  - 42
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-allowed-tools-number.yaml",
      /allowed_tools.*must be non-empty strings/,
    );
  });

  test("allowed_tools items must be non-empty", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
allowed_tools:
  - Read
  - ""
states:
  start:
    prompt: "x"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-allowed-tools-empty-item.yaml",
      /allowed_tools.*must be non-empty strings/,
    );
  });
});

describe("loadFsm — subagent flag", () => {
  test("schema accepts subagent: true", () => {
    const p = writeYaml(
      "valid-subagent-true.yaml",
      `
version: 1.3
guide: "Subagent workflow"
initial: start
states:
  start:
    prompt: "Do things."
    subagent: true
    transitions:
      next: done
  done:
    prompt: "Done."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.states.start.subagent).toBe(true);
  });

  test("schema accepts subagent: false", () => {
    const p = writeYaml(
      "valid-subagent-false.yaml",
      `
version: 1.3
guide: "Subagent workflow"
initial: start
states:
  start:
    prompt: "Do things."
    subagent: false
    transitions:
      next: done
  done:
    prompt: "Done."
    transitions: {}
`,
    );
    const fsm = loadFsm(p);
    expect(fsm.states.start.subagent).toBe(false);
  });

  test("schema rejects non-boolean subagent", () => {
    expectSchemaInvalid(
      `
version: 1.3
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    subagent: "yes"
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-subagent-string.yaml",
      /subagent.*boolean/,
    );
  });

  test("schema rejects subagent on version < 1.3", () => {
    expectSchemaInvalid(
      `
version: 1
guide: "x"
initial: start
states:
  start:
    prompt: "x"
    subagent: true
    transitions:
      go: done
  done:
    prompt: "x"
    transitions: {}
`,
      "invalid-subagent-version.yaml",
      /subagent.*requires version 1\.3/,
    );
  });

  test("schema accepts missing subagent (backward compat)", () => {
    const p = writeYaml("valid-no-subagent.yaml", MINIMAL_FSM);
    const fsm = loadFsm(p);
    expect(fsm.states.start.subagent).toBeUndefined();
    expect(fsm.states.done.subagent).toBeUndefined();
  });
});

describe("loadFsm — file errors", () => {
  test("non-existent file throws", () => {
    expect(() => loadFsm("/tmp/does-not-exist.yaml")).toThrow();
  });
});

// --- Markdown workflow loading ---

describe("loadFsm — markdown workflows", () => {
  const fixturesDir = join(__dirname, "fixtures");

  test("loads a .workflow.md file and returns a valid Fsm matching equivalent YAML", () => {
    const mdPath = join(fixturesDir, "simple.workflow.md");
    const fsm = loadFsm(mdPath);

    expect(fsm.version).toBe(1);
    expect(fsm.initial).toBe("start");
    expect(fsm.guide).toBe("Minimal workflow guide.");
    expect(Object.keys(fsm.states)).toEqual(expect.arrayContaining(["start", "done"]));
    expect(fsm.states.start.prompt).toBe("Begin here.");
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
    expect(fsm.states.done.prompt).toBe("Finished.");
    expect(fsm.states.done.transitions).toEqual({});
  });

  test("markdown workflows go through the same resolution pipeline", () => {
    // The child-from-yaml.workflow.md uses from: to reference a YAML workflow
    // This tests resolveRefs works with markdown-loaded docs
    const mdPath = join(fixturesDir, "child-from-yaml.workflow.md");
    const fsm = loadFsm(mdPath);

    expect(fsm.version).toBe(1.1);
    expect(fsm.initial).toBe("start");
    // The start state should have its prompt merged with base via {{base}}
    expect(fsm.states.start.prompt).toContain("Custom start with base.");
    expect(fsm.states.start.prompt).toContain("Base start prompt.");
  });

  test("from: references from a markdown workflow to a YAML workflow resolve correctly", () => {
    const mdPath = join(fixturesDir, "child-from-yaml.workflow.md");
    const fsm = loadFsm(mdPath);

    // The from: reference is to ./base#start (a YAML workflow)
    // After merge, the start state should have inherited base's todos
    expect(fsm.states.start.todos).toEqual(["Base todo 1", "Base todo 2"]);
    // Transitions from the child override
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
  });

  test("from: references from a YAML workflow to a markdown workflow resolve correctly", () => {
    const yamlPath = join(fixturesDir, "child-from-md.workflow.yaml");
    const fsm = loadFsm(yamlPath);

    expect(fsm.version).toBe(1.1);
    expect(fsm.initial).toBe("start");
    // The start state should have its prompt inherited from the .workflow.md file
    expect(fsm.states.start.prompt).toBe("Begin here.");
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
  });
});
