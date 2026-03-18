import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { formatToolArgs } from "../agent-log.js";
import { DualStreamLogger } from "./dual-stream-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_FSM = resolve(__dirname, "../../workflows/verifier.fsm.yaml");

export interface VerifyCoreArgs {
  planPath: string;
  testDir: string;
  model?: string;
  verbose?: boolean;
}

export interface VerifyCoreResult {
  reportPath: string | null;
}

/**
 * Core verification: runs the verifier agent via Agent SDK.
 *
 * The verifier agent uses `/freefsm:start verifier` to drive itself through
 * the verifier.fsm.yaml workflow. It receives MCP tools for embedded agent
 * control (run_agent, wait, send).
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { planPath, testDir } = args;
  const reportPath = join(testDir, "test-report.md");

  const dualLogger = new DualStreamLogger();
  const verifierServer = createVerifierMcpServer({
    logger: dualLogger,
    verbose: args.verbose,
  });

  const prompt = [
    `Run the e2e verifier workflow with: /freefsm:start ${VERIFIER_FSM}`,
    "",
    `Test plan file: ${resolve(planPath)}`,
    `Test output directory: ${resolve(testDir)}`,
    `Test report file: ${reportPath}`,
  ].join("\n");

  const session = query({
    prompt,
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project", "local"],
      mcpServers: {
        "freefsm-verifier": verifierServer,
      },
      ...(args.model !== undefined && { model: args.model }),
    },
  });

  try {
    for await (const message of session) {
      if (message.type === "assistant") {
        const msg = message as {
          type: "assistant";
          message: {
            content: Array<{
              type: string;
              text?: string;
              name?: string;
              input?: Record<string, unknown>;
            }>;
          };
        };
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text) {
            dualLogger.logVerifier(block.text);
          } else if (block.type === "tool_use" && block.name && args.verbose) {
            dualLogger.logVerifier(
              `⚡ ${block.name}${formatToolArgs(block.name, block.input)}`,
            );
          }
        }
      }
    }
  } finally {
    verifierServer.closeSession();
    session.close();
  }

  return { reportPath: existsSync(reportPath) ? reportPath : null };
}
