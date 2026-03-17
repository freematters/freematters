import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { parseTestPlan } from "../../e2e/parser.js";
import { verifyCore } from "../../e2e/verify-runner.js";
import { CliError } from "../../errors.js";
import { handleError, jsonSuccess, printJson } from "../../output.js";

export interface VerifyArgs {
  planPath: string;
  testDir: string;
  json: boolean;
  parseOnly?: boolean;
}

export async function verify(args: VerifyArgs): Promise<void> {
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
      // In JSON mode, print parsed plan summary before running
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

    // Execute the verification loop (skip if --parse-only)
    if (!args.parseOnly) {
      const verifyResult = await verifyCore({
        plan,
        testDir: args.testDir,
      });

      if (args.json) {
        printJson(
          jsonSuccess("Verification complete", {
            verdict: verifyResult.jsonReport.verdict,
            steps_passed: verifyResult.jsonReport.steps_passed,
            steps_failed: verifyResult.jsonReport.steps_failed,
            reportPath: verifyResult.reportPath,
          }),
        );
      } else {
        const { jsonReport, reportPath } = verifyResult;
        process.stdout.write(
          `\nVerdict: ${jsonReport.verdict} ` +
            `(${jsonReport.steps_passed} passed, ` +
            `${jsonReport.steps_failed} failed)\n`,
        );
        process.stdout.write(`Report: ${reportPath}\n`);
      }
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
