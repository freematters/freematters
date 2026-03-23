import type { GatewayConfig } from "./types.js";

export interface GatewayServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createGatewayServer(config: GatewayConfig): GatewayServer {
  let running = false;

  return {
    async start(): Promise<void> {
      running = true;
      // TODO: implement HTTP server in a later step
    },
    async stop(): Promise<void> {
      running = false;
      // TODO: implement graceful shutdown in a later step
    },
  };
}
