/**
 * `fflow gateway` command — starts the Gateway server.
 *
 * Parses CLI options, creates a GatewayConfig, and starts the HTTP/WebSocket
 * server. Prints listening info and handles graceful shutdown on signals.
 */

import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { createGatewayServer } from "../gateway/server.js";
import type { GatewayConfig } from "../gateway/types.js";

export interface GatewayOpts {
  port: number;
  host: string;
  apiKey?: string;
  storeRoot?: string;
}

/**
 * Start the Gateway server.
 *
 * Returns a shutdown function that can be used to stop the server.
 */
export async function gateway(opts: GatewayOpts): Promise<() => Promise<void>> {
  const apiKey = opts.apiKey ?? randomUUID();
  const generated = !opts.apiKey;
  const storeRoot = opts.storeRoot ?? join(homedir(), ".freeflow");

  const config: GatewayConfig = {
    port: opts.port,
    host: opts.host,
    api_keys: [apiKey],
    store_root: storeRoot,
    max_concurrent_runs: 20,
    idle_timeout_ms: 3_600_000,
  };

  const server = createGatewayServer(config);
  await server.start();

  process.stderr.write(`Gateway listening on ${config.host}:${config.port}\n`);
  if (generated) {
    process.stderr.write(`Generated API key: ${apiKey}\n`);
  }
  process.stderr.write(`Store root: ${storeRoot}\n`);

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    process.stderr.write("Shutting down gateway...\n");
    await server.stop();
  };

  // Handle SIGINT/SIGTERM for graceful shutdown
  const onSignal = () => {
    shutdown().then(() => process.exit(0));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return shutdown;
}
