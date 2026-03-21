import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadFsm } from "../fsm.js";
import { fsmToMermaid } from "../output.js";

// biome-ignore lint/style/noNonNullAssertion: dirname is always defined for file modules
const FIXTURES = join(import.meta.dirname!, "fixtures");

function fixture(name: string): string {
  return join(FIXTURES, name);
}

// --- from: inside composed child workflows ---

describe("integration: composed workflow with from: in child states", () => {
  test("from: resolution works correctly within expanded child states", () => {
    const fsm = loadFsm(fixture("compose-child-with-from.workflow.yaml"));

    // Child uses from: to inherit a base prompt + append_todos
    expect(fsm.states["phase/start"].prompt).toContain("Base child start.");
    expect(fsm.states["phase/start"].prompt).toContain("Extended with from.");
    expect(fsm.states["phase/start"].todos).toEqual(["Base todo A", "Appended todo B"]);

    // Transitions are namespaced, done gets parent exits
    expect(fsm.states["phase/start"].transitions.next).toBe("phase/done");
    expect(fsm.states["phase/done"].transitions.completed).toBe("done");
  });
});

// --- extends_guide inside composed child workflows ---

describe("integration: composed workflow with extends_guide on child", () => {
  test("child extends_guide merges into per-state guide, separate from parent guide", () => {
    const fsm = loadFsm(fixture("compose-extends-guide.workflow.yaml"));

    // Parent guide is separate
    expect(fsm.guide).toBe("Parent-level guide.");

    // Child states get the child's resolved guide (base + extension)
    const childGuide = fsm.states["sub/step"].guide;
    expect(childGuide).toContain("Base guide content.");
    expect(childGuide).toContain("Extra child rules for compose.");

    // Parent-level states have no per-state guide
    expect(fsm.states.done.guide).toBeUndefined();
  });
});

// --- Mermaid visualization ---

describe("integration: Mermaid visualization of composed workflows", () => {
  test("produces correct graph for nested and multi-workflow compositions", () => {
    // Nested: outer/mid-start → outer/nested/inner-start → outer/nested/done → outer/done → done
    const nested = loadFsm(fixture("compose-nested.workflow.yaml"));
    const nestedMermaid = fsmToMermaid(nested.states, nested.initial);

    expect(nestedMermaid).toContain("[*] --> outer/mid-start");
    expect(nestedMermaid).toContain(
      "outer/nested/inner-start --> outer/nested/done: next",
    );
    expect(nestedMermaid).toContain("outer/done --> done: completed");
    expect(nestedMermaid).toContain("done --> [*]");

    // Multi: first/* → second/* → done with cross-boundary transitions
    const multi = loadFsm(fixture("compose-multiple.workflow.yaml"));
    const multiMermaid = fsmToMermaid(multi.states, multi.initial);

    expect(multiMermaid).toContain("[*] --> first/create");
    expect(multiMermaid).toContain("first/done --> second/step-one: completed");
    expect(multiMermaid).toContain("second/done --> done: completed");
  });
});
