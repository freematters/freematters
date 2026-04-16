import { join } from "node:path";
import prompts from "prompts";
import { CliError } from "../errors.js";
import {
  claudeAvailable,
  detectAllInstalledScopes,
  detectClaudePlugin,
} from "../install-detect.js";
import {
  type Scope,
  claudeRemoveMarketplace,
  claudeUninstallPlugin,
  getPackageRoot,
  skillsRemove,
} from "../runners.js";

export interface DeinitOptions {
  scope?: Scope | "all";
  yes?: boolean;
  /** Internal — used by reinstall/rollback paths. Not exposed on CLI. */
  skipConfirm?: boolean;
}

interface CleanupTask {
  label: string;
  fn: () => void;
}

interface TaskFailure {
  label: string;
  error: unknown;
}

export async function runDeinit(opts: DeinitOptions): Promise<void> {
  const isTTY = process.stdin.isTTY === true;

  // ── 1. Resolve target scopes ─────────────────────────────────────────
  let targets: Scope[];
  if (opts.scope === "all") {
    targets = ["local", "global"];
  } else if (opts.scope === "local" || opts.scope === "global") {
    targets = [opts.scope];
  } else {
    // No scope flag — probe what's installed and ask if ambiguous.
    const detected = detectAllInstalledScopes();
    if (detected.length === 0) {
      console.log("Nothing to remove — FreeFlow is not installed.");
      return;
    }
    if (detected.length === 1) {
      targets = [detected[0]];
    } else if (!isTTY && !opts.yes) {
      throw new CliError(
        "ARGS_INVALID",
        "Non-TTY deinit requires --local, --global, --all, or -y",
      );
    } else if (opts.yes) {
      targets = ["local", "global"];
    } else {
      const response = (await prompts({
        type: "multiselect",
        name: "targets",
        message: "Which scopes to remove?",
        choices: [
          { title: "local", value: "local" },
          { title: "global", value: "global" },
        ],
      })) as { targets?: Scope[] };
      const chosen = response.targets ?? [];
      if (chosen.length === 0) {
        console.log("Cancelled — no scope selected.");
        return;
      }
      targets = chosen;
    }
  }

  // ── 2. Destructive confirmation ──────────────────────────────────────
  if (!opts.yes && !opts.skipConfirm) {
    const response = (await prompts({
      type: "confirm",
      name: "confirm",
      message: `This will remove FreeFlow from ${targets.join(", ")}. Continue?`,
      initial: false,
    })) as { confirm?: boolean };
    if (!response.confirm) {
      console.log("Cancelled");
      return;
    }
  }

  // ── 3. Build cleanup task list ───────────────────────────────────────
  const packageRoot = getPackageRoot();
  const skillsDir = join(packageRoot, "skills");
  const workflowsDir = join(packageRoot, "workflows");

  const tasks: CleanupTask[] = [];
  for (const scope of targets) {
    tasks.push({
      label: `skills (${scope})`,
      fn: () => skillsRemove(skillsDir, { scope }),
    });
    tasks.push({
      label: `workflows (${scope})`,
      fn: () => skillsRemove(workflowsDir, { scope }),
    });
  }

  if (claudeAvailable() && detectClaudePlugin()) {
    tasks.push({
      label: "claude plugin",
      fn: () => claudeUninstallPlugin(),
    });
    tasks.push({
      label: "claude marketplace",
      fn: () => claudeRemoveMarketplace(),
    });
  }

  // ── 4. Run tasks, collect failures ───────────────────────────────────
  const failures: TaskFailure[] = [];
  for (const task of tasks) {
    try {
      task.fn();
    } catch (error) {
      failures.push({ label: task.label, error });
    }
  }

  // ── 5. Report / aggregate ────────────────────────────────────────────
  if (failures.length > 0) {
    const details = failures
      .map((f) => {
        const msg = f.error instanceof Error ? f.error.message : String(f.error);
        return `  - ${f.label}: ${msg}`;
      })
      .join("\n");
    throw new CliError(
      "DEINIT_FAILED",
      `FreeFlow deinit finished with ${failures.length} failure(s):\n${details}`,
    );
  }

  console.log(`FreeFlow removed from ${targets.join(", ")}.`);
}
