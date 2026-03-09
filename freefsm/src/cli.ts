#!/usr/bin/env node

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { current } from "./commands/current.js";
import { finish } from "./commands/finish.js";
import { goto } from "./commands/goto.js";
import { start } from "./commands/start.js";
import { main as postToolUseMain } from "./hooks/post-tool-use.js";

function resolveRoot(flagRoot?: string): string {
  if (flagRoot) return resolve(flagRoot);
  if (process.env.FREEFSM_ROOT) return resolve(process.env.FREEFSM_ROOT);
  return join(homedir(), ".freefsm");
}

type GlobalOpts = { root?: string; json?: boolean };

function getGlobalOpts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

const program = new Command()
  .name("freefsm")
  .description(
    `CLI-first FSM runtime for agent workflows

Example:
  $ freefsm start workflow.yaml --run-id my-run
  $ freefsm goto review --run-id my-run --on "draft ready"
  $ freefsm current --run-id my-run
  $ freefsm finish --run-id my-run`,
  )
  .version("0.1.0")
  .option("--root <path>", "storage root (default: ~/.freefsm/ or $FREEFSM_ROOT)")
  .option("-j, --json", "output as JSON envelope")
  .configureOutput({
    outputError: (str, write) => write(str),
  })
  .exitOverride((err) => {
    process.exit(err.exitCode === 1 ? 2 : err.exitCode);
  });

program
  .command("start")
  .description("initialize a new run from a workflow YAML")
  .argument("<fsm_path>", "path to FSM YAML file")
  .option("--run-id <id>", "run identifier (auto-generated if omitted)")
  .action((_fsmPath: string, opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    start({
      fsmPath: resolve(_fsmPath),
      runId: opts["runId"] as string | undefined,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("current")
  .description("show current state of a run")
  .requiredOption("--run-id <id>", "run identifier")
  .action((opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    current({
      runId: opts["runId"] as string,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("goto")
  .description("transition to a new state")
  .argument("<target_state>", "target state name")
  .requiredOption("--run-id <id>", "run identifier")
  .requiredOption("--on <label>", "transition label")
  .action((_target: string, opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    goto({
      target: _target,
      runId: opts["runId"] as string,
      on: opts["on"] as string,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("finish")
  .description("abort an active run")
  .requiredOption("--run-id <id>", "run identifier")
  .action((opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    finish({
      runId: opts["runId"] as string,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

// Hidden hook commands (not shown in --help)
const hookCmd = program
  .command("_hook", { hidden: true })
  .description("internal hooks");

hookCmd
  .command("post-tool-use")
  .description("PostToolUse hook handler (reads stdin)")
  .action(() => {
    postToolUseMain();
  });

program.parse();
