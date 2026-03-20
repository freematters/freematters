import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";

export interface MigrateOptions {
  dryRun: boolean;
  json: boolean;
  homeDir?: string; // override for testing
  cwd?: string; // override for testing
}

type ActionStatus = "done" | "skipped" | "warning";

interface ActionResult {
  action: string;
  status: ActionStatus;
  message: string;
  dryRun: boolean;
}

function renameDir(
  src: string,
  dest: string,
  label: string,
  dryRun: boolean,
): ActionResult {
  if (!existsSync(src) && existsSync(dest)) {
    return {
      action: label,
      status: "skipped",
      message: `${dest} already exists (already migrated)`,
      dryRun,
    };
  }
  if (existsSync(src) && existsSync(dest)) {
    return {
      action: label,
      status: "warning",
      message: `Both ${src} and ${dest} exist — skipping, please resolve manually`,
      dryRun,
    };
  }
  if (!existsSync(src)) {
    return {
      action: label,
      status: "skipped",
      message: `${src} does not exist`,
      dryRun,
    };
  }
  // src exists, dest does not
  if (!dryRun) {
    renameSync(src, dest);
  }
  return {
    action: label,
    status: "done",
    message: `Renamed ${src} → ${dest}`,
    dryRun,
  };
}

function renameWorkflowFiles(dir: string, dryRun: boolean): ActionResult[] {
  const results: ActionResult[] = [];
  const workflowsDir = join(dir, "workflows");
  if (!existsSync(workflowsDir)) {
    return results;
  }

  const files = readdirSync(workflowsDir);
  for (const file of files) {
    if (!file.endsWith(".fsm.yaml")) continue;
    const newName = file.replace(/\.fsm\.yaml$/, ".workflow.yaml");
    const src = join(workflowsDir, file);
    const dest = join(workflowsDir, newName);
    if (existsSync(dest)) {
      results.push({
        action: `rename ${file}`,
        status: "skipped",
        message: `${dest} already exists`,
        dryRun,
      });
    } else {
      if (!dryRun) {
        renameSync(src, dest);
      }
      results.push({
        action: `rename ${file}`,
        status: "done",
        message: `Renamed ${file} → ${newName}`,
        dryRun,
      });
    }
  }
  return results;
}

function detectShellEnv(homeDir: string, dryRun: boolean): ActionResult[] {
  const results: ActionResult[] = [];
  const rcFiles = [".bashrc", ".zshrc"];

  for (const rcFile of rcFiles) {
    const rcPath = join(homeDir, rcFile);
    if (!existsSync(rcPath)) continue;

    const content = readFileSync(rcPath, "utf-8");
    if (content.includes("FREEFSM_ROOT")) {
      results.push({
        action: `detect FREEFSM_ROOT in ${rcFile}`,
        status: "warning",
        message: `Found FREEFSM_ROOT in ~/${rcFile} — please update manually to FREEFLOW_ROOT`,
        dryRun,
      });
    }
  }
  return results;
}

export function migrate(options: MigrateOptions): ActionResult[] {
  const { dryRun, homeDir: homeDirOverride, cwd: cwdOverride } = options;
  const home = homeDirOverride ?? homedir();
  const cwd = cwdOverride ?? process.cwd();

  const results: ActionResult[] = [];

  // 1. Rename ~/.freefsm/ → ~/.freeflow/
  results.push(
    renameDir(
      join(home, ".freefsm"),
      join(home, ".freeflow"),
      "rename ~/.freefsm → ~/.freeflow",
      dryRun,
    ),
  );

  // 2. Rename .freefsm/ → .freeflow/ in CWD
  results.push(
    renameDir(
      join(cwd, ".freefsm"),
      join(cwd, ".freeflow"),
      "rename .freefsm → .freeflow",
      dryRun,
    ),
  );

  // 3. Rename *.fsm.yaml → *.workflow.yaml
  const cwdWorkflowDir = join(cwd, ".freeflow");
  const homeWorkflowDir = join(home, ".freeflow");

  results.push(...renameWorkflowFiles(cwdWorkflowDir, dryRun));
  results.push(...renameWorkflowFiles(homeWorkflowDir, dryRun));

  // 4. Detect FREEFSM_ROOT in shell configs
  results.push(...detectShellEnv(home, dryRun));

  return results;
}

function formatHuman(results: ActionResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    const prefix = r.dryRun ? "[dry-run] " : "";
    if (r.status === "done") {
      lines.push(`${prefix}[ok] ${r.message}`);
    } else if (r.status === "skipped") {
      lines.push(`${prefix}[skip] ${r.message}`);
    } else {
      lines.push(`${prefix}[warn] ${r.message}`);
    }
  }
  if (lines.length === 0) {
    lines.push("Nothing to migrate.");
  }
  return lines.join("\n");
}

export function registerMigrate(program: Command): void {
  program
    .command("migrate")
    .description(
      "migrate from freefsm to freeflow (rename dirs, files, detect env vars)",
    )
    .option("--dry-run", "show what would happen without doing it")
    .action((opts: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as {
        json?: boolean;
      };
      const dryRun = (opts.dryRun as boolean) ?? false;
      const json = globalOpts.json ?? false;

      const results = migrate({ dryRun, json });

      if (json) {
        console.log(JSON.stringify({ ok: true, results }, null, 2));
      } else {
        console.log(formatHuman(results));
      }
    });
}
