import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { TestPlan } from "./parser.js";
import { generateJsonReport, generateReport } from "./report-generator.js";
import type { JsonReport } from "./report-generator.js";
import { TranscriptLogger } from "./transcript-logger.js";

export interface VerifyCoreArgs {
  plan: TestPlan;
  testDir: string;
  model?: string;
}

export interface VerifyCoreResult {
  reportPath: string;
  jsonReport: JsonReport;
}

/**
 * Build the system prompt that instructs the agent to execute the test plan.
 */
export function buildVerifySystemPrompt(plan: TestPlan): string {
  const lines: string[] = [];

  lines.push(`# E2E Test Verification: ${plan.name}`);
  lines.push("");
  lines.push(
    "You are an automated E2E test verifier. Your job is to execute the test plan below, " +
      "observe the results, and judge whether each step passes or fails.",
  );
  lines.push("");

  // Setup
  if (plan.setup.length > 0) {
    lines.push("## Setup");
    lines.push("Execute these setup steps first:");
    for (const item of plan.setup) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  // Steps
  lines.push("## Steps");
  lines.push("Execute each step in order. For each step:");
  lines.push("1. Run the described action");
  lines.push("2. Observe the result");
  lines.push("3. Compare against the expected outcome");
  lines.push("4. Judge PASS or FAIL with evidence");
  lines.push("");
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`### Step ${i + 1}: ${step.name}`);
    lines.push(`**Action**: ${step.action}`);
    if (step.expected) {
      lines.push(`**Expected**: ${step.expected}`);
    }
    lines.push("");
  }

  // Expected Outcomes
  lines.push("## Expected Outcomes");
  lines.push("After all steps, verify these overall outcomes:");
  for (const outcome of plan.expectedOutcomes) {
    lines.push(`- ${outcome}`);
  }
  lines.push("");

  // Cleanup
  if (plan.cleanup.length > 0) {
    lines.push("## Cleanup");
    lines.push("After verification, execute these cleanup steps:");
    for (const item of plan.cleanup) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  // Instructions for output format
  lines.push("## Output Format");
  lines.push("After executing all steps, provide a summary with:");
  lines.push("- Per-step verdict (PASS/FAIL) with evidence");
  lines.push("- Overall verdict (PASS if all steps pass, FAIL otherwise)");
  lines.push("- Any errors or unexpected observations");

  return lines.join("\n");
}

/**
 * Core verification loop: launches an Agent SDK session with the test plan,
 * streams messages through TranscriptLogger, generates a report, and returns results.
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { plan, testDir } = args;

  const logger = new TranscriptLogger(testDir);

  try {
    const systemPrompt = buildVerifySystemPrompt(plan);
    const initialMessage = `Execute the E2E test plan "${plan.name}" now. Follow the steps in order.`;

    const session = query({
      prompt: initialMessage,
      options: {
        systemPrompt,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
      },
    });

    for await (const message of session) {
      logger.processMessage(message as { type: string; [key: string]: unknown });

      if (message.type === "result") {
        const resultMsg = message as SDKMessage & {
          type: "result";
          result?: string;
        };
        if (resultMsg.result) {
          process.stdout.write(`${resultMsg.result}\n`);
        }
      }
    }
  } finally {
    logger.close();
  }

  // Generate report after agent session completes
  const reportContent = generateReport(plan, testDir);
  const reportPath = join(testDir, "test-report.md");
  writeFileSync(reportPath, reportContent, "utf-8");

  const jsonReport = generateJsonReport(plan, testDir);

  return { reportPath, jsonReport };
}
