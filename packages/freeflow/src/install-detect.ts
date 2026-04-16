import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_KEY, type Scope, getPackageRoot } from "./runners.js";

export type { Scope };

interface SkillsLsEntry {
  name?: string;
  source?: string;
}

/** True if the `claude` binary is on PATH. */
export function claudeAvailable(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * True if any freeflow skills/workflows are installed for the given scope.
 *
 * Primary probe: `npx skills ls --json [-g]`. An entry counts as "ours" when
 * its `source` path (after `realpathSync`) resolves under the freeflow package
 * root (also realpath'd).
 *
 * Fallback probe (on JSON-parse error or command failure): filesystem check
 * under the scope's conventional skills directory.
 */
export function detectInstalled(scope: Scope): boolean {
  const packageRoot = safeRealpath(getPackageRoot());

  try {
    const argv: string[] = ["skills", "ls", "--json"];
    if (scope === "global") argv.push("-g");

    const out = execFileSync("npx", argv, { stdio: "pipe" }).toString();
    const entries = JSON.parse(out) as SkillsLsEntry[];

    if (!Array.isArray(entries)) return fallbackProbe(scope);

    for (const entry of entries) {
      if (!entry || typeof entry.source !== "string") continue;
      const resolved = safeRealpath(entry.source);
      if (resolved === packageRoot || resolved.startsWith(`${packageRoot}/`)) {
        return true;
      }
    }
    return false;
  } catch {
    return fallbackProbe(scope);
  }
}

function fallbackProbe(scope: Scope): boolean {
  const root =
    scope === "local"
      ? join(process.cwd(), ".claude/skills/freeflow")
      : join(homedir(), ".claude/skills/freeflow");
  return existsSync(root);
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Returns the populated set among `["local", "global"]`. */
export function detectAllInstalledScopes(): Scope[] {
  const scopes: Scope[] = [];
  if (detectInstalled("local")) scopes.push("local");
  if (detectInstalled("global")) scopes.push("global");
  return scopes;
}

/** True iff `claude plugin list` output contains `freeflow@freeflow-local`. */
export function detectClaudePlugin(): boolean {
  try {
    const out = execFileSync("claude", ["plugin", "list"], {
      stdio: "pipe",
    }).toString();
    return out.includes(PLUGIN_KEY);
  } catch {
    return false;
  }
}
