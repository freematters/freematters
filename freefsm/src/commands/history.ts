import { CliError } from "../errors.js";
import { handleError, jsonSuccess, printJson } from "../output.js";
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatTimeline(summaries: TransitionSummary[]): string {
  const lines: string[] = [];
  lines.push("## Transition History\n");

  for (const s of summaries) {
    const duration =
      s.duration_ms !== null ? ` (${formatDuration(s.duration_ms)})` : "";
    const arrow = s.from && s.to ? `${s.from} → ${s.to}` : (s.to ?? s.from ?? "?");
    const label = s.label ? ` [${s.label}]` : "";

    lines.push(`  ${s.seq}. ${s.event}${label}: ${arrow}${duration}`);
    if (s.reason) {
      lines.push(`     reason: ${s.reason}`);
    }
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
