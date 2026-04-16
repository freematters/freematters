import { CliError } from "../errors.js";
import type { DeinitOptions } from "./deinit.js";
import type { InitOptions } from "./init.js";

export function normalizeInitOpts(raw: Record<string, unknown>): InitOptions {
  const local = raw.local === true;
  const global = raw.global === true;
  if (local && global) {
    throw new CliError("ARGS_INVALID", "cannot combine --local and --global");
  }
  const scope: "local" | "global" | undefined = local
    ? "local"
    : global
      ? "global"
      : undefined;
  const noHooks = raw.noHooks === true || raw.hooks === false;
  return {
    scope,
    noHooks,
    yes: raw.yes === true,
    agent: typeof raw.agent === "string" ? raw.agent : undefined,
  };
}

export function normalizeDeinitOpts(raw: Record<string, unknown>): DeinitOptions {
  const local = raw.local === true;
  const global = raw.global === true;
  const all = raw.all === true;
  if (local && global) {
    throw new CliError("ARGS_INVALID", "cannot combine --local and --global");
  }
  if (all && (local || global)) {
    throw new CliError("ARGS_INVALID", "cannot combine --all with --local or --global");
  }
  const scope: "local" | "global" | "all" | undefined = all
    ? "all"
    : local
      ? "local"
      : global
        ? "global"
        : undefined;
  return { scope, yes: raw.yes === true };
}
