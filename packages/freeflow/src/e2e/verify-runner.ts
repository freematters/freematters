import { copyFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { formatToolArgs } from "../agent-log.js";
import { symlinkSessionLog } from "../session-log.js";
import { DualStreamLogger } from "./dual-stream-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_FSM = resolve(__dirname, "../../workflows/verifier/workflow.yaml");

export interface VerifyCoreArgs {
  planPath: string;
  testDir: string;
  root?: string;
  model?: string;
  verbose?: boolean;
}

export interface VerifyCoreResult {
  reportPath: string | null;
}

/**
 * Core verification: runs the verifier agent via Agent SDK.
 *
 * The verifier agent uses `/fflow verifier` to drive itself through
 * the verifier.workflow.yaml workflow. It receives MCP tools for embedded agent
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

  const runId = `verifier-${Date.now()}`;
  const prompt = [
    `Run the e2e verifier workflow with: /fflow ${VERIFIER_FSM} --run-id ${runId}`,
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
        "freeflow-verifier": verifierServer,
      },
      ...(args.model !== undefined && { model: args.model }),
    },
  });

  let sessionId: string | null = null;

  try {
    for await (const message of session) {
      // Capture session_id from the first message that has one
      if (!sessionId && "session_id" in message) {
        sessionId = (message as { session_id: string }).session_id;
        dualLogger.logVerifier(`session: ${sessionId}`);
      }

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

  // Symlink both Claude session JSONL logs into the verifier's FSM run dir.
  // We generated the run ID above, so the path is deterministic.
  const embeddedSessionId = verifierServer.embeddedSessionId;
  const verifierRunDir = args.root ? join(args.root, "runs", runId) : null;

  if (verifierRunDir && existsSync(verifierRunDir)) {
    symlinkSessionLog(sessionId, verifierRunDir, "verifier-session.jsonl");
    symlinkSessionLog(embeddedSessionId, verifierRunDir, "executor-session.jsonl");
    // Copy the test plan into the run directory for self-contained debugging
    try {
      copyFileSync(resolve(planPath), join(verifierRunDir, basename(planPath)));
    } catch {
      // Best-effort — don't fail the run if copy fails
    }
  }

  return { reportPath: existsSync(reportPath) ? reportPath : null };
}
