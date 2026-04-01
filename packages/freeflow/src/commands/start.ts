import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
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
    const workflowDir = dirname(resolve(args.fsmPath));

    const store = new Store(args.root);
    const runDir = store.getRunDir(runId);
    try {
      store.initRun(runId, args.fsmPath, args.lite);
      store.updateMeta(runId, { workflow_dir: workflowDir });
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
        ...(args.lite && { visited_states: [fsm.initial] }),
      },
    );

    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);

    const mermaid = fsmToMermaid(fsm.states, fsm.initial);

    if (args.json) {
      printJson(
        jsonSuccess("Run started", {
          run_id: runId,
          workflow_dir: workflowDir,
          run_dir: runDir,
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
      process.stdout.write(`${header}
run_id: ${runId}
workflow_dir: ${workflowDir}
run_dir: ${runDir}

${cardOutput}
`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
