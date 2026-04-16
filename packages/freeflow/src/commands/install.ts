import { execFileSync } from "node:child_process";
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

function runNpxSkills(packageRoot: string, opts?: { onFailure?: () => void }): void {
  const dirs = [join(packageRoot, "skills"), join(packageRoot, "workflows")];
  try {
    for (const dir of dirs) {
      console.log(`\nInstalling via npx skills install ${dir}`);
      execFileSync("npx", ["skills", "install", dir], { stdio: "inherit" });
    }
  } catch (err) {
    opts?.onFailure?.();
    throw err;
  }
}

function rollbackClaudeHook(): void {
  try {
    console.warn("\nRolling back Claude plugin install...");
    execFileSync(
      "claude",
      ["plugin", "uninstall", `${PLUGIN_NAME}@${MARKETPLACE_NAME}`],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.warn(
      `Warning: failed to roll back Claude plugin install: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function installClaude(packageRoot: string): void {
  const pluginKey = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;

  // Register the local directory as a marketplace
  console.log(`Adding marketplace ${MARKETPLACE_NAME} -> ${packageRoot}`);
  run("claude", ["plugin", "marketplace", "add", packageRoot]);

  // Install the plugin from the marketplace
  console.log(`\nInstalling plugin ${pluginKey}`);
  run("claude", ["plugin", "install", pluginKey]);

  // Register skills and workflows via npx skills install
  runNpxSkills(packageRoot, { onFailure: rollbackClaudeHook });

  console.log("\nFreeFlow plugin installed for Claude Code.");
  console.log("\nSkills: /fflow-author, /fflow, /e2e-run");
  console.log("Hook: PostToolUse state reminder (every 5 tool calls)");
  console.log("\nRestart Claude Code to activate the plugin.");
}

function installCodex(packageRoot: string): void {
  runNpxSkills(packageRoot);

  console.log("\nFreeFlow skills installed for Codex.");
  console.log(
    `\nNote: Codex does not support hooks. The agent won't get periodic state reminders.`,
  );
}
