import { describe, expect, test } from "vitest";
import { type TestPlan, parseTestPlan } from "../../e2e/parser.js";

const VALID_PLAN = `# Test: Basic workflow

## Setup
- Install freefsm globally
- Create a temp directory

## Steps
1. **Start workflow**: Run \`freefsm start workflow.yaml\`
   - Expected: Run initializes with start state
2. **Transition**: Run \`freefsm goto done --run-id test --on next\`
   - Expected: State transitions to done

## Expected Outcomes
- Workflow completes successfully
- All states visited in order

## Cleanup
- Remove temp directory
- Uninstall freefsm
`;

const PLAN_MISSING_EXPECTED = `# Test: Missing section

## Setup
- Do something

## Steps
1. **Step one**: Do a thing
   - Expected: Thing happens

## Cleanup
- Clean up
`;

const PLAN_MINIMAL = `# Test: Minimal

## Setup
- None

## Steps
1. **Only step**: Do something
   - Expected: It works

## Expected Outcomes
- It works
`;

describe("parseTestPlan — valid inputs", () => {
  test("parses a complete test plan with all 4 sections", () => {
    const result = parseTestPlan(VALID_PLAN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const plan: TestPlan = result.plan;
    expect(plan.name).toBe("Basic workflow");
    expect(plan.setup).toHaveLength(2);
    expect(plan.setup[0]).toBe("Install freefsm globally");
    expect(plan.setup[1]).toBe("Create a temp directory");

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].name).toBe("Start workflow");
    expect(plan.steps[0].action).toContain("freefsm start workflow.yaml");
    expect(plan.steps[0].expected).toBe("Run initializes with start state");
    expect(plan.steps[1].name).toBe("Transition");

    expect(plan.expectedOutcomes).toHaveLength(2);
    expect(plan.expectedOutcomes[0]).toBe("Workflow completes successfully");

    expect(plan.cleanup).toHaveLength(2);
    expect(plan.cleanup[0]).toBe("Remove temp directory");
  });

  test("parses a plan with no cleanup section (optional)", () => {
    const result = parseTestPlan(PLAN_MINIMAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.name).toBe("Minimal");
    expect(result.plan.setup).toHaveLength(1);
    expect(result.plan.steps).toHaveLength(1);
    expect(result.plan.expectedOutcomes).toHaveLength(1);
    expect(result.plan.cleanup).toHaveLength(0);
  });
});

describe("parseTestPlan — invalid inputs", () => {
  test("returns error when Expected Outcomes section is missing", () => {
    const result = parseTestPlan(PLAN_MISSING_EXPECTED);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Expected Outcomes");
  });

  test("returns error when Steps section is missing", () => {
    const input = `# Test: No steps

## Setup
- Something

## Expected Outcomes
- Something works
`;
    const result = parseTestPlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Steps");
  });

  test("returns error for empty input", () => {
    const result = parseTestPlan("");
    expect(result.ok).toBe(false);
  });
});
