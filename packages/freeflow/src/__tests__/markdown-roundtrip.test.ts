import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Fsm } from "../fsm.js";
import { loadFsm } from "../fsm.js";
import { serializeMarkdown } from "../markdown-serializer.js";
import { serializeYaml } from "../yaml-serializer.js";

const FIXTURES = resolve(import.meta.dirname, "fixtures");

// --- Helpers ---

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "md-roundtrip-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Normalize whitespace: trim each line and the whole string. */
function normalizeWhitespace(s: string): string {
  return s
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

/**
 * Compare two Fsm objects field by field for semantic equality.
 * State-level `guide` fields are excluded because the markdown serializer
 * embeds them into the Instructions section (and re-parsing folds them
 * into the prompt), so they don't survive a round-trip as separate fields.
 */
function assertFsmEqual(actual: Fsm, expected: Fsm): void {
  expect(actual.version).toBe(expected.version);
  expect(actual.initial).toBe(expected.initial);
  // Guide: normalize trailing whitespace (YAML block scalars include trailing \n,
  // markdown parser trims it)
  expect(actual.guide?.trimEnd()).toBe(expected.guide?.trimEnd());
  expect(actual.allowed_tools).toEqual(expected.allowed_tools);

  const actualStateNames = Object.keys(actual.states).sort();
  const expectedStateNames = Object.keys(expected.states).sort();
  expect(actualStateNames).toEqual(expectedStateNames);

  for (const name of expectedStateNames) {
    const a = actual.states[name];
    const e = expected.states[name];
    expect(a.transitions, `state "${name}" transitions`).toEqual(e.transitions);
    expect(a.todos, `state "${name}" todos`).toEqual(e.todos);
    // Prompts: normalize trailing whitespace per-line for comparison
    // (YAML block scalars may have trailing spaces that markdown strips)
    expect(normalizeWhitespace(a.prompt), `state "${name}" prompt`).toBe(
      normalizeWhitespace(e.prompt),
    );
  }
}

/**
 * Like assertFsmEqual but also compares state-level guide.
 * Used for YAML-only round-trips where guide is preserved.
 */
function assertFsmEqualStrict(actual: Fsm, expected: Fsm): void {
  assertFsmEqual(actual, expected);
  for (const name of Object.keys(expected.states)) {
    expect(actual.states[name].guide, `state "${name}" guide`).toBe(
      expected.states[name].guide,
    );
  }
}

// --- Round-trip tests ---

describe("markdown round-trip integration", () => {
  describe("YAML -> MD -> YAML", () => {
    test("simple workflow (base-with-guide)", () => {
      const yamlPath = join(FIXTURES, "base-with-guide.workflow.yaml");
      const original = loadFsm(yamlPath);

      // Serialize to MD, write to temp file, reload
      const md = serializeMarkdown(original);
      const mdPath = join(tmpDir, "roundtrip.workflow.md");
      writeFileSync(mdPath, md, "utf-8");
      const roundTripped = loadFsm(mdPath);

      assertFsmEqual(roundTripped, original);
    });

    test("qa workflow with multi-line prompts and many states", () => {
      const yamlPath = join(FIXTURES, "qa.workflow.yaml");
      const original = loadFsm(yamlPath);

      const md = serializeMarkdown(original);
      const mdPath = join(tmpDir, "qa.workflow.md");
      writeFileSync(mdPath, md, "utf-8");
      const roundTripped = loadFsm(mdPath);

      assertFsmEqual(roundTripped, original);
    });

});

  describe("MD -> YAML -> MD", () => {
    test("simple markdown workflow", () => {
      const mdPath = join(FIXTURES, "simple.workflow.md");
      const original = loadFsm(mdPath);

      // Serialize to YAML, write to temp file, reload
      const yaml = serializeYaml(original);
      const yamlPath = join(tmpDir, "simple.workflow.yaml");
      writeFileSync(yamlPath, yaml, "utf-8");
      const roundTripped = loadFsm(yamlPath);

      assertFsmEqualStrict(roundTripped, original);
    });

});

  describe("cross-format from: references", () => {
    test("markdown workflow inheriting from YAML base", () => {
      // child-from-yaml.workflow.md uses from="./base.workflow.yaml#start"
      const mdPath = join(FIXTURES, "child-from-yaml.workflow.md");
      const child = loadFsm(mdPath);

      // The start state should have merged content from the YAML base
      expect(child.states.start).toBeDefined();
      expect(child.states.start.prompt).toContain("Custom start with base.");
      expect(child.states.start.prompt).toContain("Base start prompt.");
      expect(child.states.start.transitions).toEqual({ next: "done" });
    });

    test("YAML workflow inheriting from markdown base", () => {
      // Create a MD base workflow in temp dir
      const baseMd = [
        "---",
        "version: 1",
        "initial: start",
        "---",
        "",
        "## State: start",
        "",
        "### Instructions",
        "",
        "Markdown base prompt.",
        "",
        "### Todos",
        "",
        "- MD todo 1",
        "- MD todo 2",
        "",
        "### Transitions",
        "",
        "- next \u2192 done",
        "",
        "## State: done",
        "",
        "### Instructions",
        "",
        "Markdown done.",
        "",
        "### Transitions",
        "",
        "(none)",
      ].join("\n");

      const baseMdPath = join(tmpDir, "md-base.workflow.md");
      writeFileSync(baseMdPath, baseMd, "utf-8");

      // Create a YAML child that references the MD base
      const childYaml = [
        "version: 1.1",
        "initial: start",
        "states:",
        "  start:",
        `    from: "${baseMdPath}#start"`,
        '    prompt: "Extended. {{base}}"',
        "    transitions:",
        "      next: done",
        "  done:",
        '    prompt: "YAML child done."',
        "    transitions: {}",
      ].join("\n");

      const childYamlPath = join(tmpDir, "yaml-child.workflow.yaml");
      writeFileSync(childYamlPath, childYaml, "utf-8");

      const child = loadFsm(childYamlPath);

      expect(child.states.start.prompt).toContain("Extended.");
      expect(child.states.start.prompt).toContain("Markdown base prompt.");
      // Todos inherited from MD base
      expect(child.states.start.todos).toEqual(["MD todo 1", "MD todo 2"]);
    });
  });

  describe("complex workflow round-trip", () => {
    test("workflow with guide, todos, multiple states round-trips YAML -> MD -> YAML", () => {
      const fsm: Fsm = {
        version: 1,
        initial: "plan",
        guide: "This is a complex workflow guide.\nIt has multiple lines.",
        allowed_tools: ["Read", "Bash"],
        states: {
          plan: {
            prompt: "Plan the work.\nBreak into tasks.\nGet approval.",
            todos: ["Draft spec", "Review spec", "Get sign-off"],
            transitions: { approved: "implement", rejected: "plan" },
          },
          implement: {
            prompt: "Implement the plan.",
            todos: ["Write code", "Write tests"],
            transitions: { complete: "review" },
          },
          review: {
            prompt: "Review the implementation.\nCheck quality.",
            transitions: { approved: "done", rejected: "implement" },
          },
          done: {
            prompt: "All tasks complete.",
            transitions: {},
          },
        },
      };

      // Write YAML, load it, serialize to MD, load that, compare
      const yamlContent = serializeYaml(fsm);
      const yamlPath = join(tmpDir, "complex.workflow.yaml");
      writeFileSync(yamlPath, yamlContent, "utf-8");
      const fromYaml = loadFsm(yamlPath);

      const md = serializeMarkdown(fromYaml);
      const mdPath = join(tmpDir, "complex.workflow.md");
      writeFileSync(mdPath, md, "utf-8");
      const fromMd = loadFsm(mdPath);

      assertFsmEqual(fromMd, fromYaml);
    });

    test("workflow with guide, todos, multiple states round-trips MD -> YAML -> MD", () => {
      const mdContent = [
        "---",
        "version: 1",
        "initial: plan",
        "allowed_tools:",
        "  - Read",
        "  - Bash",
        "---",
        "",
        "# Complex Workflow",
        "",
        "## State Machine",
        "",
        "```mermaid",
        "stateDiagram-v2",
        "  [*] --> plan",
        "```",
        "",
        "## Guide",
        "",
        "Multi-line guide content.",
        "Second line of guide.",
        "",
        "## State: plan",
        "",
        "### Instructions",
        "",
        "Plan the work.",
        "Break into tasks.",
        "",
        "### Todos",
        "",
        "- Draft spec",
        "- Review spec",
        "",
        "### Transitions",
        "",
        "- approved \u2192 implement",
        "- rejected \u2192 plan",
        "",
        "## State: implement",
        "",
        "### Instructions",
        "",
        "Do the implementation.",
        "",
        "### Transitions",
        "",
        "- complete \u2192 done",
        "",
        "## State: done",
        "",
        "### Instructions",
        "",
        "Finished.",
        "",
        "### Transitions",
        "",
        "(none)",
      ].join("\n");

      const mdPath = join(tmpDir, "complex.workflow.md");
      writeFileSync(mdPath, mdContent, "utf-8");
      const fromMd = loadFsm(mdPath);

      const yaml = serializeYaml(fromMd);
      const yamlPath = join(tmpDir, "complex.workflow.yaml");
      writeFileSync(yamlPath, yaml, "utf-8");
      const fromYaml = loadFsm(yamlPath);

      assertFsmEqualStrict(fromYaml, fromMd);
    });
  });
});
