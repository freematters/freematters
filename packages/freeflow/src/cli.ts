#!/usr/bin/env node

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };
import { Command } from "commander";
import { current } from "./commands/current.js";
import { finish } from "./commands/finish.js";
import { goto } from "./commands/goto.js";
import { history } from "./commands/history.js";
import { install } from "./commands/install.js";
import { list } from "./commands/list.js";
import { convert } from "./commands/markdown/convert.js";
import { start } from "./commands/start.js";
import { validate } from "./commands/validate.js";
import { main as postToolUseMain } from "./hooks/post-tool-use.js";
import { handleError } from "./output.js";
import { resolveWorkflow } from "./resolve-workflow.js";

function resolveRoot(flagRoot?: string): string {
  if (flagRoot) return resolve(flagRoot);
  const envRoot = process.env.FREEFLOW_ROOT ?? process.env.FREEFSM_ROOT;
  if (envRoot) return resolve(envRoot);
  return join(homedir(), ".freeflow");
}

type GlobalOpts = { root?: string; json?: boolean };

function getGlobalOpts(cmd: Command): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

function resolveWorkflowOrExit(input: string, json: boolean): string {
  try {
    return resolveWorkflow(input);
  } catch (err: unknown) {
    handleError(err, json); // handleError is typed `never` (always exits)
    process.exit(2); // unreachable — satisfies return type if handleError signature changes
  }
}

const program = new Command()
  .name("fflow")
  .description(
    `CLI-first workflow runtime for agent workflows

Example:
  $ fflow start workflow.yaml --run-id my-run
  $ fflow goto review --run-id my-run --on "draft ready"
  $ fflow current --run-id my-run
  $ fflow finish --run-id my-run`,
  )
  .version(version)
  .option("--root <path>", "storage root (default: ~/.freeflow/ or $FREEFLOW_ROOT)")
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
  .argument("<fsm_path>", "path to workflow YAML file")
  .option("--run-id <id>", "run identifier (auto-generated if omitted)")
  .option("--lite", "enable lite mode (abbreviated output on re-visited states)")
  .action((_fsmPath: string, opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    start({
      fsmPath: resolveWorkflowOrExit(_fsmPath, json ?? false),
      runId: opts.runId as string | undefined,
      root: resolveRoot(root),
      json: json ?? false,
      lite: (opts.lite as boolean) ?? false,
    });
  });

program
  .command("run")
  .description("launch an Agent SDK session to execute a workflow autonomously")
  .argument("<fsm_path>", "path to workflow YAML file")
  .option("--run-id <id>", "run identifier (auto-generated if omitted)")
  .option("--prompt <text>", "user prompt to append to the initial state card")
  .option("--model <model>", "Claude model to use")
  .option("--verbose", "show tool calls and agent messages in output")
  .option("--stay", "stay and accept user input after workflow completes")
  .option("--lite", "enable lite mode (abbreviated output on re-visited states)")
  .option("--gateway <url>", "connect to remote Gateway instead of local execution")
  .option("--api-key <key>", "API key for Gateway authentication")
  .action(async (_fsmPath: string, opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    const { run: runCmd } = await import("./commands/run.js");
    await runCmd({
      fsmPath: resolveWorkflowOrExit(_fsmPath, json ?? false),
      runId: opts.runId as string | undefined,
      root: resolveRoot(root),
      json: json ?? false,
      prompt: opts.prompt as string | undefined,
      model: opts.model as string | undefined,
      verbose: (opts.verbose as boolean) ?? false,
      stay: (opts.stay as boolean) ?? false,
      lite: (opts.lite as boolean) ?? false,
      gateway: opts.gateway as string | undefined,
      apiKey: opts.apiKey as string | undefined,
    });
  });

program
  .command("current")
  .description("show current state of a run")
  .requiredOption("--run-id <id>", "run identifier")
  .action((opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    current({
      runId: opts.runId as string,
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
      runId: opts.runId as string,
      on: opts.on as string,
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
      runId: opts.runId as string,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("history")
  .description("show transition history for a run")
  .requiredOption("--run-id <id>", "run identifier")
  .option("--limit <n>", "show last N transitions", Number.parseInt)
  .option("--since <iso>", "show transitions since ISO timestamp")
  .action((opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    history({
      runId: opts.runId as string,
      limit: opts.limit as number | undefined,
      since: opts.since as string | undefined,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("list")
  .description("list all runs")
  .option("--status <status>", "filter by status (active, completed, aborted)")
  .action((opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    list({
      status: opts.status as string | undefined,
      root: resolveRoot(root),
      json: json ?? false,
    });
  });

program
  .command("validate")
  .description("validate a workflow YAML file and report stats")
  .argument("<fsm_path>", "path to workflow YAML file")
  .action((_fsmPath: string, _opts: Record<string, unknown>, cmd: Command) => {
    const { json } = getGlobalOpts(cmd);
    validate({
      fsmPath: resolve(_fsmPath),
      json: json ?? false,
    });
  });

program
  .command("install")
  .description("register freeflow with an agent platform")
  .argument("<platform>", "target platform: claude or codex")
  .action((platform: string) => {
    if (platform !== "claude" && platform !== "codex") {
      console.error(`Unknown platform "${platform}". Use "claude" or "codex".`);
      process.exit(2);
    }
    install(platform as "claude" | "codex");
  });

program
  .command("verify")
  .description("execute a test plan and produce a report")
  .argument("<plan>", "path to test plan markdown file")
  .requiredOption("--test-dir <path>", "output directory for artifacts")
  .option("--model <model>", "Claude model to use")
  .option("--verbose", "show tool calls in output")
  .action(async (planPath: string, opts: Record<string, unknown>, cmd: Command) => {
    const { root, json } = getGlobalOpts(cmd);
    const { verify } = await import("./commands/e2e/verify.js");
    await verify({
      planPath: resolve(planPath),
      testDir: resolve(opts.testDir as string),
      root: resolveRoot(root),
      json: json ?? false,
      model: opts.model as string | undefined,
      verbose: (opts.verbose as boolean) ?? false,
    });
  });

// Markdown subcommands
const markdownCmd = program
  .command("markdown")
  .description("markdown workflow format utilities");

markdownCmd
  .command("convert")
  .description("convert between YAML and Markdown workflow formats")
  .argument("<file>", "path to .workflow.yaml or .workflow.md file")
  .option(
    "-o, --output <path>",
    "output file path (default: same basename, swapped extension)",
  )
  .action((file: string, opts: Record<string, unknown>, cmd: Command) => {
    const { json } = getGlobalOpts(cmd);
    try {
      convert({
        filePath: resolve(file),
        output: opts.output as string | undefined,
        json: json ?? false,
      });
    } catch (err: unknown) {
      handleError(err, json ?? false);
    }
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
