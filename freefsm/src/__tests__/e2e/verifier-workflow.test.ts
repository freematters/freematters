import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const VERIFIER_FSM = resolve(__dirname, "../../../workflows/verifier.fsm.yaml");

describe("verifier.fsm.yaml", () => {
  test("file exists", () => {
    expect(existsSync(VERIFIER_FSM)).toBe(true);
  });

  test("contains embedded tool descriptions in guide", () => {
    const content = readFileSync(VERIFIER_FSM, "utf-8");
    expect(content).toContain("run_agent");
    expect(content).toContain("wait");
    expect(content).toContain("send");
  });

  test("has setup → execute → report → done flow", () => {
    const content = readFileSync(VERIFIER_FSM, "utf-8");
    expect(content).toContain("initial: setup");
    expect(content).toContain("setup complete: execute");
    expect(content).toContain("all steps executed: report");
    expect(content).toContain("report written: done");
  });
});
