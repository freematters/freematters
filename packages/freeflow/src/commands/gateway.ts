import { randomUUID } from "node:crypto";
import { createGatewayServer } from "../gateway/server.js";
import type { GatewayConfig } from "../gateway/types.js";

export interface GatewayCliOptions {
  port?: number;
  host?: string;
  apiKey?: string;
  storeRoot: string;
}

/**
 * Start the fflow gateway HTTP server.
 * Returns a shutdown function for graceful termination.
 */
export async function gateway(opts: GatewayCliOptions): Promise<() => Promise<void>> {
  const port = opts.port ?? 8080;
  const host = opts.host ?? "0.0.0.0";
  const apiKey = opts.apiKey ?? randomUUID();
  const storeRoot = opts.storeRoot;

  const config: GatewayConfig = {
    port,
    host,
    api_keys: [apiKey],
    store_root: storeRoot,
    max_concurrent_runs: 20,
    idle_timeout_ms: 3600000,
  };
  const server = createGatewayServer(config);

  await server.start();

  process.stderr.write(`fflow gateway listening on ${host}:${port}\n`);
  process.stderr.write(`API Key: ${apiKey}\n`);

  const shutdown = async (): Promise<void> => {
    await server.stop();
  };

  return shutdown;
}
