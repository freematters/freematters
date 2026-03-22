import { CliError } from "../errors.js";
import { loadFsm } from "../fsm.js";
import {
  formatDuration,
  formatLiteCard,
  formatStateCard,
  formatSubagentDispatch,
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
    const isLite = meta.lite === true;

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

      // Track visited states only in lite mode
      let alreadyVisited = false;
      let visitedStates: string[] | undefined;
      if (isLite) {
        const visitedSet = new Set(snapshot.visited_states ?? []);
        alreadyVisited = visitedSet.has(args.target);
        visitedSet.add(args.target);
        visitedStates = [...visitedSet];
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
        {
          run_status: newStatus,
          state: args.target,
          ...(visitedStates !== undefined && { visited_states: visitedStates }),
        },
        { lockHeld: true },
      );

      return { isDone, newStatus, fromState: snapshot.state, alreadyVisited };
    });

    const card = stateCardFromFsm(args.target, fsm.states[args.target]);

    // Compute time spent in previous state
    const events = store.readEvents(args.runId);
    let timeInPrevState: string | null = null;
    if (events.length >= 2) {
      const prevEvent = events[events.length - 2];
      const curEvent = events[events.length - 1];
      const elapsed =
        new Date(curEvent.ts).getTime() - new Date(prevEvent.ts).getTime();
      timeInPrevState = formatDuration(elapsed);
    }

    if (args.json) {
      const data: Record<string, unknown> = {
        state: card.state,
        from_state: result.fromState,
        prompt: card.prompt,
        todos: card.todos,
        transitions: card.transitions,
        run_status: result.newStatus,
        transition_label: args.on,
        time_in_previous_state: timeInPrevState,
        ...(card.subagent ? { subagent: true } : {}),
      };
      if (result.isDone) {
        data.completion_reason = "done_auto";
      }
      printJson(jsonSuccess("Transition complete", data));
    } else if (card.subagent) {
      const cardOutput = formatSubagentDispatch(card, args.runId);
      process.stdout.write(`${cardOutput}\n`);
    } else if (isLite && result.alreadyVisited) {
      process.stdout.write(`${formatLiteCard(card)}\n`);
    } else {
      process.stdout.write(`${formatStateCard(card)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
