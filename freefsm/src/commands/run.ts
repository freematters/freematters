import { basename } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import { formatStateCard, handleError, stateCardFromFsm } from "../output.js";
import { Store } from "../store.js";

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

    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
    const initialMessage = formatStateCard(card);
    const systemPrompt = buildSystemPrompt(fsm);

    const session = query({
      prompt: initialMessage,
      options: {
        systemPrompt,
      },
    });

    for await (const message of session) {
      if (message.type === "result") {
        const resultMsg = message as SDKMessage & { type: "result"; result: string };
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
