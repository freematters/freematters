import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const VERIFIER_FSM = resolve(
  __dirname,
  "../../../workflows/verifier.fsm.yaml",
);

describe("verifier.fsm.yaml", () => {
  test("file exists", () => {
    expect(existsSync(VERIFIER_FSM)).toBe(true);
  });

  test("contains embedded tool descriptions in guide", () => {
    const content = readFileSync(VERIFIER_FSM, "utf-8");
    expect(content).toContain("start_embedded_run");
    expect(content).toContain("wait");
    expect(content).toContain("send_input");
  });

  test("has setup → execute → report → done flow", () => {
    const content = readFileSync(VERIFIER_FSM, "utf-8");
    expect(content).toContain("initial: setup");
    expect(content).toContain("setup complete: execute");
    expect(content).toContain("all steps executed: report");
    expect(content).toContain("report written: done");
  });

  test("does not reference old FSM tools (fsm_goto, fsm_current)", () => {
    const content = readFileSync(VERIFIER_FSM, "utf-8");
    expect(content).not.toContain("fsm_goto");
    expect(content).not.toContain("fsm_current");
  });
});
