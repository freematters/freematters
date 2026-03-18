import { constants, accessSync, existsSync, mkdirSync } from "node:fs";
import { verifyCore } from "../../e2e/verify-runner.js";
import { CliError } from "../../errors.js";
import { handleError, jsonSuccess, printJson } from "../../output.js";

export interface VerifyArgs {
  planPath: string;
  testDir: string;
  json: boolean;
  model?: string;
}

export async function verify(args: VerifyArgs): Promise<void> {
  try {
    // Verify the test plan file exists
    if (!existsSync(args.planPath)) {
      throw new CliError("ARGS_INVALID", `Cannot read test plan: ${args.planPath}`, {
        context: { fsmPath: args.planPath },
      });
    }

    // Create test-dir if it doesn't exist and verify it is writable
    mkdirSync(args.testDir, { recursive: true });
    try {
      accessSync(args.testDir, constants.W_OK);
    } catch {
      throw new CliError(
        "ARGS_INVALID",
        `Test directory is not writable: ${args.testDir}`,
        {
          context: { fsmPath: args.planPath },
        },
      );
    }

    if (!args.json) {
      process.stdout.write(`Test plan: ${args.planPath}\n`);
      process.stdout.write(`Output: ${args.testDir}\n`);
    }

    // Execute the verification via freefsm run with verifier.fsm.yaml
    const result = await verifyCore({
      planPath: args.planPath,
      testDir: args.testDir,
      model: args.model,
    });

    if (args.json) {
      printJson(
        jsonSuccess("Verification complete", {
          reportPath: result.reportPath,
        }),
      );
    } else {
      process.stdout.write(`Report: ${result.reportPath}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
