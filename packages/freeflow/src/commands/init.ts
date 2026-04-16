import { join } from "node:path";
import prompts from "prompts";
import { CliError } from "../errors.js";
import { claudeAvailable, detectInstalled } from "../install-detect.js";
import {
  type Scope,
  claudeInstallPlugin,
  getPackageRoot,
  skillsAdd,
} from "../runners.js";
import { runDeinit } from "./deinit.js";

export interface InitOptions {
  scope?: "local" | "global";
  noHooks?: boolean;
  yes?: boolean;
  /** Forwarded verbatim to the `skills` CLI's `--agent` flag. */
  agent?: string;
}

async function resolveScope(opts: InitOptions): Promise<Scope> {
  if (opts.scope === "local" || opts.scope === "global") {
    return opts.scope;
  }

  if (process.stdin.isTTY === true) {
    const response = (await prompts({
      type: "select",
      name: "scope",
      message: "Install scope?",
      choices: [
        { title: "local (project)", value: "local" },
        { title: "global (user)", value: "global" },
      ],
    })) as { scope?: Scope };

    if (response.scope === "local" || response.scope === "global") {
      return response.scope;
    }
    throw new CliError("ARGS_INVALID", "Install scope is required");
  }

  if (opts.yes) {
    return "local";
  }

  throw new CliError("ARGS_INVALID", "Non-TTY init requires --local, --global, or -y");
}

async function shouldInstallHooks(opts: InitOptions): Promise<boolean> {
  if (opts.noHooks) return false;
  if (!claudeAvailable()) return false;
  if (opts.yes) return true;

  if (process.stdin.isTTY === true) {
    const response = (await prompts({
      type: "confirm",
      name: "installHook",
      message: "Install Claude Code hook? (enables PostToolUse state reminders)",
      initial: true,
    })) as { installHook?: boolean };
    return response.installHook === true;
  }

  throw new CliError(
    "ARGS_INVALID",
    "Non-TTY init requires -y or --no-hooks when claude is on PATH",
  );
}

export async function runInit(opts: InitOptions): Promise<void> {
  const scope = await resolveScope(opts);
  const isTTY = process.stdin.isTTY === true;

  // ── Reinstall check ─────────────────────────────────────────────────
  if (detectInstalled(scope)) {
    let confirmed: boolean;
    if (opts.yes) {
      confirmed = true;
    } else if (isTTY) {
      const response = (await prompts({
        type: "confirm",
        name: "reinstall",
        message: `FreeFlow is already installed in ${scope}. Reinstall?`,
        initial: false,
      })) as { reinstall?: boolean };
      confirmed = response.reinstall === true;
    } else {
      throw new CliError(
        "ARGS_INVALID",
        `FreeFlow is already installed in ${scope}; non-TTY reinstall requires -y to confirm`,
      );
    }

    if (!confirmed) {
      console.log("Skipping install");
      return;
    }

    await runDeinit({ scope, yes: true, skipConfirm: true });
  }

  // ── Hook decision ───────────────────────────────────────────────────
  const installHook = await shouldInstallHooks(opts);

  // ── Effect region with rollback on failure ──────────────────────────
  const packageRoot = getPackageRoot();
  try {
    if (installHook) {
      claudeInstallPlugin(packageRoot);
    }
    skillsAdd(join(packageRoot, "skills"), {
      scope,
      agent: opts.agent,
    });
    skillsAdd(join(packageRoot, "workflows"), {
      scope,
      agent: opts.agent,
    });
  } catch (error) {
    try {
      await runDeinit({ scope, yes: true, skipConfirm: true });
    } catch (rollbackErr) {
      console.warn(
        `Rollback failed: ${
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)
        }`,
      );
    }
    throw error;
  }

  // ── Success summary ─────────────────────────────────────────────────
  console.log(`FreeFlow installed (${scope}).`);
  console.log("Skills: /fflow-author, /fflow, /e2e-run");
  if (installHook) {
    console.log("Hook: PostToolUse state reminder");
    console.log("Restart Claude Code to activate the plugin.");
  }
}
