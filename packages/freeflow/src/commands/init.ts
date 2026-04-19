import { join } from "node:path";
import { CliError } from "../errors.js";
import { claudeAvailable } from "../install-detect.js";
import {
  claudeInstallPlugin,
  claudeRemoveMarketplace,
  claudeUninstallPlugin,
  getPackageRoot,
  listBundledSkills,
  skillsAdd,
  skillsRemove,
} from "../runners.js";

export type InitOptions = { uninstall?: boolean };

export async function runInit(opts: InitOptions = {}): Promise<void> {
  if (!claudeAvailable()) {
    throw new CliError(
      "CLAUDE_NOT_FOUND",
      "`claude` CLI is not on PATH. Install Claude Code first: https://claude.com/claude-code",
    );
  }

  const packageRoot = getPackageRoot();

  if (opts.uninstall) {
    runUninstall(packageRoot);
    return;
  }

  // 1. Install the Claude plugin (skills + hooks bundled via .claude-plugin/).
  console.log("Installing FreeFlow plugin (Claude Code)…");
  claudeInstallPlugin(packageRoot);
  console.log("✓ FreeFlow plugin installed");

  // 2. Install the same skills globally for codex — it doesn't speak the
  //    Claude plugin manifest, so we lay them down via `npx skills` instead.
  //    Run quiet: the skills CLI is chatty, we bracket it with our own
  //    before/after status lines below.
  console.log("Installing Codex skills globally…");
  skillsAdd(join(packageRoot, "skills"), {
    scope: "global",
    agents: ["codex"],
    interactive: false,
    yes: true,
    quiet: true,
  });
  console.log("✓ Codex skills installed");

  console.log("");
  console.log("Restart Claude Code to activate skills and hooks.");
  console.log("To install workflows: npx fflow install-workflow");
}

/**
 * Reverse of install. Each step is best-effort so a partial install can still
 * be cleaned up without the user having to manually unwind each piece.
 */
function runUninstall(packageRoot: string): void {
  console.log("Uninstalling FreeFlow plugin (Claude Code)…");
  bestEffort(claudeUninstallPlugin, "✓ FreeFlow plugin uninstalled");
  bestEffort(claudeRemoveMarketplace, "✓ freeflow-local marketplace removed");

  console.log("Removing Codex skills globally…");
  const skills = listBundledSkills(packageRoot);
  bestEffort(
    () => skillsRemove({ scope: "global", agent: "codex", skills, quiet: true }),
    "✓ Codex skills removed",
  );
}

function bestEffort(fn: () => void, successMsg: string): void {
  try {
    fn();
    console.log(successMsg);
  } catch (err) {
    const firstLine = (err instanceof Error ? err.message : String(err)).split("\n")[0];
    console.log(`!  skipped (${firstLine})`);
  }
}
