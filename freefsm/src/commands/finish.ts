import { CliError } from "../errors.js";
import { formatDuration, handleError, jsonSuccess, printJson } from "../output.js";
import { Store, type StoreEvent } from "../store.js";

interface RunStats {
  totalTransitions: number;
  totalDuration: string;
  statesVisited: string[];
  chain: string;
}

function computeRunStats(events: StoreEvent[]): RunStats {
  const parts: string[] = [];
  const statesVisited: string[] = [];

  for (const e of events) {
    if (e.event === "start") {
      const state = e.to_state ?? "unknown";
      parts.push(state);
      if (!statesVisited.includes(state)) statesVisited.push(state);
    } else if (e.event === "goto") {
      parts.push(`-[${e.on_label}]-> ${e.to_state}`);
      if (e.to_state && !statesVisited.includes(e.to_state)) {
        statesVisited.push(e.to_state);
      }
    } else if (e.event === "finish") {
      parts.push("-[aborted]");
    }
  }

  let totalDuration = "0ms";
  if (events.length >= 2) {
    const startTs = new Date(events[0].ts).getTime();
    const endTs = new Date(events[events.length - 1].ts).getTime();
    totalDuration = formatDuration(endTs - startTs);
  }

  return {
    totalTransitions: events.filter((e) => e.event === "goto").length,
    totalDuration,
    statesVisited,
    chain: `  ${parts.join(" ")}`,
  };
}

export interface FinishArgs {
  runId: string;
  root: string;
  json: boolean;
}

export function finish(args: FinishArgs): void {
  try {
    const store = new Store(args.root);

    if (!store.runExists(args.runId)) {
      throw new CliError("RUN_NOT_FOUND", "run not found", {
        context: { runId: args.runId },
      });
    }

    const abortedState = store.withLock(args.runId, () => {
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

      store.commit(
        args.runId,
        {
          event: "finish",
          from_state: snapshot.state,
          to_state: null,
          on_label: null,
          actor: "human",
          reason: "manual_abort",
        },
        { run_status: "aborted", state: snapshot.state },
        { lockHeld: true },
      );

      return snapshot.state;
    });

    const events = store.readEvents(args.runId);
    const stats = computeRunStats(events);

    if (args.json) {
      printJson(
        jsonSuccess("Run aborted", {
          run_id: args.runId,
          run_status: "aborted",
          state: abortedState,
          completion_reason: "manual_abort",
          total_transitions: stats.totalTransitions,
          total_duration: stats.totalDuration,
          states_visited: stats.statesVisited,
        }),
      );
    } else {
      process.stdout.write(
        `Run aborted at **${abortedState}** state.

Transition history:
${stats.chain}

Summary:
  Transitions: ${stats.totalTransitions}
  Duration: ${stats.totalDuration}
  States visited: ${stats.statesVisited.join(", ")}
`,
      );
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
