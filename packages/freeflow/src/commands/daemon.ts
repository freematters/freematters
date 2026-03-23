/**
 * `fflow daemon` CLI subcommand — starts the Agent Daemon process.
 *
 * Usage:
 *   fflow daemon --gateway ws://localhost:8080 [--api-key <key>] [--max-agents <n>]
 */

import type { Command } from "commander";
import type { Daemon } from "../daemon/index.js";
import type { DaemonConfig } from "../gateway/types.js";

const DEFAULT_MAX_AGENTS = 10;
const DEFAULT_IDLE_TIMEOUT_MS = 300_000; // 5 minutes

export interface DaemonCommandDeps {
  createDaemon: (config: DaemonConfig) => Daemon;
}

export function buildDaemonCommand(program: Command, deps?: DaemonCommandDeps): void {
  program
    .command("daemon")
    .description("start the Agent Daemon process")
    .requiredOption("--gateway <url>", "Gateway WebSocket URL to connect to")
    .option("--api-key <key>", "API key for Gateway authentication")
    .option(
      "--max-agents <n>",
      "maximum concurrent agents",
      Number.parseInt,
      DEFAULT_MAX_AGENTS,
    )
    .action(async (opts: Record<string, unknown>) => {
      const gatewayUrl = opts.gateway as string;
      const apiKey = (opts.apiKey as string) ?? "";
      const maxAgents = (opts.maxAgents as number) ?? DEFAULT_MAX_AGENTS;

      const config: DaemonConfig = {
        gateway_url: gatewayUrl,
        api_key: apiKey,
        max_agents: maxAgents,
        agent_idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MS,
      };

      const factory =
        deps?.createDaemon ?? (await import("../daemon/index.js")).createDaemon;
      const daemon = factory(config);

      // Graceful shutdown on signals
      process.on("SIGINT", () => {
        daemon.stop();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        daemon.stop();
        process.exit(0);
      });

      process.stderr.write(`Connecting to gateway at ${gatewayUrl}...\n`);
      daemon.start();
      process.stderr.write(`Daemon started (max agents: ${maxAgents})\n`);
    });
}
