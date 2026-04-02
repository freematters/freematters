import { dirname } from "node:path";
import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import {
  formatStateCard,
  handleError,
  jsonSuccess,
  printJson,
  stateCardFromFsm,
  substituteCard,
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

    const meta = store.readMeta(args.runId);

    if (meta.markdown) {
      const runDir = store.getRunDir(args.runId);
      if (args.json) {
        printJson(
          jsonSuccess("Current state (markdown mode)", {
            run_id: args.runId,
            mode: "markdown",
            workflow_dir: meta.workflow_dir ?? null,
            run_dir: runDir,
          }),
        );
      } else {
        process.stdout.write(
          `run_id: ${args.runId}\nmode: markdown\nworkflow_dir: ${meta.workflow_dir ?? ""}\nrun_dir: ${runDir}\n`,
        );
      }
      return;
    }

    const snapshot = store.readSnapshot(args.runId);
    if (!snapshot) {
      throw new CliError("RUN_NOT_FOUND", "run has no snapshot", {
        context: { runId: args.runId },
      });
    }
    const fsm = loadFsm(meta.fsm_path);

    const fsmState = fsm.states[snapshot.state];
    if (!fsmState) {
      throw new CliError("STATE_NOT_FOUND", "state not found in FSM", {
        context: { runId: args.runId, state: snapshot.state },
      });
    }

    const stateSourceDir = fsmState.source_path
      ? dirname(fsmState.source_path)
      : (meta.workflow_dir ?? "");
    const runDir = store.getRunDir(args.runId);
    const vars: Record<string, string> = {
      workflow_dir: stateSourceDir,
      run_dir: runDir,
    };
    const card = substituteCard(stateCardFromFsm(snapshot.state, fsmState), vars);

    const workflowDir = meta.workflow_dir ?? null;

    if (args.json) {
      printJson(
        jsonSuccess("Current state", {
          run_id: args.runId,
          ...(workflowDir ? { workflow_dir: workflowDir } : {}),
          state: card.state,
          prompt: card.prompt,
          todos: card.todos,
          transitions: card.transitions,
          run_status: snapshot.run_status,
        }),
      );
    } else {
      const dirLine = workflowDir ? `workflow_dir: ${workflowDir}\n` : "";
      process.stdout.write(`${dirLine}${formatStateCard(card)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
