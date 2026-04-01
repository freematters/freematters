import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { render } from "../commands/render.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { cleanupTempDir, createTempDir, uniqueRunId } from "./fixtures.js";

const VARS_FSM = `
version: 1
guide: "Test workflow"
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
let fsmPath: string;

beforeAll(() => {
  tmp = createTempDir("wf-dir");
  fsmPath = join(tmp, "workflows", "my-wf", "workflow.yaml");
  const dir = dirname(fsmPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fsmPath, VARS_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

const defaultRoot = () => join(tmp, "root");

describe("workflow-dir and run-dir substitution in prompts", () => {
  test("fflow start substitutes ${workflow_dir} in prompt output", () => {
    const id = uniqueRunId("start-wfdir-sub");
    const { stdout, exitCode } = runCli(`start ${fsmPath} --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    const expectedDir = dirname(fsmPath);
    expect(stdout).toContain(`Read ${expectedDir}/data.txt`);
    expect(stdout).not.toContain("${workflow_dir}");
  });

  test("fflow start substitutes ${run_dir} in prompt output", () => {
    const id = uniqueRunId("start-rundir-sub");
    const root = defaultRoot();
    const { stdout, exitCode } = runCli(`start ${fsmPath} --run-id ${id}`, {
      root,
    });
    expect(exitCode).toBe(0);
    const expectedRunDir = join(root, "runs", id);
    expect(stdout).toContain(`${expectedRunDir}/output.txt`);
    expect(stdout).not.toContain("${run_dir}");
  });

  test("fflow start -j JSON prompt has ${workflow_dir} substituted", () => {
    const id = uniqueRunId("start-json-sub");
    const root = defaultRoot();
    const { envelope, exitCode } = runCliJson(`start ${fsmPath} --run-id ${id}`, {
      root,
    });
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    const expectedDir = dirname(fsmPath);
    expect(data.prompt).toContain(`Read ${expectedDir}/data.txt`);
    expect(data.prompt).not.toContain("${workflow_dir}");
  });

  test("fflow current --run-id substitutes ${workflow_dir} in prompt output", () => {
    const id = uniqueRunId("current-wfdir-sub");
    const root = defaultRoot();
    runCli(`start ${fsmPath} --run-id ${id}`, { root });
    const { stdout, exitCode } = runCli(`current --run-id ${id}`, { root });
    expect(exitCode).toBe(0);
    const expectedDir = dirname(fsmPath);
    expect(stdout).toContain(`Read ${expectedDir}/data.txt`);
    expect(stdout).not.toContain("${workflow_dir}");
  });

  test("fflow render substitutes ${workflow_dir} in markdown output", () => {
    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((str: string) => {
      writes.push(str);
      return true;
    }) as typeof process.stdout.write;
    try {
      render({ fsmPath, json: false });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = writes.join("");
    const expectedDir = dirname(fsmPath);
    expect(output).toContain(`Read ${expectedDir}/data.txt`);
    expect(output).not.toContain("${workflow_dir}");
  });
});
