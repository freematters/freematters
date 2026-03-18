import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { DualStreamLogger } from "./dual-stream-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";

export interface VerifyCoreArgs {
  planMarkdown: string;
  testDir: string;
  model?: string;
}

export interface VerifyCoreResult {
  reportPath: string;
  summary: string;
}

/**
 * Build the verifier system prompt explaining the embedded approach tools.
 */
function buildVerifierSystemPrompt(testDir: string): string {
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
6. **Report**: Write a test report to \`${testDir}/test-report.md\`.

## Judgment Rules

- Execute each test step as described in the plan.
- Compare actual behavior against expected outcomes.
- Do NOT skip steps or invent steps not in the plan.
- The test plan determines what input to provide — you decide the appropriate input based on the step descriptions.

## Final Output

After completing all steps, output a high-level summary of the test results. Include:
- Overall verdict: PASS or FAIL
- Brief description of what happened
- Any failures with evidence
`;
}

/**
 * Core verification loop: launches a verifier agent with embedded run MCP tools,
 * passes the raw test plan markdown, and captures the agent's summary.
 *
 * The verifier agent autonomously:
 * 1. Reads the test plan markdown
 * 2. Starts the embedded freefsm run
 * 3. Observes output via wait()
 * 4. Provides input via send_input() when request_input is detected
 * 5. Reads store files after completion
 * 6. Writes test report to testDir
 * 7. Outputs a high-level summary
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { planMarkdown, testDir } = args;

  const dualLogger = new DualStreamLogger();
  const reportPath = join(testDir, "test-report.md");
  let summary = "";

  // Create verifier MCP server with the new embedded tools
  const verifierServer = createVerifierMcpServer({ logger: dualLogger });

  // Build system prompt for the verifier agent
  const systemPrompt = buildVerifierSystemPrompt(testDir);

  // Pass the raw markdown as the initial message
  const initialMessage = planMarkdown;

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
    // Log verifier's assistant text via DualStreamLogger (no tool output)
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
        summary = resultMsg.result;
      }
    }
  }

  // Write summary as report if the agent didn't write one via file tools
  if (summary) {
    writeFileSync(reportPath, summary, "utf-8");
  }

  return { reportPath, summary };
}
