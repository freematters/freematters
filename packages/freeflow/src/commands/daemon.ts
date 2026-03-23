/**
 * `fflow daemon` command — starts the Agent Daemon.
 *
 * Provides both a standalone function and a Commander subcommand builder.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import type { DaemonConfig } from "../gateway/types.js";

/** Resolve the CLI entry point path from import.meta.url or a provided override. */
function resolveCliPath(override?: string): string {
  if (override) return resolve(override);
  // Default: resolve relative to this file → ../../dist/cli.js
  const thisFile = fileURLToPath(import.meta.url);
  // In dist: dist/commands/daemon.js → dist/cli.js
  return join(thisFile, "../../cli.js");
}

export interface DaemonOpts {
  gateway: string;
  apiKey?: string;
  maxAgents?: string;
  storeRoot?: string;
  /** Override for the CLI entry-point path (for testing). */
  cliPath?: string;
}

/**
 * Start the Agent Daemon.
 *
 * Returns a cleanup function that stops the daemon.
 */
export async function startDaemon(opts: DaemonOpts): Promise<() => void> {
  const { createDaemon } = await import("../daemon/index.js");

  const gatewayUrl = opts.gateway;
  const apiKey = opts.apiKey ?? "";
  const maxAgents = opts.maxAgents ? Number.parseInt(opts.maxAgents, 10) : 10;
  const storeRoot = opts.storeRoot ?? join(homedir(), ".freeflow");
  const cliPath = resolveCliPath(opts.cliPath);

  const config: DaemonConfig = {
    gateway_url: gatewayUrl,
    api_key: apiKey,
    max_agents: maxAgents,
    agent_idle_timeout_ms: 300_000,
    store_root: storeRoot,
    cli_path: cliPath,
  };

  const daemon = createDaemon(config);
  daemon.start();

  process.stderr.write(`Daemon connecting to ${gatewayUrl}\n`);
  process.stderr.write(`Max agents: ${maxAgents}\n`);
  process.stderr.write(`Store root: ${storeRoot}\n`);

  const shutdown = () => {
    process.stderr.write("Shutting down daemon...\n");
    daemon.stop();
  };

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  return shutdown;
}

/**
 * Register the `daemon` subcommand on a Commander program.
 * Alternative to inline registration in cli.ts — useful for testing.
 */
export function buildDaemonCommand(
  program: Command,
  deps?: { cliPath?: string },
): void {
  program
    .command("daemon")
    .description("start an Agent Daemon that connects to a Gateway")
    .requiredOption(
      "--gateway <url>",
      "Gateway WebSocket URL (e.g., ws://localhost:8080/ws/daemon)",
    )
    .option("--api-key <key>", "API key for Gateway authentication")
    .option("--max-agents <n>", "maximum number of concurrent agents", "10")
    .option("--store-root <path>", "freeflow storage root")
    .action(async (opts: Record<string, unknown>) => {
      await startDaemon({
        gateway: opts.gateway as string,
        apiKey: opts.apiKey as string | undefined,
        maxAgents: opts.maxAgents as string | undefined,
        storeRoot: opts.storeRoot as string | undefined,
        cliPath: deps?.cliPath,
      });
    });
}
