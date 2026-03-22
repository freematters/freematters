import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ChannelServer, ChannelServerConfig } from "./types.js";

export function createChannelServer(config: ChannelServerConfig): ChannelServer {
  const capabilities: Record<string, unknown> = {
    experimental: { "claude/channel": {} },
  };
  if (config.twoWay) {
    capabilities.tools = {};
  }

  const server = new Server(
    { name: config.name, version: config.version },
    {
      capabilities,
      instructions: config.instructions,
    },
  );

  const notify = async (
    content: string,
    meta?: Record<string, string>,
  ): Promise<void> => {
    await server.notification({
      method: "notifications/claude/channel",
      params: { content, ...(meta ? { meta } : {}) },
    });
  };

  const connect = async (): Promise<void> => {
    await server.connect(new StdioServerTransport());
  };

  return { server, notify, connect };
}
