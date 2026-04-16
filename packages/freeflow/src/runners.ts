import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";

export type Scope = "local" | "global";

export interface SkillsAddOptions {
  scope: Scope;
  agent?: string;
}

export interface SkillsRemoveOptions {
  scope: Scope;
}

export const MARKETPLACE_NAME = "freeflow-local";
export const PLUGIN_NAME = "freeflow";
export const PLUGIN_KEY = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

/**
 * Resolve the freeflow package root.
 *
 * This file compiles to `dist/runners.js`, which sits one level under the
 * package root. The same applies to `dist/install-detect.js`, so this helper
 * is shared by both modules.
 */
export function getPackageRoot(): string {
  const thisDir = dirname(new URL(import.meta.url).pathname);
  return resolve(thisDir, "..");
}

export function skillsAdd(dir: string, opts: SkillsAddOptions): void {
  const argv: string[] = ["--yes", "skills", "add", dir, "--skill", "*"];
  if (opts.agent) {
    argv.push("--agent", opts.agent);
  }
  if (opts.scope === "global") {
    argv.push("-g");
  }
  execFileSync("npx", argv, { stdio: "inherit" });
}

export function skillsRemove(dir: string, opts: SkillsRemoveOptions): void {
  const argv: string[] = [
    "--yes",
    "skills",
    "remove",
    dir,
    "--skill",
    "*",
    "--agent",
    "*",
    "-y",
  ];
  if (opts.scope === "global") {
    argv.push("-g");
  }
  execFileSync("npx", argv, { stdio: "inherit" });
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
