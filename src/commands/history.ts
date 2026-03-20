import { CliError } from "../errors.js";
import { formatDuration, handleError, jsonSuccess, printJson } from "../output.js";
import { Store, type StoreEvent } from "../store.js";

export interface HistoryArgs {
  runId: string;
  root: string;
  json: boolean;
  limit?: number;
  since?: string;
}

interface TransitionSummary {
  seq: number;
  timestamp: string;
  event: string;
  from: string | null;
  to: string | null;
  label: string | null;
  actor: string;
  reason: string | null;
  duration_ms: number | null;
}

function computeDurations(events: StoreEvent[]): TransitionSummary[] {
  const summaries: TransitionSummary[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let durationMs: number | null = null;

    if (i > 0) {
      const prevTs = new Date(events[i - 1].ts).getTime();
      const curTs = new Date(e.ts).getTime();
      durationMs = curTs - prevTs;
    }

    summaries.push({
      seq: e.seq,
      timestamp: e.ts,
      event: e.event,
      from: e.from_state,
      to: e.to_state,
      label: e.on_label,
      actor: e.actor,
      reason: e.reason,
      duration_ms: durationMs,
    });
  }

  return summaries;
}

function formatTimeline(summaries: TransitionSummary[]): string {
  const lines: string[] = [];
  lines.push("## Transition History\n");

  // Pre-compute columns for alignment
  const rows: Array<{
    prefix: string;
    transition: string;
    target: string;
    duration: string;
  }> = [];
  for (const s of summaries) {
    const prefix = `  ${s.seq}. ${s.event}`;
    if (s.event === "start") {
      rows.push({ prefix, transition: "", target: s.to ?? "?", duration: "" });
    } else if (s.event === "goto") {
      const label = s.label ?? "?";
      const duration =
        s.duration_ms !== null ? `(${formatDuration(s.duration_ms)})` : "";
      rows.push({
        prefix,
        transition: `-- (${label}) -->`,
        target: s.to ?? "?",
        duration,
      });
    } else if (s.event === "finish") {
      const duration =
        s.duration_ms !== null ? `(${formatDuration(s.duration_ms)})` : "";
      rows.push({ prefix, transition: "-- (aborted)", target: "", duration });
    }
  }

  // Find max widths for alignment
  const maxPrefix = Math.max(...rows.map((r) => r.prefix.length));
  const maxTransition = Math.max(...rows.map((r) => r.transition.length));
  const maxTarget = Math.max(...rows.map((r) => r.target.length));

  for (const r of rows) {
    const parts = [r.prefix.padEnd(maxPrefix)];
    if (r.transition) {
      parts.push(
        ` ${r.transition.padEnd(maxTransition)} ${r.target.padEnd(maxTarget)}`,
      );
    } else {
      parts.push(`: ${r.target}`);
    }
    if (r.duration) {
      parts.push(` ${r.duration}`);
    }
    lines.push(parts.join("").trimEnd());
  }

  if (summaries.length > 0) {
    const totalMs =
      new Date(summaries[summaries.length - 1].timestamp).getTime() -
      new Date(summaries[0].timestamp).getTime();
    lines.push("");
    lines.push(`Total elapsed: ${formatDuration(totalMs)}`);
  }

  return lines.join("\n");
}

export function history(args: HistoryArgs): void {
  try {
    const store = new Store(args.root);

    if (!store.runExists(args.runId)) {
      throw new CliError("RUN_NOT_FOUND", "run not found", {
        context: { runId: args.runId },
      });
    }

    let events = store.readEvents(args.runId);

    if (args.since) {
      const sinceTs = new Date(args.since).getTime();
      events = events.filter((e) => new Date(e.ts).getTime() >= sinceTs);
    }

    if (args.limit && args.limit > 0) {
      events = events.slice(-args.limit);
    }

    const summaries = computeDurations(events);
    const snapshot = store.readSnapshot(args.runId);

    if (args.json) {
      printJson(
        jsonSuccess("Transition history", {
          run_id: args.runId,
          run_status: snapshot?.run_status ?? "unknown",
          current_state: snapshot?.state ?? "unknown",
          total_events: summaries.length,
          transitions: summaries,
        }),
      );
    } else {
      process.stdout.write(`${formatTimeline(summaries)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
