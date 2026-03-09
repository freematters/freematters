import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import {
  formatStateCard,
  handleError,
  jsonSuccess,
  printJson,
  stateCardFromFsm,
} from "../output.js";
import { Store } from "../store.js";

export interface CurrentArgs {
  runId: string;
  root: string;
  json: boolean;
}

export function current(args: CurrentArgs): void {
  try {
    const store = new Store(args.root);

    if (!store.runExists(args.runId)) {
      throw new CliError("RUN_NOT_FOUND", "run not found", {
        context: { runId: args.runId },
      });
    }

    const snapshot = store.readSnapshot(args.runId);
    if (!snapshot) {
      throw new CliError("RUN_NOT_FOUND", "run has no snapshot", {
        context: { runId: args.runId },
      });
    }

    const meta = store.readMeta(args.runId);
    const fsm = loadFsm(meta.fsm_path);

    const fsmState = fsm.states[snapshot.state];
    if (!fsmState) {
      throw new CliError("STATE_NOT_FOUND", "state not found in FSM", {
        context: { runId: args.runId, state: snapshot.state },
      });
    }

    const card = stateCardFromFsm(snapshot.state, fsmState);

    if (args.json) {
      printJson(
        jsonSuccess("Current state", {
          run_id: args.runId,
          state: card.state,
          prompt: card.prompt,
          todos: card.todos,
          transitions: card.transitions,
          run_status: snapshot.run_status,
        }),
      );
    } else {
      process.stdout.write(`${formatStateCard(card)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
