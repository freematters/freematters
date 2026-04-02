import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { MINIMAL_FSM, cleanupTempDir, createTempDir, uniqueRunId } from "./fixtures.js";

const VARS_FSM = `
version: 1
guide: "Vars workflow"
initial: start
states:
  start:
    prompt: "Read \${workflow_dir}/data.txt and \${run_dir}/output.txt"
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmMinimal: string;
let fsmVars: string;

beforeAll(() => {
  tmp = createTempDir("markdown-mode");
  fsmMinimal = join(tmp, "minimal.yaml");
  fsmVars = join(tmp, "vars.yaml");
  writeFileSync(fsmMinimal, MINIMAL_FSM, "utf-8");
  writeFileSync(fsmVars, VARS_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

const defaultRoot = () => join(tmp, "root");

describe("markdown mode", () => {
  test("start --markdown creates run dir with only fsm.meta.json (no events.jsonl, no snapshot.json)", () => {
    const id = uniqueRunId("md-start-files");
    const root = defaultRoot();
    const { exitCode } = runCli(`start ${fsmMinimal} --run-id ${id} --markdown`, {
      root,
    });
    expect(exitCode).toBe(0);

    const runDir = join(root, "runs", id);
    expect(existsSync(join(runDir, "fsm.meta.json"))).toBe(true);
    expect(existsSync(join(runDir, "events.jsonl"))).toBe(false);
    expect(existsSync(join(runDir, "snapshot.json"))).toBe(false);
  });

  test("start --markdown outputs rendered markdown with ${workflow_dir} and ${run_dir} substituted", () => {
    const id = uniqueRunId("md-start-vars");
    const root = defaultRoot();
    const { stdout, exitCode } = runCli(`start ${fsmVars} --run-id ${id} --markdown`, {
      root,
    });
    expect(exitCode).toBe(0);

    const runDir = join(root, "runs", id);
    // ${workflow_dir} should be substituted to the directory containing the YAML
    expect(stdout).toContain(`Read ${tmp}/data.txt`);
    expect(stdout).not.toContain("${workflow_dir}");
    // ${run_dir} should be substituted
    expect(stdout).toContain(`${runDir}/output.txt`);
    expect(stdout).not.toContain("${run_dir}");
  });

  test("goto on markdown run → CliError MARKDOWN_MODE", () => {
    const id = uniqueRunId("md-goto-block");
    const root = defaultRoot();
    runCli(`start ${fsmMinimal} --run-id ${id} --markdown`, { root });

    const { envelope, exitCode } = runCliJson(`goto done --run-id ${id} --on next`, {
      root,
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("MARKDOWN_MODE");
  });

  test("abort on markdown run → CliError MARKDOWN_MODE", () => {
    const id = uniqueRunId("md-abort-block");
    const root = defaultRoot();
    runCli(`start ${fsmMinimal} --run-id ${id} --markdown`, { root });

    const { envelope, exitCode } = runCliJson(`abort --run-id ${id}`, {
      root,
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("MARKDOWN_MODE");
  });

  test("current on markdown run → read-only metadata, no state card", () => {
    const id = uniqueRunId("md-current-meta");
    const root = defaultRoot();
    runCli(`start ${fsmMinimal} --run-id ${id} --markdown`, { root });

    const { envelope, exitCode } = runCliJson(`current --run-id ${id}`, { root });
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);

    const data = envelope.data as Record<string, unknown>;
    expect(data.run_id).toBe(id);
    expect(data.mode).toBe("markdown");
    expect(data.workflow_dir).toBeDefined();
    expect(data.run_dir).toBeDefined();
    // No state card fields
    expect(data.state).toBeUndefined();
    expect(data.prompt).toBeUndefined();
    expect(data.transitions).toBeUndefined();
  });

  test("current on normal run → unchanged behavior (regression)", () => {
    const id = uniqueRunId("md-current-normal");
    const root = defaultRoot();
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root });

    const { envelope, exitCode } = runCliJson(`current --run-id ${id}`, { root });
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);

    const data = envelope.data as Record<string, unknown>;
    expect(data.run_id).toBe(id);
    expect(data.state).toBe("start");
    expect(data.prompt).toBe("Begin here.");
    expect(data.transitions).toEqual({ next: "done" });
    expect(data.run_status).toBe("active");
  });
});
