import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCli as runCliHelper } from "./helpers.js";

const E2E_DIR = resolve(__dirname, "../../../../e2e");

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

describe("e2e test plan files — run-stops-for-user-input.md", () => {
  test("file exists in e2e/ directory", () => {
    expect(existsSync(join(E2E_DIR, "run-stops-for-user-input.md"))).toBe(true);
  });

  test("contains required sections (Setup with Workflow, Steps, Expected Outcomes)", () => {
    const content = readFileSync(join(E2E_DIR, "run-stops-for-user-input.md"), "utf-8");
    expect(content).toContain("## Setup");
    expect(content).toContain("Workflow:");
    expect(content).toContain("## Steps");
    expect(content).toContain("## Expected Outcomes");
  });

  test("contains Background and Timeout Strategy sections", () => {
    const content = readFileSync(join(E2E_DIR, "run-stops-for-user-input.md"), "utf-8");
    expect(content).toContain("## Background");
    expect(content).toContain("## Timeout Strategy");
  });

  test("is non-empty and can be read as raw markdown", () => {
    const content = readFileSync(join(E2E_DIR, "run-stops-for-user-input.md"), "utf-8");
    expect(content.trim().length).toBeGreaterThan(100);
  });
});
