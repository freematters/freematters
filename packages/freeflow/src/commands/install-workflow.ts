import { join } from "node:path";
import prompts from "prompts";
import { CliError } from "../errors.js";
import { type Scope, getPackageRoot, skillsAdd } from "../runners.js";

export interface InstallWorkflowOptions {
  scope?: Scope;
  yes?: boolean;
}

async function resolveScope(opts: InstallWorkflowOptions): Promise<Scope> {
  if (opts.scope === "local" || opts.scope === "global") {
    return opts.scope;
  }

  // -y skips every prompt; default to local scope.
  if (opts.yes) {
    return "local";
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

  throw new CliError(
    "ARGS_INVALID",
    "Non-TTY install-workflow requires --local, --global, or -y",
  );
}

export async function runInstallWorkflow(opts: InstallWorkflowOptions): Promise<void> {
  const scope = await resolveScope(opts);

  // Pre-select every workflow and every agent (`--skill '*' --agent '*'`).
  // The skills CLI still renders its confirmation picker so the user can
  // see what's about to land; `-y` skips it for non-interactive runs.
  skillsAdd(join(getPackageRoot(), "workflows"), {
    scope,
    all: true,
    yes: opts.yes,
  });

  console.log(`Workflows installed (${scope}).`);
}
