import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { loadFsm } from "../fsm.js";
import { formatStateCard, stateCardFromFsm } from "../output.js";
import { Store } from "../store.js";
import { createFsmMcpServer } from "../commands/run.js";
import { DualStreamLogger } from "./dual-stream-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_FSM = resolve(__dirname, "../../workflows/verifier.fsm.yaml");

export interface VerifyCoreArgs {
  planPath: string;
  testDir: string;
  model?: string;
}

export interface VerifyCoreResult {
  reportPath: string;
}

/**
 * Core verification: runs the verifier FSM workflow directly via Agent SDK.
 *
 * The verifier agent is driven by `verifier.fsm.yaml` and receives:
 * - The test plan file path and test output directory as the initial prompt
 * - MCP tools: FSM tools (fsm_goto, fsm_current) + verifier tools (run_agent, wait, send)
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { planPath, testDir } = args;
  const reportPath = join(testDir, "test-report.md");

  // Load verifier FSM
  const fsm = loadFsm(VERIFIER_FSM);
  const storeRoot = join(testDir, ".freefsm");
  const runId = `verifier-${Date.now()}`;

  // Init store for the verifier's own FSM
  const store = new Store(storeRoot);
  store.initRun(runId, VERIFIER_FSM);
  store.commit(
    runId,
    {
      event: "start",
      from_state: null,
      to_state: fsm.initial,
      on_label: null,
      actor: "system",
      reason: null,
    },
    { run_status: "active", state: fsm.initial },
  );

  // Create MCP servers
  const dualLogger = new DualStreamLogger();
  const fsmServer = createFsmMcpServer(fsm, store, runId);
  const verifierServer = createVerifierMcpServer({ logger: dualLogger });

  // Build initial message
  const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
  const stateCard = formatStateCard(card);
  const prompt = `${stateCard}\n\nTest plan file: ${resolve(planPath)}\nTest output directory: ${resolve(testDir)}`;

  // Build system prompt
  const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
  const systemPrompt = `You are running the "${fsmName}" workflow.\n\n## FSM Guide\n\n${fsm.guide ?? "No guide provided."}`;

  // Run the verifier agent
  const session = query({
    prompt,
    options: {
      systemPrompt,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      mcpServers: {
        freefsm: fsmServer,
        "freefsm-verifier": verifierServer,
      },
      ...(args.model !== undefined && { model: args.model }),
    },
  });

  for await (const message of session) {
    // Log verifier assistant text
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
  }

  return { reportPath };
}
