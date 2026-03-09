import { CliError } from "../errors.js";
import { handleError, jsonSuccess, printJson } from "../output.js";
import { Store, type StoreEvent } from "../store.js";

function formatTransitionChain(events: StoreEvent[]): string {
  const parts: string[] = [];
  for (const e of events) {
    if (e.event === "start") {
      parts.push(e.to_state!);
    } else if (e.event === "goto") {
      parts.push(`-[${e.on_label}]-> ${e.to_state}`);
    } else if (e.event === "finish") {
      parts.push("-[aborted]");
    }
  }
  return `  ${parts.join(" ")}`;
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
    const chain = formatTransitionChain(events);

    if (args.json) {
      printJson(
        jsonSuccess("Run aborted", {
          run_id: args.runId,
          run_status: "aborted",
          state: abortedState,
          completion_reason: "manual_abort",
        }),
      );
    } else {
      process.stdout.write(
        `Run aborted at **${abortedState}** state.

Transition history:
${chain}
`,
      );
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
