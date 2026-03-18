import { constants, accessSync, mkdirSync, readFileSync } from "node:fs";
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
    // Read the test plan file (raw markdown)
    let planMarkdown: string;
    try {
      planMarkdown = readFileSync(args.planPath, "utf-8");
    } catch {
      throw new CliError("ARGS_INVALID", `Cannot read test plan: ${args.planPath}`, {
        context: { fsmPath: args.planPath },
      });
    }

    if (!planMarkdown.trim()) {
      throw new CliError("ARGS_INVALID", "Test plan file is empty", {
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

    // Execute the verification loop
    const result = await verifyCore({
      planMarkdown,
      testDir: args.testDir,
      model: args.model,
    });

    if (args.json) {
      printJson(
        jsonSuccess("Verification complete", {
          reportPath: result.reportPath,
          summary: result.summary,
        }),
      );
    } else {
      process.stdout.write(`\n${result.summary}\n`);
      process.stdout.write(`Report: ${result.reportPath}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
