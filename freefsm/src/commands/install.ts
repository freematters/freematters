import { existsSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

type Platform = "claude" | "codex";

const MARKETPLACE_NAME = "freefsm-local";
const PLUGIN_NAME = "freefsm";

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

function installClaude(packageRoot: string): void {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  const settingsDir = join(homedir(), ".claude");

  // Read existing settings or start fresh
  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } else {
    mkdirSync(settingsDir, { recursive: true });
  }

  // Add marketplace pointing to the installed package directory
  const marketplaces = (settings.extraKnownMarketplaces ?? {}) as Record<string, unknown>;
  marketplaces[MARKETPLACE_NAME] = {
    source: {
      source: "directory",
      path: packageRoot,
    },
  };
  settings.extraKnownMarketplaces = marketplaces;

  // Enable the plugin
  const enabled = (settings.enabledPlugins ?? {}) as Record<string, boolean>;
  const pluginKey = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
  enabled[pluginKey] = true;
  settings.enabledPlugins = enabled;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

  console.log(`FreeFSM plugin installed for Claude Code.`);
  console.log(`  Marketplace: ${MARKETPLACE_NAME} -> ${packageRoot}`);
  console.log(`  Plugin: ${pluginKey}`);
  console.log(`  Settings: ${settingsPath}`);
  console.log(`\nSkills: /freefsm:create, /freefsm:start, /freefsm:current, /freefsm:finish`);
  console.log(`Hook: PostToolUse state reminder (every 5 tool calls)`);
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

  // Check if symlink already exists
  if (existsSync(target)) {
    try {
      const current = readlinkSync(target);
      if (current === skillsSource) {
        console.log("FreeFSM skills already linked for Codex.");
        return;
      }
    } catch {
      // not a symlink
    }
    console.error(`${target} already exists. Remove it first to reinstall.`);
    process.exit(2);
  }

  symlinkSync(skillsSource, target);
  console.log(`FreeFSM skills linked for Codex: ${target} -> ${skillsSource}`);
  console.log(`\nNote: Codex does not support hooks. The agent won't get periodic state reminders.`);
}
