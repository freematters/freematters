import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { agentLog, colors as c, logSdkMessage } from "../agent-log.js";
import type { MessageBus } from "../e2e/message-bus.js";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import { formatStateCard, handleError, stateCardFromFsm } from "../output.js";
import { type RunStatus, Store } from "../store.js";

export interface RunArgs {
  fsmPath: string;
  runId?: string;
  root: string;
  json: boolean;
  prompt?: string;
}

/**
 * Options for the shared runCore function.
 * When `bus` is provided, request_input uses the MessageBus instead of readline,
 * and result output goes to the bus instead of stdout.
 */
export interface RunCoreOptions {
  fsmPath: string;
  runId?: string;
  root: string;
  prompt?: string;
  bus?: MessageBus;
  logFn?: (msg: string, color?: string) => void;
}

function generateRunId(fsmPath: string): string {
  const name = basename(fsmPath).replace(/\.(fsm\.)?ya?ml$/i, "");
  return `${name}-${Date.now()}`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
}

function buildSystemPrompt(fsm: Fsm): string {
  const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
  const template = loadPrompt("run-system");
  return template
    .replace("{{FSM_NAME}}", fsmName)
    .replace("{{FSM_GUIDE}}", fsm.guide ?? "No guide provided.");
}

function createFsmMcpServer(
  fsm: Fsm,
  store: Store,
  runId: string,
  logFn: (msg: string, color?: string) => void = () => {},
  bus?: MessageBus,
) {
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

          logFn(
            `fsm_goto: ${snapshot.state} —[${args.on}]→ ${args.target}${isTerminal ? " (terminal)" : ""}`,
            c.green,
          );

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
      logFn(`request_input: ${args.prompt}`, c.magenta);

      if (bus) {
        // Embedded mode: use MessageBus instead of readline
        const input = await bus.enqueueInputRequest(args.prompt);
        return {
          content: [{ type: "text" as const, text: input }],
        };
      }

      // CLI mode: use readline on stdin
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

const log = agentLog;

/**
 * Core run logic shared between CLI run() and EmbeddedRun.
 *
 * Initializes the store, creates the FSM MCP server, and runs the agent loop.
 * When `opts.bus` is provided, request_input uses the bus instead of readline,
 * and result output goes to the bus instead of stdout.
 *
 * Returns `{ runId, isError }` so callers can inspect the result.
 */
export async function runCore(
  opts: RunCoreOptions,
): Promise<{ runId: string; isError: boolean }> {
  const fsm: Fsm = loadFsm(opts.fsmPath);
  const runId = opts.runId ?? generateRunId(opts.fsmPath);
  const logFn = opts.logFn ?? log;

  logFn(`run=${runId} fsm=${opts.fsmPath}`, c.cyan);

  const store = new Store(opts.root);
  try {
    store.initRun(runId, opts.fsmPath);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("already exists")) {
      throw new CliError("RUN_EXISTS", "run already exists, use a different --run-id", {
        context: { runId },
      });
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

  logFn(`state=${fsm.initial} (initial)`, c.green);

  const fsmServer = createFsmMcpServer(fsm, store, runId, logFn, opts.bus);

  const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
  const stateCard = formatStateCard(card);
  const initialMessage = opts.prompt
    ? `${stateCard}\n\n## User Prompt\n\n${opts.prompt}`
    : stateCard;
  const systemPrompt = buildSystemPrompt(fsm);

  const allowedTools = fsm.allowed_tools
    ? [...MCP_TOOL_NAMES, ...fsm.allowed_tools]
    : undefined;

  const queryOpts = {
    systemPrompt,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    mcpServers: { freefsm: fsmServer },
    ...(allowedTools !== undefined && { allowedTools }),
  };

  let isError = false;
  const MAX_SESSIONS = 10;
  let attempt = 0;
  let prompt = initialMessage;
  for (;;) {
    attempt++;
    logFn(`session #${attempt} starting`, c.cyan);

    const session = query({ prompt, options: queryOpts });
    for await (const message of session) {
      logSdkMessage(message, { sessionNum: attempt });
      if (message.type === "result") {
        const resultMsg = message as {
          type: "result";
          result: string;
          is_error?: boolean;
        };
        if (resultMsg.is_error) {
          isError = true;
        }
        if (opts.bus) {
          // Embedded mode: route result to bus
          opts.bus.enqueueOutput(resultMsg.result);
        } else {
          // CLI mode: write to stdout
          process.stdout.write(`${resultMsg.result}\n`);
        }
      }
    }

    const snap = store.readSnapshot(runId);
    if (!snap || snap.run_status !== "active") {
      logFn(
        `run finished: ${snap?.run_status ?? "unknown"} state=${snap?.state ?? "?"}`,
        c.green,
      );
      break;
    }

    const currentState = fsm.states[snap.state];
    if (!currentState || Object.keys(currentState.transitions).length === 0) {
      logFn(`run finished: terminal state=${snap.state}`, c.green);
      break;
    }

    if (attempt >= MAX_SESSIONS) {
      logFn(`max sessions (${MAX_SESSIONS}) reached, aborting run`, c.red);
      store.commit(
        runId,
        {
          event: "finish",
          from_state: snap.state,
          to_state: snap.state,
          on_label: null,
          actor: "system",
          reason: "max_sessions_exceeded",
        },
        { run_status: "aborted", state: snap.state },
      );
      break;
    }

    logFn(
      `session ended but workflow not complete, state=${snap.state} — retrying`,
      c.magenta,
    );
    prompt = `The workflow is not complete yet. Continue executing the current state. If you need user input, use \`request_input\`. Do NOT stop until you reach a terminal state.\n\n${formatStateCard(stateCardFromFsm(snap.state, currentState))}`;
  }

  return { runId, isError };
}

export async function run(args: RunArgs): Promise<void> {
  try {
    await runCore({
      fsmPath: args.fsmPath,
      runId: args.runId,
      root: args.root,
      prompt: args.prompt,
    });
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
