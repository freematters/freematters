import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import {
  formatStateCard,
  handleError,
  jsonSuccess,
  printJson,
  stateCardFromFsm,
} from "../output.js";
import { type RunStatus, Store } from "../store.js";

export interface GotoArgs {
  target: string;
  runId: string;
  on: string;
  root: string;
  json: boolean;
}

export function goto(args: GotoArgs): void {
  try {
    const store = new Store(args.root);

    if (!store.runExists(args.runId)) {
      throw new CliError("RUN_NOT_FOUND", "run not found", {
        context: { runId: args.runId },
      });
    }

    const meta = store.readMeta(args.runId);
    const fsm = loadFsm(meta.fsm_path);

    const result = store.withLock(args.runId, () => {
      const snapshot = store.readSnapshot(args.runId);
      if (!snapshot) {
        throw new CliError("RUN_NOT_FOUND", "run has no snapshot", {
          context: { runId: args.runId },
        });
      }
      if (snapshot.run_status !== "active") {
        throw new CliError(
          "RUN_NOT_ACTIVE",
          `run is ${snapshot.run_status}, not active`,
          { context: { runId: args.runId, state: snapshot.state } },
        );
      }

      if (!(args.target in fsm.states)) {
        throw new CliError(
          "STATE_NOT_FOUND",
          `target state "${args.target}" does not exist in FSM`,
          { context: { runId: args.runId, state: snapshot.state } },
        );
      }

      const currentState = fsm.states[snapshot.state];
      const expectedTarget = currentState.transitions[args.on];

      if (expectedTarget !== args.target) {
        const allowed = currentState.transitions;
        const labels = Object.entries(allowed)
          .map(([l, t]) => `  ${l} → ${t}`)
          .join("\n");
        throw new CliError(
          "INVALID_TRANSITION",
          `no transition "${args.on}" → "${args.target}"
Available transitions:
${labels}`,
          {
            data: { state: snapshot.state, allowed_transitions: allowed },
            context: { runId: args.runId, state: snapshot.state },
          },
        );
      }

      const isDone = args.target === "done";
      const newStatus: RunStatus = isDone ? "completed" : "active";

      store.commit(
        args.runId,
        {
          event: "goto",
          from_state: snapshot.state,
          to_state: args.target,
          on_label: args.on,
          actor: "agent",
          reason: isDone ? "done_auto" : null,
        },
        { run_status: newStatus, state: args.target },
        { lockHeld: true },
      );

      return { isDone, newStatus, fromState: snapshot.state };
    });

    const card = stateCardFromFsm(args.target, fsm.states[args.target]);

    if (args.json) {
      const data: Record<string, unknown> = {
        state: card.state,
        prompt: card.prompt,
        todos: card.todos,
        transitions: card.transitions,
        run_status: result.newStatus,
      };
      if (result.isDone) {
        data.completion_reason = "done_auto";
      }
      printJson(jsonSuccess("Transition complete", data));
    } else {
      process.stdout.write(`${formatStateCard(card)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
