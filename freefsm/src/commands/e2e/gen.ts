import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CliError } from "../../errors.js";
import { handleError } from "../../output.js";
import { runCore } from "../run.js";

export interface GenArgs {
  source: string;
  json: boolean;
  root?: string;
}

/**
 * Main gen command handler — delegates to runCore().
 */
export async function gen(args: GenArgs): Promise<void> {
  try {
    const source = resolve(args.source);
    if (!source.endsWith(".yaml") && !source.endsWith(".yml")) {
      throw new CliError(
        "ARGS_INVALID",
        "Provide a .yaml or .yml FSM workflow file path.",
      );
    }

    const root = args.root ?? join(homedir(), ".freefsm");
    await runCore({ fsmPath: source, root });
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
