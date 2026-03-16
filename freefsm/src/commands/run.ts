import { basename } from "node:path";
import { createInterface } from "node:readline";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import { formatStateCard, handleError, stateCardFromFsm } from "../output.js";
import { type RunStatus, Store } from "../store.js";

export interface RunArgs {
  fsmPath: string;
  runId?: string;
  root: string;
  json: boolean;
}

function generateRunId(fsmPath: string): string {
  const name = basename(fsmPath).replace(/\.(fsm\.)?ya?ml$/i, "");
  return `${name}-${Date.now()}`;
}

function buildSystemPrompt(fsm: Fsm): string {
  const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
  return `You are an FSM-driven agent executing the "${fsmName}" workflow.

## FSM Guide
${fsm.guide ?? "No guide provided."}

## How to Use FSM Tools
- Call \`fsm_current\` to see your current state and instructions.
- Call \`fsm_goto\` with \`target\` (state name) and \`on\` (transition label) to move to the next state.
- Call \`request_input\` when you need information from the human.
- Execute the state's instructions before transitioning.
- The workflow ends when you reach a state with no transitions.

## Rules
- Follow state instructions exactly.
- Do NOT skip states or transitions.
- Only use valid transition labels shown in the state card.`;
}

function createFsmMcpServer(fsm: Fsm, store: Store, runId: string) {
  const fsmGoto = tool(
    "fsm_goto",
    "Transition FSM to a new state",
    {
      target: z.string().describe("Target state name"),
      on: z.string().describe("Transition label"),
    },
    async (args) => {
      try {
        // Validate target state exists
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
              content: [
                {
                  type: "text" as const,
                  text: "Error: run has no snapshot",
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
          content: [
            {
              type: "text" as const,
              text: "Error: run has no snapshot",
            },
          ],
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

  const requestInput = tool(
    "request_input",
    "Ask the human for input via stdin",
    {
      prompt: z.string().describe("The question to ask the human"),
    },
    async (args) => {
      process.stderr.write(`${args.prompt}\n`);

      return new Promise<{
        content: Array<{ type: "text"; text: string }>;
      }>((resolve) => {
        const rl = createInterface({
          input: process.stdin,
          terminal: false,
        });

        let resolved = false;

        rl.once("line", (line) => {
          resolved = true;
          rl.close();
          resolve({
            content: [{ type: "text" as const, text: line }],
          });
        });

        rl.once("close", () => {
          if (resolved) return;
          // close fired before line — stdin hit EOF
          resolve({
            content: [
              {
                type: "text" as const,
                text: "EOF: stdin closed, no input available",
              },
            ],
          });
        });
      });
    },
  );

  return createSdkMcpServer({
    name: "freefsm",
    version: "1.0.0",
    tools: [fsmGoto, fsmCurrent, requestInput],
  });
}

const MCP_TOOL_NAMES = [
  "mcp__freefsm__fsm_goto",
  "mcp__freefsm__fsm_current",
  "mcp__freefsm__request_input",
];

export async function run(args: RunArgs): Promise<void> {
  try {
    const fsm: Fsm = loadFsm(args.fsmPath);
    const runId = args.runId ?? generateRunId(args.fsmPath);

    const store = new Store(args.root);
    try {
      store.initRun(runId, args.fsmPath);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) {
        throw new CliError(
          "RUN_EXISTS",
          "run already exists, use a different --run-id",
          { context: { runId } },
        );
      }
      throw err;
    }

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

    const fsmServer = createFsmMcpServer(fsm, store, runId);

    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
    const initialMessage = formatStateCard(card);
    const systemPrompt = buildSystemPrompt(fsm);

    const allowedTools = fsm.allowed_tools
      ? [...MCP_TOOL_NAMES, ...fsm.allowed_tools]
      : undefined;

    const session = query({
      prompt: initialMessage,
      options: {
        systemPrompt,
        mcpServers: { freefsm: fsmServer },
        ...(allowedTools !== undefined && { allowedTools }),
      },
    });

    for await (const message of session) {
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & {
          type: "result";
          result: string;
        };
        process.stdout.write(`${resultMsg.result}\n`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof CliError) {
      handleError(err, args.json);
    }
    throw err;
  }
}
