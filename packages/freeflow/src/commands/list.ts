import { handleError, jsonSuccess, printJson } from "../output.js";
import { Store } from "../store.js";

export interface ListArgs {
  root: string;
  json: boolean;
  status?: string;
}

function formatRunList(
  runs: Array<{ runId: string; status: string; state: string; createdAt: string }>,
): string {
  if (runs.length === 0) {
    return "No runs found.";
  }

  const lines: string[] = [];
  lines.push("## Runs\n");

  const idWidth = Math.max(6, ...runs.map((r) => r.runId.length));
  const statusWidth = Math.max(6, ...runs.map((r) => r.status.length));
  const stateWidth = Math.max(5, ...runs.map((r) => r.state.length));

  lines.push(
    `${"RUN_ID".padEnd(idWidth)}  ${"STATUS".padEnd(statusWidth)}  ${"STATE".padEnd(stateWidth)}  CREATED`,
  );
  lines.push(
    `${"─".repeat(idWidth)}  ${"─".repeat(statusWidth)}  ${"─".repeat(stateWidth)}  ${"─".repeat(20)}`,
  );

  for (const r of runs) {
    const created = r.createdAt.replace("T", " ").slice(0, 19);
    lines.push(
      `${r.runId.padEnd(idWidth)}  ${r.status.padEnd(statusWidth)}  ${r.state.padEnd(stateWidth)}  ${created}`,
    );
  }

  lines.push("");
  lines.push(`Total: ${runs.length} run(s)`);

  return lines.join("\n");
}

export function list(args: ListArgs): void {
  try {
    const store = new Store(args.root);
    let runs = store.listRunsWithStatus();

    if (args.status) {
      runs = runs.filter((r) => r.status === args.status);
    }

    if (args.json) {
      printJson(
        jsonSuccess("Runs listed", {
          total: runs.length,
          runs: runs.map((r) => ({
            run_id: r.runId,
            status: r.status,
            state: r.state,
            created_at: r.createdAt,
          })),
        }),
      );
    } else {
      process.stdout.write(`${formatRunList(runs)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
