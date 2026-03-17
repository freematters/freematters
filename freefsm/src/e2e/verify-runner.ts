import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { type Fsm, loadFsm } from "../fsm.js";
import { formatStateCard, stateCardFromFsm } from "../output.js";
import { type RunStatus, Store } from "../store.js";
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(__dirname, "../../workflows");
const PROMPTS_DIR = join(__dirname, "../../prompts");

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
 * Build the system prompt that instructs the agent to execute the test plan.
 * Kept for backward compatibility and used in tests.
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

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
}

function buildFsmSystemPrompt(fsm: Fsm): string {
  const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
  const template = loadPrompt("run-system");
  return template
    .replace("{{FSM_NAME}}", fsmName)
    .replace("{{FSM_GUIDE}}", fsm.guide ?? "No guide provided.");
}

function createVerifierMcpServer(fsm: Fsm, store: Store, runId: string) {
  const fsmGoto = tool(
    "fsm_goto",
    "Transition FSM to a new state",
    {
      target: z.string().describe("Target state name"),
      on: z.string().describe("Transition label"),
    },
    async (args) => {
      try {
        if (!(args.target in fsm.states)) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Error: target state "${args.target}" does not exist in FSM`,
              },
            ],
          };
        }

        return store.withLock(runId, () => {
          const snapshot = store.readSnapshot(runId);
          if (!snapshot) {
            return {
              isError: true as const,
              content: [{ type: "text" as const, text: "Error: run has no snapshot" }],
            };
          }

          if (snapshot.run_status !== "active") {
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Error: run is ${snapshot.run_status}, not active`,
                },
              ],
            };
          }

          const currentState = fsm.states[snapshot.state];
          const expectedTarget = currentState.transitions[args.on];

          if (expectedTarget !== args.target) {
            const entries = Object.entries(currentState.transitions);
            const labels = entries.map(([l, t]) => `  ${l} → ${t}`).join("\n");
            return {
              isError: true as const,
              content: [
                {
                  type: "text" as const,
                  text: `Error: no transition "${args.on}" → "${args.target}" from state "${snapshot.state}"\nAvailable transitions:\n${labels}`,
                },
              ],
            };
          }

          const targetState = fsm.states[args.target];
          const isTerminal = Object.keys(targetState.transitions).length === 0;
          const newStatus: RunStatus = isTerminal ? "completed" : "active";

          store.commit(
            runId,
            {
              event: "goto",
              from_state: snapshot.state,
              to_state: args.target,
              on_label: args.on,
              actor: "agent",
              reason: isTerminal ? "done_auto" : null,
            },
            { run_status: newStatus, state: args.target },
            { lockHeld: true },
          );

          const card = stateCardFromFsm(args.target, targetState);
          let text = formatStateCard(card);
          if (isTerminal) {
            text += "\n\nThis is a terminal state. The workflow is complete.";
          }

          return {
            content: [{ type: "text" as const, text }],
          };
        });
      } catch (err: unknown) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  const fsmCurrent = tool("fsm_current", "Get current FSM state card", {}, async () => {
    try {
      const snapshot = store.readSnapshot(runId);
      if (!snapshot) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: "Error: run has no snapshot" }],
        };
      }

      const fsmState = fsm.states[snapshot.state];
      const card = stateCardFromFsm(snapshot.state, fsmState);
      return {
        content: [{ type: "text" as const, text: formatStateCard(card) }],
      };
    } catch (err: unknown) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  });

  return createSdkMcpServer({
    name: "freefsm",
    version: "1.0.0",
    tools: [fsmGoto, fsmCurrent],
  });
}

/**
 * Core verification loop: loads the verifier.fsm.yaml workflow, initializes
 * an FSM run, launches an Agent SDK session with FSM MCP tools, streams
 * messages through TranscriptLogger, generates a report, and returns results.
 */
export async function verifyCore(args: VerifyCoreArgs): Promise<VerifyCoreResult> {
  const { plan, testDir } = args;

  // Load the verifier FSM workflow
  const verifierFsmPath = join(WORKFLOWS_DIR, "verifier.fsm.yaml");
  const fsm = loadFsm(verifierFsmPath);

  // Initialize FSM store and run
  const fsmRoot = join(testDir, ".freefsm");
  const store = new Store(fsmRoot);
  const runId = `verifier-${Date.now()}`;
  store.initRun(runId, verifierFsmPath);

  // Commit start event
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

  const logger = new TranscriptLogger(testDir);

  try {
    // Create FSM MCP server for state management
    const fsmServer = createVerifierMcpServer(fsm, store, runId);

    // Build system prompt from FSM template (includes fsm_goto/fsm_current instructions)
    const systemPrompt = buildFsmSystemPrompt(fsm);

    // Build initial message: state card + test plan context
    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
    const stateCardText = formatStateCard(card);
    const testPlanContext = buildTestPlanContext(plan);
    const initialMessage = `${stateCardText}\n\n---\n\n${testPlanContext}`;

    const session = query({
      prompt: initialMessage,
      options: {
        systemPrompt,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        mcpServers: { freefsm: fsmServer },
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
