import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { parseTestPlan } from "../../e2e/parser.js";
import { CliError } from "../../errors.js";
import { handleError, jsonError, jsonSuccess, printJson } from "../../output.js";

export interface VerifyArgs {
  planPath: string;
  testDir: string;
  json: boolean;
}

export function verify(args: VerifyArgs): void {
  try {
    // Read the test plan file
    let planContent: string;
    try {
      planContent = readFileSync(args.planPath, "utf-8");
    } catch {
      throw new CliError("ARGS_INVALID", `Cannot read test plan: ${args.planPath}`, {
        context: { fsmPath: args.planPath },
      });
    }

    // Parse the test plan
    const result = parseTestPlan(planContent);
    if (!result.ok) {
      throw new CliError("ARGS_INVALID", `Invalid test plan: ${result.error}`, {
        context: { fsmPath: args.planPath },
      });
    }

    // Create test-dir if it doesn't exist
    mkdirSync(args.testDir, { recursive: true });

    const { plan } = result;

    if (args.json) {
      printJson(
        jsonSuccess("Test plan parsed", {
          name: plan.name,
          setup: plan.setup.length,
          steps: plan.steps.length,
          expectedOutcomes: plan.expectedOutcomes.length,
          cleanup: plan.cleanup.length,
        }),
      );
    } else {
      process.stdout.write(`Test plan: ${plan.name}\n`);
      process.stdout.write(`  Setup: ${plan.setup.length} items\n`);
      process.stdout.write(`  Steps: ${plan.steps.length}\n`);
      process.stdout.write(`  Expected outcomes: ${plan.expectedOutcomes.length}\n`);
      process.stdout.write(`  Cleanup: ${plan.cleanup.length} items\n`);
      process.stdout.write(`  Output: ${args.testDir}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
