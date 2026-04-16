import { CliError } from "../errors.js";
import type { Scope } from "../runners.js";
import type { InitOptions } from "./init.js";
import type { InstallWorkflowOptions } from "./install-workflow.js";

export function normalizeInitOpts(raw: Record<string, unknown>): InitOptions {
  // Only `--uninstall` is recognized today. Unknown flags are ignored rather
  // than rejected so the CLI stays forgiving.
  return raw.uninstall === true ? { uninstall: true } : {};
}

export function normalizeInstallWorkflowOpts(
  raw: Record<string, unknown>,
): InstallWorkflowOptions {
  const local = raw.local === true;
  const global = raw.global === true;
  if (local && global) {
    throw new CliError("ARGS_INVALID", "cannot combine --local and --global");
  }
  const scope: Scope | undefined = local ? "local" : global ? "global" : undefined;
  return {
    scope,
    yes: raw.yes === true,
  };
}
