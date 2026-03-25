import { randomBytes } from "node:crypto";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import {
  formatStateCard,
  formatSubagentDispatch,
  fsmToMermaid,
  handleError,
  jsonSuccess,
  printJson,
  stateCardFromFsm,
} from "../output.js";
import { Store } from "../store.js";

function generateRunId(): string {
  return randomBytes(6).toString("base64url");
}

export interface StartArgs {
  fsmPath: string;
  runId?: string;
  root: string;
  json: boolean;
  lite?: boolean;
}

export function start(args: StartArgs): void {
  try {
    const fsm: Fsm = loadFsm(args.fsmPath);
    const runId = args.runId ?? generateRunId();

    const store = new Store(args.root);
    try {
      store.initRun(runId, args.fsmPath, args.lite);
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
      {
        run_status: "active",
        state: fsm.initial,
        visited_states: [fsm.initial],
      },
    );

    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);

    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    if (args.json) {
      printJson(
        jsonSuccess("Run started", {
          run_id: runId,
          state: card.state,
          prompt: card.prompt,
          todos: card.todos,
          transitions: card.transitions,
          run_status: "active",
          total_states: Object.keys(fsm.states).length,
          mermaid,
          ...(card.subagent ? { subagent: true } : {}),
        }),
      );
    } else {
      const header = fsm.guide ? `FSM started. ${fsm.guide}` : "FSM started.";
      const cardOutput = card.subagent
        ? formatSubagentDispatch(card, runId, fsm.guide)
        : formatStateCard(card);
      const reminders = [
        "",
        "IMPORTANT: Execute this state's instructions NOW. " +
          "Do NOT stop or wait for user input between states. " +
          "Only terminal states (no transitions) end the workflow.",
        "",
        "IMPORTANT: You MUST NOT truncate fflow command output. " +
          "Always read the complete output of fflow start, goto, and current commands.",
      ].join("\n");
      process.stdout.write(`${header}
run_id: ${runId}

${cardOutput}
${reminders}
`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
