import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { parseTestPlan } from "../../e2e/parser.js";
import { runCli as runCliHelper } from "./helpers.js";

const E2E_DIR = resolve(__dirname, "../../../e2e");

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-dogfood-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runCli(
  args: string,
  opts: { expectFail?: boolean } = {},
): { stdout: string; stderr: string; exitCode: number } {
  return runCliHelper(args, { ...opts, env: { FREEFSM_ROOT: tmp } });
}

// --- Test plan file existence and validity ---

describe("e2e test plan files — simple-workflow.md", () => {
  test("file exists in e2e/ directory", () => {
    expect(existsSync(join(E2E_DIR, "simple-workflow.md"))).toBe(true);
  });

  test("parses successfully with the test plan parser", () => {
    const content = readFileSync(join(E2E_DIR, "simple-workflow.md"), "utf-8");
    const result = parseTestPlan(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });

  test("has all required sections (Setup, Steps, Expected Outcomes)", () => {
    const content = readFileSync(join(E2E_DIR, "simple-workflow.md"), "utf-8");
    const result = parseTestPlan(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.setup.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });
});

describe("e2e test plan files — error-handling.md", () => {
  test("file exists in e2e/ directory", () => {
    expect(existsSync(join(E2E_DIR, "error-handling.md"))).toBe(true);
  });

  test("parses successfully with the test plan parser", () => {
    const content = readFileSync(join(E2E_DIR, "error-handling.md"), "utf-8");
    const result = parseTestPlan(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });

  test("has all required sections (Setup, Steps, Expected Outcomes)", () => {
    const content = readFileSync(join(E2E_DIR, "error-handling.md"), "utf-8");
    const result = parseTestPlan(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.setup.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });
});

// --- CLI parse-only validation ---

describe("freefsm e2e verify --parse-only with dogfood plans", () => {
  test("simple-workflow.md passes parse-only verification", () => {
    const planPath = join(E2E_DIR, "simple-workflow.md");
    const testDir = join(tmp, "simple-out");
    const { stdout, exitCode } = runCli(
      `e2e verify ${planPath} --test-dir ${testDir} --parse-only -j`,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.steps).toBeGreaterThanOrEqual(2);
  });

  test("error-handling.md passes parse-only verification", () => {
    const planPath = join(E2E_DIR, "error-handling.md");
    const testDir = join(tmp, "error-out");
    const { stdout, exitCode } = runCli(
      `e2e verify ${planPath} --test-dir ${testDir} --parse-only -j`,
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.data.steps).toBeGreaterThanOrEqual(2);
  });
});

// --- Gen → parse round-trip ---

describe("freefsm e2e gen → parse round-trip", () => {
  test("gen from a simple FSM produces plan that passes parse-only", () => {
    // Create a simple FSM for testing
    const fsmPath = join(tmp, "roundtrip.fsm.yaml");
    writeFileSync(
      fsmPath,
      `version: 1
initial: start
states:
  start:
    prompt: "Begin"
    transitions:
      next: done
  done:
    prompt: "End"
    transitions: {}
`,
      "utf-8",
    );

    const outputPath = join(tmp, "roundtrip-plan.md");
    const { exitCode } = runCli(`e2e gen ${fsmPath} --output ${outputPath}`);
    expect(exitCode).toBe(0);

    // Verify the generated plan parses correctly
    const content = readFileSync(outputPath, "utf-8");
    const result = parseTestPlan(content);
    expect(result.ok).toBe(true);

    // Verify it also passes CLI parse-only
    const testDir = join(tmp, "roundtrip-out");
    const { stdout, exitCode: verifyExit } = runCli(
      `e2e verify ${outputPath} --test-dir ${testDir} --parse-only -j`,
    );
    expect(verifyExit).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
  });
});

// --- npm run test:e2e script validation ---

describe("package.json test:e2e:parse script", () => {
  test("test:e2e:parse script is defined in package.json", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../../../package.json"), "utf-8"),
    );
    expect(pkg.scripts["test:e2e:parse"]).toBeDefined();
    expect(typeof pkg.scripts["test:e2e:parse"]).toBe("string");
  });
});
