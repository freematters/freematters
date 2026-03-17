import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { generateFromYaml } from "../../commands/e2e/gen.js";
import { parseTestPlan } from "../../e2e/parser.js";

// --- Fixtures ---

const SIMPLE_FSM_YAML = `version: 1
initial: start
states:
  start:
    prompt: "Begin the workflow"
    transitions:
      next: done
  done:
    prompt: "Workflow complete"
    transitions: {}
`;

const THREE_STATE_FSM_YAML = `version: 1
initial: setup
states:
  setup:
    prompt: "Set up environment"
    transitions:
      ready: execute
  execute:
    prompt: "Execute the task"
    transitions:
      complete: done
  done:
    prompt: "All done"
    transitions: {}
`;

const BRANCHING_FSM_YAML = `version: 1
initial: start
states:
  start:
    prompt: "Start here"
    transitions:
      approve: review
      reject: done
  review:
    prompt: "Review the work"
    transitions:
      accept: done
  done:
    prompt: "Finished"
    transitions: {}
`;

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-gen-"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("generateFromYaml — YAML mode", () => {
  test("generates a valid test plan from a 2-state FSM", () => {
    const fsmPath = join(tmp, "simple.fsm.yaml");
    writeFileSync(fsmPath, SIMPLE_FSM_YAML, "utf-8");

    const { markdown } = generateFromYaml(fsmPath);

    // Must parse successfully with the Step 1 parser
    const result = parseTestPlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });

  test("generates a test plan covering the happy path of a 3-state FSM", () => {
    const fsmPath = join(tmp, "three-state.fsm.yaml");
    writeFileSync(fsmPath, THREE_STATE_FSM_YAML, "utf-8");

    const { markdown } = generateFromYaml(fsmPath);

    const result = parseTestPlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Should have steps that traverse setup -> execute -> done
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
  });

  test("generates test plan covering multiple paths for branching FSM", () => {
    const fsmPath = join(tmp, "branching.fsm.yaml");
    writeFileSync(fsmPath, BRANCHING_FSM_YAML, "utf-8");

    const { markdown } = generateFromYaml(fsmPath);

    const result = parseTestPlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Branching FSM has 2 paths; steps should cover both paths
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(2);
  });

  test("generated plan includes setup section", () => {
    const fsmPath = join(tmp, "simple2.fsm.yaml");
    writeFileSync(fsmPath, SIMPLE_FSM_YAML, "utf-8");

    const { markdown } = generateFromYaml(fsmPath);
    const result = parseTestPlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.setup.length).toBeGreaterThanOrEqual(1);
  });

  test("generated plan includes expected outcomes", () => {
    const fsmPath = join(tmp, "simple3.fsm.yaml");
    writeFileSync(fsmPath, SIMPLE_FSM_YAML, "utf-8");

    const { markdown } = generateFromYaml(fsmPath);
    const result = parseTestPlan(markdown);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.expectedOutcomes.length).toBeGreaterThanOrEqual(1);
  });
});
