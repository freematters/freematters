import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CliError } from "../errors.js";
import { resolveWorkflow } from "../resolve-workflow.js";
import { MINIMAL_FSM, cleanupTempDir, createTempDir } from "./fixtures.js";

// ─── hasWorkflowExtension via resolveWorkflow behavior ──────────

describe("hasWorkflowExtension recognises .workflow.md", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = createTempDir("resolve-wf-md-ext");
  });

  afterAll(() => {
    cleanupTempDir(tmp);
  });

  test("explicit .workflow.md path resolves directly when file exists", () => {
    const mdPath = join(tmp, "my-flow.workflow.md");
    writeFileSync(mdPath, "# placeholder", "utf-8");
    const resolved = resolveWorkflow(mdPath);
    expect(resolved).toBe(mdPath);
  });

  test("bare name with .workflow.md extension throws helpful message", () => {
    // Same behavior as .workflow.yaml bare names — not supported
    expect(() => resolveWorkflow("some-wf.workflow.md")).toThrow(CliError);
    try {
      resolveWorkflow("some-wf.workflow.md");
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe("WORKFLOW_NOT_FOUND");
      expect(err.message).toContain("Flat filename format is no longer supported");
      expect(err.message).toContain("some-wf");
    }
  });
});

describe("hasWorkflowExtension recognises .md", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = createTempDir("resolve-wf-plain-md");
  });

  afterAll(() => {
    cleanupTempDir(tmp);
  });

  test("explicit .md path resolves directly when file exists", () => {
    const mdPath = join(tmp, "workflow.md");
    writeFileSync(mdPath, "# placeholder", "utf-8");
    const resolved = resolveWorkflow(mdPath);
    expect(resolved).toBe(mdPath);
  });

  test("bare name with .md extension throws helpful message", () => {
    expect(() => resolveWorkflow("some-wf.md")).toThrow(CliError);
    try {
      resolveWorkflow("some-wf.md");
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe("WORKFLOW_NOT_FOUND");
      expect(err.message).toContain("Flat filename format is no longer supported");
      expect(err.message).toContain("some-wf");
    }
  });
});

// ─── probeDir: markdown-only and ambiguity ──────────────────────

describe("probeDir markdown resolution", () => {
  let tmp: string;
  let originalCwd: string;

  beforeAll(() => {
    tmp = createTempDir("resolve-wf-probe");
    originalCwd = process.cwd();

    // md-only workflow: only workflow.md exists
    const mdOnlyDir = join(tmp, ".freeflow", "workflows", "md-only");
    mkdirSync(mdOnlyDir, { recursive: true });
    writeFileSync(join(mdOnlyDir, "workflow.md"), "# placeholder md workflow", "utf-8");

    // ambiguous workflow: both workflow.yaml and workflow.md exist
    const ambigDir = join(tmp, ".freeflow", "workflows", "ambiguous");
    mkdirSync(ambigDir, { recursive: true });
    writeFileSync(join(ambigDir, "workflow.yaml"), MINIMAL_FSM, "utf-8");
    writeFileSync(join(ambigDir, "workflow.md"), "# placeholder md workflow", "utf-8");

    // yaml-only workflow: still works as before
    const yamlOnlyDir = join(tmp, ".freeflow", "workflows", "yaml-only");
    mkdirSync(yamlOnlyDir, { recursive: true });
    writeFileSync(join(yamlOnlyDir, "workflow.yaml"), MINIMAL_FSM, "utf-8");

    process.chdir(tmp);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tmp);
  });

  test("directory with only workflow.md returns md path", () => {
    const resolved = resolveWorkflow("md-only");
    expect(resolved).toBe(
      join(tmp, ".freeflow", "workflows", "md-only", "workflow.md"),
    );
  });

  test("directory with both workflow.yaml and workflow.md throws WORKFLOW_AMBIGUOUS", () => {
    expect(() => resolveWorkflow("ambiguous")).toThrow(CliError);
    try {
      resolveWorkflow("ambiguous");
    } catch (e) {
      const err = e as CliError;
      expect(err.code).toBe("WORKFLOW_AMBIGUOUS");
      expect(err.message).toContain("ambiguous");
      expect(err.message).toContain("workflow.yaml");
      expect(err.message).toContain("workflow.md");
    }
  });

  test("directory with only workflow.yaml still works (no regression)", () => {
    const resolved = resolveWorkflow("yaml-only");
    expect(resolved).toBe(
      join(tmp, ".freeflow", "workflows", "yaml-only", "workflow.yaml"),
    );
  });
});
