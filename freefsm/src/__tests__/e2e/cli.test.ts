import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  test("parses plan and prints JSON with --test-dir and -j", () => {
    const planPath = join(tmp, "valid-plan.md");
    writeFileSync(
      planPath,
      `# Test: CLI integration

## Setup
- Prepare env

## Steps
1. **Run thing**: Execute command
   - Expected: It works

## Expected Outcomes
- Command succeeds

## Cleanup
- Remove files
`,
      "utf-8",
    );
    const testDir = join(tmp, "out-test");
    const { stdout, exitCode } = run(
      `e2e verify ${planPath} --test-dir ${testDir} --parse-only -j`,
    );
    expect(exitCode).toBe(0);

    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.name).toBe("CLI integration");
    expect(parsed.data.steps).toBe(1);
    expect(existsSync(testDir)).toBe(true);
  });

  test("creates --test-dir if it does not exist", () => {
    const planPath = join(tmp, "dir-creation-plan.md");
    writeFileSync(
      planPath,
      `# Test: Dir creation

## Setup
- x

## Steps
1. **Step**: do
   - Expected: done

## Expected Outcomes
- ok
`,
      "utf-8",
    );
    const testDir = join(tmp, `new-dir-${Date.now()}`);
    run(`e2e verify ${planPath} --test-dir ${testDir} --parse-only -j`);
    expect(existsSync(testDir)).toBe(true);
  });

  test("exits with error on invalid plan content", () => {
    const planPath = join(tmp, "bad-plan.md");
    writeFileSync(planPath, "# Not a valid plan\nJust some text.\n", "utf-8");
    const testDir = join(tmp, "bad-out");
    const { exitCode, stderr, stdout } = run(
      `e2e verify ${planPath} --test-dir ${testDir} -j`,
      { expectFail: true },
    );
    expect(exitCode).toBe(2);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("ARGS_INVALID");
  });
});
