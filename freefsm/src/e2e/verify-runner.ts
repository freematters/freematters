import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DualStreamLogger } from "./dual-stream-logger.js";
import { createVerifierMcpServer } from "./verifier-tools.js";
import { runCore } from "../commands/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_FSM = resolve(__dirname, "../../workflows/verifier.fsm.yaml");

export interface VerifyCoreArgs {
  planPath: string;
  testDir: string;
  model?: string;
  verbose?: boolean;
}

export interface VerifyCoreResult {
  reportPath: string;
}

/**
 * Core verification: runs the verifier FSM workflow via `freefsm run`.
 *
 * The verifier agent is driven by `verifier.fsm.yaml` and receives:
 * - The test plan file path and test output directory as the initial prompt
 * - MCP tools for embedded agent interaction (start_embedded_run, wait, send_input)
 *
 * The agent reads the test plan, starts an embedded freefsm run, interacts with it,
 * and writes a test report to testDir.
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { planPath, testDir } = args;
  const reportPath = join(testDir, "test-report.md");

  const dualLogger = new DualStreamLogger();
  const verifierServer = createVerifierMcpServer({ logger: dualLogger });

  const prompt = `Test plan file: ${resolve(planPath)}\nTest output directory: ${resolve(testDir)}`;

  await runCore({
    fsmPath: VERIFIER_FSM,
    root: join(testDir, ".freefsm"),
    prompt,
    model: args.model,
    verbose: args.verbose,
    additionalMcpServers: { "freefsm-verifier": verifierServer },
  });

  return { reportPath };
}
