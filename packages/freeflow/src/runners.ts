import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type Scope = "local" | "global";

export interface SkillsAddOptions {
  scope: Scope;
  agent?: string;
  /**
   * When true, let the `skills` CLI drive its own interactive prompts
   * (skill picker, agent picker) by omitting `--skill '*'` and `-y`.
   * When false (default), install every skill non-interactively.
   */
  interactive?: boolean;
  /**
   * When true, pre-select every skill and every agent (`--skill '*'
   * --agent '*'`) so the skills CLI still shows its confirmation prompt
   * but doesn't ask the user to pick individual skills or agents.
   * Combine with `yes: true` for a fully non-interactive `--all`-like
   * install. Overrides `agent` and `interactive`.
   */
  all?: boolean;
  /** Append `-y` to skip the skills CLI's confirmation prompt. */
  yes?: boolean;
  /**
   * When true, suppress the skills CLI's stdout/stderr on success. The
   * captured output is only flushed if the process exits non-zero so real
   * errors remain visible. Incompatible with interactive mode.
   */
  quiet?: boolean;
}

export interface SkillsRemoveOptions {
  scope: Scope;
  agent: string;
  /** Specific skill names to remove — never '*' to avoid nuking user skills. */
  skills: readonly string[];
  quiet?: boolean;
}

export const MARKETPLACE_NAME = "freeflow-local";
export const PLUGIN_NAME = "freeflow";
export const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * Resolve the freeflow package root.
 *
 * This file compiles to `dist/runners.js`, which sits one level under the
 * package root.
 */
export function getPackageRoot(): string {
  const thisDir = dirname(new URL(import.meta.url).pathname);
  return resolve(thisDir, "..");
}

/**
 * Run a command, optionally silencing it on success while still surfacing
 * captured output on failure.
 */
function runMaybeQuiet(cmd: string, argv: string[], quiet: boolean): void {
  if (!quiet) {
    execFileSync(cmd, argv, { stdio: "inherit" });
    return;
  }
  try {
    execFileSync(cmd, argv, { stdio: "pipe" });
  } catch (err) {
    const e = err as Error & { stderr?: Buffer; stdout?: Buffer };
    if (e.stdout?.length) process.stderr.write(e.stdout);
    if (e.stderr?.length) process.stderr.write(e.stderr);
    throw err;
  }
}

export function skillsAdd(dir: string, opts: SkillsAddOptions): void {
  const argv: string[] = ["--yes", "skills", "add", dir];
  if (opts.all) {
    argv.push("--skill", "*", "--agent", "*");
    if (opts.yes) {
      argv.push("-y");
    }
  } else {
    if (!opts.interactive) {
      argv.push("--skill", "*", "-y");
    }
    if (opts.agent) {
      argv.push("--agent", opts.agent);
    }
  }
  if (opts.scope === "global") {
    argv.push("-g");
  }
  runMaybeQuiet("npx", argv, opts.quiet ?? false);
}

export function skillsRemove(opts: SkillsRemoveOptions): void {
  if (opts.skills.length === 0) {
    throw new Error("skillsRemove requires at least one skill name");
  }
  const argv: string[] = [
    "--yes",
    "skills",
    "remove",
    ...opts.skills,
    "--agent",
    opts.agent,
    "-y",
  ];
  if (opts.scope === "global") {
    argv.push("-g");
  }
  runMaybeQuiet("npx", argv, opts.quiet ?? false);
}

export function claudeInstallPlugin(packageRoot: string): void {
  execFileSync("claude", ["plugin", "marketplace", "add", packageRoot], {
    stdio: "inherit",
  });
  execFileSync("claude", ["plugin", "install", PLUGIN_KEY], {
    stdio: "inherit",
  });
}

export function claudeUninstallPlugin(): void {
  execFileSync("claude", ["plugin", "uninstall", PLUGIN_KEY], {
    stdio: "inherit",
  });
}

export function claudeRemoveMarketplace(): void {
  execFileSync("claude", ["plugin", "marketplace", "remove", MARKETPLACE_NAME], {
    stdio: "inherit",
  });
}

/** Names of skills bundled in `<packageRoot>/skills/` (one dir per skill). */
export function listBundledSkills(packageRoot: string): string[] {
  const dir = join(packageRoot, "skills");
  return readdirSync(dir).filter((name) => {
    try {
      return statSync(join(dir, name)).isDirectory();
    } catch {
      return false;
    }
  });
}
