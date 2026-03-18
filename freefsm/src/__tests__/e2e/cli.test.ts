import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCli } from "./helpers.js";

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-e2e-cli-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(
  args: string,
  opts: { expectFail?: boolean } = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runCli(args, { ...opts, env: { FREEFSM_ROOT: undefined } });
}

describe("freefsm e2e verify — CLI arg validation", () => {
  test("exits with error when no args provided", () => {
    const { exitCode, stderr } = run("e2e verify", { expectFail: true });
    expect(exitCode).not.toBe(0);
  });

  test("exits with error when --test-dir is missing", () => {
    const planPath = join(tmp, "plan.md");
    writeFileSync(
      planPath,
      "# Test: dummy\n## Setup\n- x\n## Steps\n1. **s**: a\n   - Expected: b\n## Expected Outcomes\n- c\n",
      "utf-8",
    );
    const { exitCode } = run(`e2e verify ${planPath}`, { expectFail: true });
    expect(exitCode).not.toBe(0);
  });

  test("exits with error on empty plan file", () => {
    const planPath = join(tmp, "empty-plan.md");
    writeFileSync(planPath, "", "utf-8");
    const testDir = join(tmp, "empty-out");
    const { exitCode, stdout } = run(
      `e2e verify ${planPath} --test-dir ${testDir} -j`,
      { expectFail: true },
    );
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("ARGS_INVALID");
  });
});
