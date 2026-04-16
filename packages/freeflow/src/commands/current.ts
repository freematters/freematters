import { dirname } from "node:path";
import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import {
  buildStateCardForEmit,
  formatStateCard,
  handleError,
  jsonSuccess,
  printJson,
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

    const fsm = loadFsm(meta.fsm_path);

    // Build the state card under the per-run lock so the decision to render
    // the guide and the shown_guides persist are atomic against concurrent
    // `goto` commits. Otherwise a concurrent goto could commit
    // shown_guides=[X] between an unlocked read and the lock, and this call
    // would still emit a duplicate guide card to the user.
    let snapshot!: NonNullable<ReturnType<typeof store.readSnapshot>>;
    let rawCard!: ReturnType<typeof buildStateCardForEmit>["card"];
    store.withLock(args.runId, () => {
      const latest = store.readSnapshot(args.runId);
      if (!latest) {
        throw new CliError("RUN_NOT_FOUND", "run has no snapshot", {
          context: { runId: args.runId },
        });
      }
      const fsmState = fsm.states[latest.state];
      if (!fsmState) {
        throw new CliError("STATE_NOT_FOUND", "state not found in FSM", {
          context: { runId: args.runId, state: latest.state },
        });
      }
      const built = buildStateCardForEmit(fsm, latest.state, latest);
      rawCard = built.card;
      snapshot = latest;
      if (built.updatedShownGuides !== undefined) {
        const currentShown = latest.shown_guides ?? [];
        if (!currentShown.includes(latest.state)) {
          store.writeSnapshot({
            ...latest,
            shown_guides: [...currentShown, latest.state],
          });
        }
      }
    });

    const fsmState = fsm.states[snapshot.state];
    const stateSourceDir = fsmState?.source_path
      ? dirname(fsmState.source_path)
      : (meta.workflow_dir ?? "");
    const runDir = store.getRunDir(args.runId);
    const vars: Record<string, string> = {
      workflow_dir: stateSourceDir,
      run_dir: runDir,
    };
    const card = substituteCard(rawCard, vars);

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
