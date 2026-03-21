import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

type Platform = "claude" | "codex";

const MARKETPLACE_NAME = "freeflow-local";
const PLUGIN_NAME = "freeflow";

function getPackageRoot(): string {
  // dist/commands/install.js is two levels deep under package root
  const thisDir = dirname(new URL(import.meta.url).pathname);
  return resolve(thisDir, "..", "..");
}

export function install(platform: Platform): void {
  const packageRoot = getPackageRoot();

  if (platform === "claude") {
    installClaude(packageRoot);
  } else {
    installCodex(packageRoot);
  }
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: "inherit" });
}

function installClaude(packageRoot: string): void {
  const pluginKey = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  // Register the local directory as a marketplace
  console.log(`Adding marketplace ${MARKETPLACE_NAME} -> ${packageRoot}`);
  run("claude", ["plugin", "marketplace", "add", packageRoot]);

  // Install the plugin from the marketplace
  console.log(`\nInstalling plugin ${pluginKey}`);
  run("claude", ["plugin", "install", pluginKey]);

  console.log("\nFreeFlow plugin installed for Claude Code.");
  console.log("\nSkills: /fflow:create, /fflow:start, /fflow:e2e-run");
  console.log("Hook: PostToolUse state reminder (every 5 tool calls)");
  console.log("\nRestart Claude Code to activate the plugin.");
}

function installCodex(packageRoot: string): void {
  const skillsSource = join(packageRoot, "skills");
  const agentsDir = join(homedir(), ".agents", "skills");
  const target = join(agentsDir, PLUGIN_NAME);

  if (!existsSync(skillsSource)) {
    console.error(`Skills directory not found: ${skillsSource}`);
    process.exit(2);
  }

  mkdirSync(agentsDir, { recursive: true });

  // Replace existing target, backing up if it's not a symlink
  if (existsSync(target)) {
    try {
      readlinkSync(target);
      // It's a symlink — safe to remove and update
      unlinkSync(target);
      console.log(`Updating existing symlink: ${target}`);
    } catch {
      // Not a symlink — back it up
      const backup = `${target}.bak`;
      renameSync(target, backup);
      console.log(`Backed up ${target} -> ${backup}`);
    }
  }

  symlinkSync(skillsSource, target);
  console.log(`FreeFlow skills linked for Codex: ${target} -> ${skillsSource}`);
  console.log(
    `\nNote: Codex does not support hooks. The agent won't get periodic state reminders.`,
  );
}
