import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../commands/migrate.js";

describe("migrate", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "freeflow-migrate-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ─── Home dir: ~/.freefsm → ~/.freeflow ──────────────────────

  test("renames ~/.freefsm to ~/.freeflow", () => {
    const fakeHome = join(tmp, "home");
    mkdirSync(join(fakeHome, ".freefsm"), { recursive: true });
    writeFileSync(join(fakeHome, ".freefsm", "marker.txt"), "test");

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: fakeHome,
      cwd: tmp,
    });

    expect(existsSync(join(fakeHome, ".freeflow"))).toBe(true);
    expect(existsSync(join(fakeHome, ".freefsm"))).toBe(false);
    expect(readFileSync(join(fakeHome, ".freeflow", "marker.txt"), "utf-8")).toBe(
      "test",
    );

    const homeResult = results.find(
      (r) => r.action === "rename ~/.freefsm → ~/.freeflow",
    );
    expect(homeResult?.status).toBe("done");
  });

  // ─── CWD: .freefsm → .freeflow ──────────────────────────────

  test("renames .freefsm to .freeflow in cwd", () => {
    const fakeCwd = join(tmp, "project");
    mkdirSync(join(fakeCwd, ".freefsm"), { recursive: true });
    writeFileSync(join(fakeCwd, ".freefsm", "data.json"), "{}");

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: tmp,
      cwd: fakeCwd,
    });

    expect(existsSync(join(fakeCwd, ".freeflow"))).toBe(true);
    expect(existsSync(join(fakeCwd, ".freefsm"))).toBe(false);

    const cwdResult = results.find((r) => r.action === "rename .freefsm → .freeflow");
    expect(cwdResult?.status).toBe("done");
  });

  // ─── *.fsm.yaml → *.workflow.yaml ───────────────────────────

  test("renames *.fsm.yaml to *.workflow.yaml", () => {
    const fakeCwd = join(tmp, "project");
    const workflowsDir = join(fakeCwd, ".freeflow", "workflows");
    mkdirSync(workflowsDir, { recursive: true });
    writeFileSync(join(workflowsDir, "test.fsm.yaml"), "version: 1");
    writeFileSync(join(workflowsDir, "other.fsm.yaml"), "version: 1");

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: tmp,
      cwd: fakeCwd,
    });

    expect(existsSync(join(workflowsDir, "test.workflow.yaml"))).toBe(true);
    expect(existsSync(join(workflowsDir, "other.workflow.yaml"))).toBe(true);
    expect(existsSync(join(workflowsDir, "test.fsm.yaml"))).toBe(false);
    expect(existsSync(join(workflowsDir, "other.fsm.yaml"))).toBe(false);

    const renameResults = results.filter(
      (r) => r.action.startsWith("rename ") && r.status === "done",
    );
    expect(renameResults.length).toBeGreaterThanOrEqual(2);
  });

  // ─── --dry-run ───────────────────────────────────────────────

  test("dry-run makes no changes", () => {
    const fakeHome = join(tmp, "home");
    const fakeCwd = join(tmp, "project");
    mkdirSync(join(fakeHome, ".freefsm"), { recursive: true });
    mkdirSync(join(fakeCwd, ".freefsm"), { recursive: true });

    // Put workflow files inside .freefsm (which will be "renamed" to .freeflow)
    // For the yaml rename test, use a separate home dir with .freeflow/workflows
    const homeWorkflowsDir = join(fakeHome, ".freeflow", "workflows");
    mkdirSync(homeWorkflowsDir, { recursive: true });
    writeFileSync(join(homeWorkflowsDir, "test.fsm.yaml"), "version: 1");

    const results = migrate({
      dryRun: true,
      json: false,
      homeDir: fakeHome,
      cwd: fakeCwd,
    });

    // Dir renames should not have happened
    expect(existsSync(join(fakeHome, ".freefsm"))).toBe(true);
    expect(existsSync(join(fakeCwd, ".freefsm"))).toBe(true);
    // The .fsm.yaml file should still exist (not renamed)
    expect(existsSync(join(homeWorkflowsDir, "test.fsm.yaml"))).toBe(true);

    // All results should be marked as dryRun
    for (const r of results) {
      expect(r.dryRun).toBe(true);
    }

    // Should have planned the renames
    const doneResults = results.filter((r) => r.status === "done");
    expect(doneResults.length).toBeGreaterThan(0);
  });

  // ─── Skip when dest exists ───────────────────────────────────

  test("skips with warning when both src and dest exist", () => {
    const fakeHome = join(tmp, "home");
    mkdirSync(join(fakeHome, ".freefsm"), { recursive: true });
    mkdirSync(join(fakeHome, ".freeflow"), { recursive: true });

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: fakeHome,
      cwd: tmp,
    });

    const homeResult = results.find(
      (r) => r.action === "rename ~/.freefsm → ~/.freeflow",
    );
    expect(homeResult?.status).toBe("warning");
    expect(homeResult?.message).toContain("Both");
    expect(homeResult?.message).toContain("resolve manually");

    // Both dirs should still exist (nothing was deleted)
    expect(existsSync(join(fakeHome, ".freefsm"))).toBe(true);
    expect(existsSync(join(fakeHome, ".freeflow"))).toBe(true);
  });

  // ─── FREEFSM_ROOT detection ──────────────────────────────────

  test("detects FREEFSM_ROOT in shell config", () => {
    const fakeHome = join(tmp, "home");
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(
      join(fakeHome, ".bashrc"),
      'export FREEFSM_ROOT="/home/user/.freefsm"\nsome other stuff\n',
    );

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: fakeHome,
      cwd: tmp,
    });

    const shellResult = results.find(
      (r) => r.action === "detect FREEFSM_ROOT in .bashrc",
    );
    expect(shellResult).toBeDefined();
    expect(shellResult?.status).toBe("warning");
    expect(shellResult?.message).toContain("FREEFSM_ROOT");
    expect(shellResult?.message).toContain("update manually");
  });

  test("detects FREEFSM_ROOT in .zshrc", () => {
    const fakeHome = join(tmp, "home");
    mkdirSync(fakeHome, { recursive: true });
    writeFileSync(join(fakeHome, ".zshrc"), 'export FREEFSM_ROOT="$HOME/.freefsm"\n');

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: fakeHome,
      cwd: tmp,
    });

    const shellResult = results.find(
      (r) => r.action === "detect FREEFSM_ROOT in .zshrc",
    );
    expect(shellResult).toBeDefined();
    expect(shellResult?.status).toBe("warning");
    expect(shellResult?.message).toContain("FREEFLOW_ROOT");
  });

  // ─── Already migrated (only dest exists) ─────────────────────

  test("skips when already migrated", () => {
    const fakeHome = join(tmp, "home");
    mkdirSync(join(fakeHome, ".freeflow"), { recursive: true });
    // No .freefsm exists

    const results = migrate({
      dryRun: false,
      json: false,
      homeDir: fakeHome,
      cwd: tmp,
    });

    const homeResult = results.find(
      (r) => r.action === "rename ~/.freefsm → ~/.freeflow",
    );
    expect(homeResult?.status).toBe("skipped");
    expect(homeResult?.message).toContain("already migrated");
  });
});
