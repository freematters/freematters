import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { z } from "zod";
import { agentLog, colors as c, logSdkMessage } from "../agent-log.js";
import { MultiTurnSession } from "../e2e/multi-turn-session.js";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import {
  formatLiteCard,
  formatStateCard,
  handleError,
  stateCardFromFsm,
} from "../output.js";
import { symlinkSessionLog } from "../session-log.js";
import { type RunStatus, Store } from "../store.js";

const marked = new Marked(markedTerminal() as never);

function renderMarkdown(text: string): string {
  return (marked.parse(text) as string).trimEnd();
}

export interface RunArgs {
  fsmPath: string;
  runId?: string;
  root: string;
  json: boolean;
  prompt?: string;
  model?: string;
  verbose?: boolean;
  stay?: boolean;
  lite?: boolean;
  gateway?: string;
  apiKey?: string;
}

export interface RunCoreOptions {
  fsmPath: string;
  runId?: string;
  root: string;
  prompt?: string;
  model?: string;
  verbose?: boolean;
  stay?: boolean;
  lite?: boolean;
  logFn?: (msg: string, color?: string) => void;
}

export function generateRunId(fsmPath: string): string {
  const name = basename(fsmPath).replace(/\.(fsm\.)?ya?ml$/i, "");
  return `${name}-${Date.now()}`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, `${name}.md`), "utf-8");
}

function promptUser(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function buildSystemPrompt(fsm: Fsm): string {
  const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
  const template = loadPrompt("run-system");
  return template
    .replace("{{FSM_NAME}}", fsmName)
    .replace("{{FSM_GUIDE}}", fsm.guide ?? "No guide provided.");
}

/** MCP tool result shape returned by FSM tool handlers. */
export type McpToolResult = {
  isError?: true;
  content: Array<{ type: "text"; text: string }>;
};

/** Handler function type for FSM MCP tools. */
export type FsmToolHandler = (
  args: Record<string, unknown>,
  extra?: unknown,
) => Promise<McpToolResult>;

/**
 * Create raw FSM tool handler functions (for direct testing).
 * These are the same handlers registered via the SDK tool() wrapper.
 */
export function createFsmTools(
  fsm: Fsm,
  store: Store,
  runId: string,
  logFn: (msg: string, color?: string) => void = () => {},
  lite?: boolean,
): {
  fsm_goto: FsmToolHandler;
  fsm_current: FsmToolHandler;
  request_input: FsmToolHandler;
} {
  return {
    fsm_goto: fsmGotoHandler(fsm, store, runId, logFn, lite),
    fsm_current: fsmCurrentHandler(fsm, store, runId),
    request_input: requestInputHandler(fsm, store, runId),
  };
}

export function createFsmMcpServer(
  fsm: Fsm,
  store: Store,
  runId: string,
  logFn: (msg: string, color?: string) => void = () => {},
  lite?: boolean,
) {
  const tools = createFsmTools(fsm, store, runId, logFn, lite);
  const fsmGoto = tool(
    "fsm_goto",
    "Transition FSM to a new state",
    {
      target: z.string().describe("Target state name"),
      on: z.string().describe("Transition label"),
    },
    tools.fsm_goto,
  );

  const requestInput = tool(
    "request_input",
    "Ask the user for input. Blocks until the user responds on the CLI. Not available in terminal states.",
    {
      prompt: z.string().describe("Prompt message shown to the user"),
    },
    tools.request_input,
  );

  const fsmCurrent = tool(
    "fsm_current",
    "Get current FSM state card",
    {},
    tools.fsm_current,
  );

  return createSdkMcpServer({
    name: "freeflow",
    version: "1.0.0",
    tools: [fsmGoto, fsmCurrent, requestInput],
  });
}

function fsmGotoHandler(
  fsm: Fsm,
  store: Store,
  runId: string,
  logFn: (msg: string, color?: string) => void = () => {},
  lite?: boolean,
): FsmToolHandler {
  return async (rawArgs) => {
    const args = rawArgs as { target: string; on: string };
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

        // Track visited states in lite mode
        let alreadyVisited = false;
        let visitedStates: string[] | undefined;
        if (lite) {
          const visitedSet = new Set(snapshot.visited_states ?? []);
          alreadyVisited = visitedSet.has(args.target);
          visitedSet.add(args.target);
          visitedStates = [...visitedSet];
        }

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
          {
            run_status: newStatus,
            state: args.target,
            ...(visitedStates !== undefined && { visited_states: visitedStates }),
          },
          { lockHeld: true },
        );

        const card = stateCardFromFsm(args.target, targetState);
        let text =
          lite && alreadyVisited ? formatLiteCard(card) : formatStateCard(card);
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
  };
}

function requestInputHandler(fsm: Fsm, store: Store, runId: string): FsmToolHandler {
  return async (rawArgs) => {
    const args = rawArgs as { prompt: string };
    try {
      const snapshot = store.readSnapshot(runId);
      if (snapshot) {
        const currentFsmState = fsm.states[snapshot.state];
        if (
          snapshot.run_status !== "active" ||
          !currentFsmState ||
          Object.keys(currentFsmState.transitions).length === 0
        ) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Workflow is in terminal state "${snapshot.state}". Cannot request user input. Complete the state instructions and exit.`,
              },
            ],
          };
        }
      }

      process.stderr.write(`${c.yellow}${args.prompt}${c.reset}\n`);
      const answer = await promptUser(`${c.green}> ${c.reset}`);
      return {
        content: [{ type: "text" as const, text: answer }],
      };
    } catch (err: unknown) {
      return {
        isError: true as const,
        content: [
          {
            type: "text" as const,
            text: `Error reading input: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }
  };
}

function fsmCurrentHandler(fsm: Fsm, store: Store, runId: string): FsmToolHandler {
  return async () => {
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
  };
}

const MCP_TOOL_NAMES = [
  "mcp__freeflow__fsm_goto",
  "mcp__freeflow__fsm_current",
  "mcp__freeflow__request_input",
];

const log = agentLog;

/**
 * Core run logic shared between CLI run() and EmbeddedRun.
 *
 * Initializes the store, creates the FSM MCP server, and runs a multi-turn
 * agent session. Retries within the same session if the workflow is not
 * complete after a turn.
 *
 * Returns `{ runId, isError }` so callers can inspect the result.
 */
export async function runCore(
  opts: RunCoreOptions,
): Promise<{ runId: string; isError: boolean }> {
  const fsm: Fsm = loadFsm(opts.fsmPath);
  const runId = opts.runId ?? generateRunId(opts.fsmPath);
  const logFn = opts.logFn ?? log;

  const model = opts.model ?? "opus";
  logFn(`run=${runId} fsm=${opts.fsmPath} model=${model}`, c.cyan);

  const store = new Store(opts.root);
  const runAlreadyExists = store.runExists(runId);
  if (runAlreadyExists) {
    // Run was already initialized (e.g., by a gateway). Skip initRun.
    logFn(`run=${runId} already exists, resuming`, c.cyan);
  } else {
    try {
      store.initRun(runId, opts.fsmPath, opts.lite);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("already exists")) {
        throw new CliError(
          "RUN_EXISTS",
          "run already exists, use a different --run-id",
          {
            context: { runId },
          },
        );
      }
      throw err;
    }
  }

  if (!runAlreadyExists)
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
      {
        run_status: "active",
        state: fsm.initial,
        ...(opts.lite ? { visited_states: [fsm.initial] } : {}),
      },
    );

  logFn(`state=${fsm.initial} (initial)`, c.green);

  const fsmServer = createFsmMcpServer(fsm, store, runId, logFn, opts.lite);

  const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
  const stateCard = formatStateCard(card);
  const initialMessage = opts.prompt
    ? `${stateCard}\n\n## User Prompt\n\n${opts.prompt}`
    : stateCard;
  const systemPrompt = buildSystemPrompt(fsm);

  const allowedTools = fsm.allowed_tools
    ? [...MCP_TOOL_NAMES, ...fsm.allowed_tools]
    : undefined;

  const session = new MultiTurnSession({
    systemPrompt,
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
    mcpServers: { freeflow: fsmServer },
    ...(allowedTools !== undefined && { allowedTools }),
    model,
  });

  let isError = false;
  let attempt = 0;
  let sessionId: string | null = null;
  const pendingTasks = new Set<string>();
  session.send(initialMessage);

  try {
    for (;;) {
      attempt++;

      for await (const message of session.stream()) {
        // Capture and log session_id from the first message that has one
        if (!sessionId && "session_id" in message) {
          sessionId = (message as { session_id: string }).session_id;
          logFn(`session=${sessionId}`, c.cyan);
        }

        if (opts.verbose) {
          logSdkMessage(message, {
            sessionNum: attempt,
            skipTools: ["mcp__freeflow__request_input"],
          });
        }

        if (message.type === "result") {
          const resultMsg = message as {
            type: "result";
            result: string;
            is_error?: boolean;
            subtype?: string;
            num_turns?: number;
            duration_ms?: number;
          };
          if (resultMsg.is_error) {
            isError = true;
          }
          process.stdout.write(`${renderMarkdown(resultMsg.result)}\n`);
        } else if (message.type === "system") {
          const sysMsg = message as {
            type: "system";
            subtype?: string;
            task_id?: string;
            description?: string;
            status?: string;
            summary?: string;
          };
          if (sysMsg.subtype === "task_started" && sysMsg.task_id) {
            pendingTasks.add(sysMsg.task_id);
            logFn(`task started: ${sysMsg.description ?? sysMsg.task_id}`, c.cyan);
          } else if (sysMsg.subtype === "task_notification" && sysMsg.task_id) {
            pendingTasks.delete(sysMsg.task_id);
            logFn(
              `task ${sysMsg.status}: ${sysMsg.summary ?? sysMsg.task_id}`,
              sysMsg.status === "completed" ? c.green : c.red,
            );
          }
        }
      }

      // If background tasks are still running, continue streaming —
      // the SDK will yield task notifications and wake the model.
      if (pendingTasks.size > 0) {
        logFn(
          `waiting for ${pendingTasks.size} background task(s) to complete`,
          c.cyan,
        );
        continue;
      }

      const snap = store.readSnapshot(runId);
      const workflowDone =
        !snap ||
        snap.run_status !== "active" ||
        !fsm.states[snap.state] ||
        Object.keys(fsm.states[snap.state].transitions).length === 0;

      if (workflowDone) {
        if (opts.stay) {
          logFn(
            `run finished: ${snap?.run_status ?? "unknown"} state=${snap?.state ?? "?"} — staying for input`,
            c.green,
          );
          const userInput = await promptUser(`${c.green}> ${c.reset}`);
          session.send(userInput);
          continue;
        }
        logFn(
          `run finished: ${snap?.run_status ?? "unknown"} state=${snap?.state ?? "?"}`,
          c.green,
        );
        break;
      }

      logFn(
        `turn ended but workflow not complete, state=${snap.state} — retrying`,
        c.magenta,
      );
      session.send(
        `The workflow is not complete yet. Continue from the current state.\n\n${formatStateCard(stateCardFromFsm(snap.state, fsm.states[snap.state] ?? { transitions: {} }))}`,
      );
    }
  } finally {
    session.close();
  }

  // Symlink the Claude session JSONL log into the run dir
  const runDir = join(opts.root, "runs", runId);
  symlinkSessionLog(sessionId, runDir, "session.jsonl");

  return { runId, isError };
}

export async function run(args: RunArgs): Promise<void> {
  try {
    if (args.gateway) {
      await runViaGateway(args);
    } else {
      await runCore({
        fsmPath: args.fsmPath,
        runId: args.runId,
        root: args.root,
        prompt: args.prompt,
        model: args.model,
        verbose: args.verbose,
        stay: args.stay,
        lite: args.lite,
      });
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}

async function runViaGateway(args: RunArgs): Promise<void> {
  const { GatewayCliClient } = await import("../gateway/cli-client.js");
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const client = new GatewayCliClient({
    gatewayUrl: args.gateway as string,
    apiKey: args.apiKey,
  });

  log(`Connecting to gateway: ${args.gateway}`, c.cyan);
  await client.connect();
  log("Connected to gateway", c.green);

  let currentRunId: string | undefined;
  let done = false;

  client.on("run_created", (msg) => {
    currentRunId = msg.run_id;
    log(`run=${msg.run_id}`, c.cyan);
  });

  client.on("run_started", (msg) => {
    log(`state=${msg.state} (initial)`, c.green);
  });

  client.on("agent_output", (msg) => {
    process.stdout.write(msg.content);
    if (!msg.stream) {
      process.stdout.write("\n");
    }
  });

  client.on("user_input", (msg) => {
    // Replay of user input — show in bright white
    process.stdout.write(`\x1b[1;37m> ${msg.input}\x1b[0m\n`);
  });

  client.on("state_changed", (msg) => {
    log(`state: ${msg.from} → ${msg.to}`, c.green);
  });

  client.on("run_completed", (msg) => {
    log(`run finished: ${msg.status}`, c.green);
    done = true;
    rl.close();
  });

  client.on("error", (msg) => {
    log(`error: ${msg.message}`, c.red);
  });

  // Create the run
  client.createRun(args.fsmPath, args.runId, args.prompt);

  // Forward stdin as user_input
  rl.on("line", (line) => {
    if (currentRunId) {
      client.sendInput(currentRunId, line);
    }
  });

  // Wait until run completes
  await new Promise<void>((resolve) => {
    if (done) {
      resolve();
      return;
    }
    client.on("run_completed", () => resolve());
    client.on("close", () => resolve());
  });

  client.close();
}
