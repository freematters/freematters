import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../agent-log.js";
import { DualStreamLogger } from "./dual-stream-logger.js";
import type { TestPlan } from "./parser.js";
import {
  generateJsonReport,
  generateReport,
  readTranscript,
} from "./report-generator.js";
import type { JsonReport } from "./report-generator.js";
import { TranscriptLogger } from "./transcript-logger.js";
import type { TranscriptEntry } from "./transcript-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";

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
 * Build a test plan context string to include in the initial message
 * so the agent knows what test plan it is verifying.
 */
export function buildTestPlanContext(plan: TestPlan): string {
  const lines: string[] = [];

  lines.push(`# Test Plan: ${plan.name}`);
  lines.push("");

  if (plan.setup.length > 0) {
    lines.push("## Setup");
    for (const item of plan.setup) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  lines.push("## Steps");
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`${i + 1}. **${step.name}**: ${step.action}`);
    if (step.expected) {
      lines.push(`   - Expected: ${step.expected}`);
    }
  }
  lines.push("");

  lines.push("## Expected Outcomes");
  for (const outcome of plan.expectedOutcomes) {
    lines.push(`- ${outcome}`);
  }
  lines.push("");

  if (plan.cleanup.length > 0) {
    lines.push("## Cleanup");
    for (const item of plan.cleanup) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build the verifier system prompt explaining the embedded approach tools.
 */
function buildVerifierSystemPrompt(): string {
  return `You are an E2E test verifier for freefsm workflows. Your job is to execute a test plan by running an embedded freefsm agent and observing its behavior.

## Available Tools

You have MCP tools to interact with an embedded freefsm agent:

### start_embedded_run
Start an embedded freefsm run. Provide the FSM workflow path (from the test plan's Setup section) and optionally a user prompt.
Returns \`{ run_id, store_root }\`.

### wait
Wait for the next event from the embedded agent. Returns one of:
- \`{ status: "output", text }\` — the embedded agent produced text output
- \`{ status: "awaiting_input", prompt, output }\` — the embedded agent is requesting user input via \`request_input\`
- \`{ status: "exited", code, output }\` — the embedded agent session has ended
- \`{ status: "timeout" }\` — the wait timed out

### send_input
Send input text to the embedded agent when it is awaiting input (after receiving an \`awaiting_input\` status from \`wait\`). Fails if no input request is pending.

You also have standard file tools (Read, Write, Bash) for reading store files and writing the test report.

## Verification Process

1. **Start**: Call \`start_embedded_run\` with the FSM workflow path from the test plan's Setup section.
2. **Observe**: Call \`wait()\` to observe the embedded agent's behavior.
3. **Interact**: When you receive \`awaiting_input\`, decide what input to provide based on the test plan steps, then call \`send_input()\`.
4. **Repeat**: Continue calling \`wait()\` until the embedded agent exits.
5. **Inspect**: After the run completes, read the store files (\`events.jsonl\`, \`snapshot.json\`) at the \`store_root\` path to verify FSM state transitions.
6. **Report**: Write a test report to the test output directory.

## Judgment Rules

- Execute each test step as described in the plan.
- Compare actual behavior against expected outcomes.
- Judge each step as PASS or FAIL with evidence.
- Do NOT skip steps or invent steps not in the plan.
- The test plan determines what input to provide — you decide the appropriate input based on the step descriptions.
`;
}

/**
 * Core verification loop: launches a verifier agent with embedded run MCP tools,
 * streams messages through TranscriptLogger, generates a report, and returns results.
 *
 * The verifier agent autonomously:
 * 1. Starts the embedded freefsm run
 * 2. Observes output via wait()
 * 3. Provides input via send_input() when request_input is detected
 * 4. Reads store files after completion
 * 5. Writes test report
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { plan, testDir } = args;

  const logger = new TranscriptLogger(testDir);
  const dualLogger = new DualStreamLogger();
  const reportPath = join(testDir, "test-report.md");
  let finalEntries: TranscriptEntry[] = [];

  try {
    // Create verifier MCP server with the new embedded tools
    const verifierServer = createVerifierMcpServer({ logger: dualLogger });

    // Build system prompt for the verifier agent
    const systemPrompt = buildVerifierSystemPrompt();

    // Build initial message: test plan context
    const testPlanContext = buildTestPlanContext(plan);
    const initialMessage = `${testPlanContext}\n\n---\n\nTest output directory: ${testDir}`;

    const queryOptions: Parameters<typeof query>[0]["options"] = {
      systemPrompt,
      mcpServers: { "freefsm-verifier": verifierServer },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    };

    if (args.model) {
      queryOptions.model = args.model;
    }

    const session = query({
      prompt: initialMessage,
      options: queryOptions,
    });

    for await (const message of session) {
      logger.processMessage(message);
      logSdkMessage(message);

      // Log verifier's assistant text via DualStreamLogger
      if (message.type === "assistant") {
        const msg = message as {
          type: "assistant";
          message: {
            content: Array<{ type: string; text?: string }>;
          };
        };
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            dualLogger.logVerifier(block.text);
          }
        }
      }

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
    await logger.close();

    // Generate reports in finally block so partial reports are written even on errors
    finalEntries = readTranscript(testDir);
    const reportContent = generateReport(plan, testDir, finalEntries);
    writeFileSync(reportPath, reportContent, "utf-8");
  }

  const jsonReport = generateJsonReport(plan, testDir, finalEntries);

  return { reportPath, jsonReport };
}
