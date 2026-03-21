import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import { resolveWorkflow } from "../resolve-workflow.js";
import { MINIMAL_FSM, cleanupTempDir, createTempDir } from "./fixtures.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── resolve-workflow + loadFsm cross-component ─────────────────

describe("resolve-workflow + loadFsm integration", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = createTempDir("resolve-fsm-integ");

    // Create a workflow in the new directory format: <name>/workflow.yaml
    const wfDir = join(tmp, "my-workflow");
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, "workflow.yaml"), MINIMAL_FSM, "utf-8");
  });

  afterAll(() => {
    cleanupTempDir(tmp);
  });

  test("resolveWorkflow finds <name>/workflow.yaml and loadFsm parses it", () => {
    // resolveWorkflow with a direct path that exists
    const wfPath = join(tmp, "my-workflow", "workflow.yaml");
    const resolved = resolveWorkflow(wfPath);
    expect(resolved).toBe(wfPath);

    // loadFsm can parse the resolved path
    const fsm = loadFsm(resolved);
    expect(fsm.version).toBe(1);
    expect(fsm.initial).toBe("start");
    expect(fsm.states.start).toBeDefined();
    expect(fsm.states.done).toBeDefined();
    expect(fsm.states.start.transitions).toEqual({ next: "done" });
  });

  test("resolveWorkflow with non-existent direct path throws WORKFLOW_NOT_FOUND", () => {
    const badPath = join(tmp, "nonexistent/workflow.yaml");
    expect(() => resolveWorkflow(badPath)).toThrow(CliError);
    try {
      resolveWorkflow(badPath);
    } catch (e) {
      expect((e as CliError).code).toBe("WORKFLOW_NOT_FOUND");
    }
  });

  test("old flat format by name returns WORKFLOW_NOT_FOUND", () => {
    // Place a flat-format file in the temp dir
    writeFileSync(join(tmp, "flat-test.workflow.yaml"), MINIMAL_FSM, "utf-8");
    // Searching by bare name "flat-test" should NOT find the flat file
    // (it would need <name>/workflow.yaml format)
    expect(() => resolveWorkflow("flat-test")).toThrow(CliError);
    try {
      resolveWorkflow("flat-test");
    } catch (e) {
      expect((e as CliError).code).toBe("WORKFLOW_NOT_FOUND");
    }
  });

  test("direct path to flat-format file still works", () => {
    const flatPath = join(tmp, "flat-test.workflow.yaml");
    writeFileSync(flatPath, MINIMAL_FSM, "utf-8");
    const resolved = resolveWorkflow(flatPath);
    expect(resolved).toBe(flatPath);
    const fsm = loadFsm(resolved);
    expect(fsm.version).toBe(1);
  });
});

// ─── Search priority end-to-end ─────────────────────────────────

describe("search priority: project-local > bundled", () => {
  let tmp: string;
  let originalCwd: string;

  beforeAll(() => {
    tmp = createTempDir("priority-integ");
    originalCwd = process.cwd();

    // Create a project-local workflow at .freeflow/workflows/<name>/workflow.yaml
    const projectLocalDir = join(tmp, ".freeflow", "workflows", "priority-test");
    mkdirSync(projectLocalDir, { recursive: true });
    writeFileSync(
      join(projectLocalDir, "workflow.yaml"),
      `
version: 1
guide: "Project-local version"
initial: start
states:
  start:
    prompt: "This is the PROJECT-LOCAL workflow."
    transitions:
      next: done
  done:
    prompt: "Done (local)."
    transitions: {}
`,
      "utf-8",
    );

    // Change cwd to the temp dir so project-local search picks it up
    process.chdir(tmp);
  });

  afterAll(() => {
    process.chdir(originalCwd);
    cleanupTempDir(tmp);
  });

  test("project-local workflow takes priority over bundled", () => {
    const resolved = resolveWorkflow("priority-test");
    expect(resolved).toBe(
      join(tmp, ".freeflow", "workflows", "priority-test", "workflow.yaml"),
    );
    const fsm = loadFsm(resolved);
    expect(fsm.guide).toBe("Project-local version");
    expect(fsm.states.start.prompt).toContain("PROJECT-LOCAL");
  });
});

// ─── Validate all bundled workflows ─────────────────────────────

describe("validate all bundled workflows", () => {
  const workflowsDir = resolve(__dirname, "../../workflows");
  let workflowDirs: string[];

  beforeAll(async () => {
    // Dynamically find all workflow.yaml files under workflows/
    const { readdirSync, statSync } = await import("node:fs");
    const entries = readdirSync(workflowsDir);
    workflowDirs = entries.filter((entry) => {
      const entryPath = join(workflowsDir, entry);
      return (
        statSync(entryPath).isDirectory() &&
        statSync(join(entryPath, "workflow.yaml"), { throwIfNoEntry: false })
      );
    });
  });

  test("all bundled workflow directories contain valid workflow.yaml", () => {
    expect(workflowDirs.length).toBeGreaterThan(0);

    for (const dir of workflowDirs) {
      const yamlPath = join(workflowsDir, dir, "workflow.yaml");
      // loadFsm performs full schema validation; it throws on invalid YAML
      const fsm = loadFsm(yamlPath);
      expect(fsm.version).toBe(1);
      expect(fsm.initial).toBeTruthy();
      expect(Object.keys(fsm.states).length).toBeGreaterThan(0);
      expect(fsm.states.done).toBeDefined();
    }
  });

  test("expected bundled workflows exist", () => {
    const expectedWorkflows = [
      "spec-gen",
      "spec-to-code",
      "pr-lifecycle",
      "code-review",
      "issue-bot",
      "release",
      "gamemaker",
      "verifier",
    ];
    for (const name of expectedWorkflows) {
      expect(workflowDirs).toContain(name);
    }
  });
});
