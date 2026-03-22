import { describe, expect, test } from "vitest";
import { parseMarkdownWorkflow } from "../markdown-parser.js";

// --- Helpers ---

function minimal(extra = ""): string {
  return `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Instructions

Do the work.

### Transitions

- done → done

## State: done

### Instructions

All done.

### Transitions

(none)
${extra}`;
}

// --- Valid cases ---

describe("parseMarkdownWorkflow — valid inputs", () => {
  test("minimal valid markdown → correct raw doc", () => {
    const doc = parseMarkdownWorkflow(minimal());
    expect(doc.version).toBe(1.2);
    expect(doc.initial).toBe("start");
    expect(doc.states).toBeDefined();
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.start).toBeDefined();
    expect(states.start.prompt).toContain("Do the work.");
    expect(states.start.transitions).toEqual({ done: "done" });
    expect(states.done).toBeDefined();
    expect(states.done.prompt).toContain("All done.");
    expect(states.done.transitions).toEqual({});
  });

  test("parse frontmatter fields: version, initial, allowed_tools, extends_guide", () => {
    const content = `---
version: 1.2
initial: start
allowed_tools:
  - Read
  - Write
extends_guide: ./base-workflow
---

# My Workflow

## State: start

### Instructions

Work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    expect(doc.version).toBe(1.2);
    expect(doc.initial).toBe("start");
    expect(doc.allowed_tools).toEqual(["Read", "Write"]);
    expect(doc.extends_guide).toBe("./base-workflow");
  });

  test("parse ## Guide section → doc.guide", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## Guide

This is the workflow-level guide.
It can span **multiple lines**.

## State: start

### Instructions

Work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    expect(doc.guide).toBeDefined();
    expect(doc.guide as string).toContain("This is the workflow-level guide.");
    expect(doc.guide as string).toContain("multiple lines");
  });

  test("parse ## State: <name> → doc.states[name] with prompt, todos, transitions", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Instructions

Do the initial setup.
Then continue.

### Todos

- Write code
- Run tests
- Deploy

### Transitions

- review → review
- skip → done

## State: review

### Instructions

Review the work.

### Transitions

- approve → done

## State: done

### Instructions

All done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;

    // start state
    expect(states.start.prompt).toContain("Do the initial setup.");
    expect(states.start.prompt).toContain("Then continue.");
    expect(states.start.todos).toEqual(["Write code", "Run tests", "Deploy"]);
    expect(states.start.transitions).toEqual({ review: "review", skip: "done" });

    // review state
    expect(states.review.prompt).toContain("Review the work.");
    expect(states.review.transitions).toEqual({ approve: "done" });

    // done state
    expect(states.done.prompt).toContain("All done.");
    expect(states.done.transitions).toEqual({});
  });

  test("parse ### Transitions with → separator", () => {
    const doc = parseMarkdownWorkflow(minimal());
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.start.transitions).toEqual({ done: "done" });
  });

  test("parse ### Transitions with -> separator", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Instructions

Work.

### Transitions

- finish -> done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.start.transitions).toEqual({ finish: "done" });
  });

  test("parse (none) / empty transitions → empty transitions object", () => {
    const doc = parseMarkdownWorkflow(minimal());
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.done.transitions).toEqual({});
  });

  test('parse <freeflow from="base#state"> → state.from, tag stripped from prompt', () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

<freeflow from="base-workflow#setup">

### Instructions

Do the local work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.start.from).toBe("base-workflow#setup");
    // The freeflow tag should not appear in the prompt
    expect(states.start.prompt as string).not.toContain("<freeflow");
    expect(states.start.prompt as string).toContain("Do the local work.");
  });

  test('parse <freeflow workflow="./child"> → state.workflow, no prompt field', () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Instructions

Work.

### Transitions

- child → child-step

## State: child-step

<freeflow workflow="./child">

### Transitions

- done → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states["child-step"].workflow).toBe("./child");
    // workflow states should not have a prompt field
    expect(states["child-step"].prompt).toBeUndefined();
  });

  test("parse <freeflow append-todos> block → state.append_todos", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

<freeflow from="base#setup">

<freeflow append-todos>
- Extra item one
- Extra item two
</freeflow>

### Instructions

Work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;
    expect(states.start.append_todos).toEqual(["Extra item one", "Extra item two"]);
  });

  test("skip ## State Machine mermaid block — does not affect parsed output", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State Machine

\`\`\`mermaid
stateDiagram-v2
  [*] --> start
  start --> done: finish
  done --> [*]
\`\`\`

## State: start

### Instructions

Work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    const doc = parseMarkdownWorkflow(content);
    const states = doc.states as Record<string, Record<string, unknown>>;
    // Should parse states correctly and ignore mermaid
    expect(states.start).toBeDefined();
    expect(states.done).toBeDefined();
    expect(states.start.transitions).toEqual({ finish: "done" });
    // No "State Machine" in states
    expect(states["State Machine"]).toBeUndefined();
  });
});

// --- Error cases ---

describe("parseMarkdownWorkflow — error cases", () => {
  test("error on missing frontmatter", () => {
    const content = `# My Workflow

## State: start

### Instructions

Work.

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    expect(() => parseMarkdownWorkflow(content)).toThrow(/frontmatter/i);
  });

  test("error on missing ### Instructions in a non-workflow state", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Transitions

- finish → done

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    expect(() => parseMarkdownWorkflow(content)).toThrow(/Instructions/i);
  });

  test("error on malformed transition lines", () => {
    const content = `---
version: 1.2
initial: start
---

# My Workflow

## State: start

### Instructions

Work.

### Transitions

- this is not a valid transition

## State: done

### Instructions

Done.

### Transitions

(none)
`;
    expect(() => parseMarkdownWorkflow(content)).toThrow(/transition/i);
  });
});
