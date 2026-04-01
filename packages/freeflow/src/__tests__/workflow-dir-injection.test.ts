import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { render } from "../commands/render.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { MINIMAL_FSM, cleanupTempDir, createTempDir } from "./fixtures.js";

let tmp: string;
let fsmPath: string;

beforeAll(() => {
  tmp = createTempDir("wf-dir");
  fsmPath = join(tmp, "workflows", "my-wf", "workflow.yaml");
  const dir = dirname(fsmPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(fsmPath, MINIMAL_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "wfdir"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultRoot = () => join(tmp, "root");

describe("workflow-dir and run-dir injection", () => {
  test("fflow start output includes workflow_dir", () => {
    const id = uniqueRunId("start-wfdir");
    const { stdout, exitCode } = runCli(`start ${fsmPath} --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    const expectedDir = dirname(fsmPath);
    expect(stdout).toContain(`workflow_dir: ${expectedDir}`);
  });

  test("fflow start with --run-id output includes run_dir", () => {
    const id = uniqueRunId("start-rundir");
    const root = defaultRoot();
    const { stdout, exitCode } = runCli(`start ${fsmPath} --run-id ${id}`, {
      root,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`run_dir: ${join(root, "runs", id)}`);
  });

  test("fflow start -j JSON data contains workflow_dir and run_dir", () => {
    const id = uniqueRunId("start-json");
    const root = defaultRoot();
    const { envelope, exitCode } = runCliJson(`start ${fsmPath} --run-id ${id}`, {
      root,
    });
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    expect(data.workflow_dir).toBe(dirname(fsmPath));
    expect(data.run_dir).toBe(join(root, "runs", id));
  });

  test("fflow current --run-id output includes workflow_dir", () => {
    const id = uniqueRunId("current-wfdir");
    const root = defaultRoot();
    runCli(`start ${fsmPath} --run-id ${id}`, { root });
    const { stdout, exitCode } = runCli(`current --run-id ${id}`, { root });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`workflow_dir: ${dirname(fsmPath)}`);
  });

  test("fflow render markdown output includes workflow_dir", () => {
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
    expect(output).toContain(`workflow_dir: ${dirname(fsmPath)}`);
  });
});
