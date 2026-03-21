import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { describe, expect, it, vi } from "vitest";
import { registerReplyTool } from "../reply-tool.js";

function makeServer(): Server {
  return new Server(
    { name: "test", version: "0.0.1" },
    { capabilities: { tools: {} } },
  );
}

describe("registerReplyTool", () => {
  it("registers list and call handlers without throwing", () => {
    const server = makeServer();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(() => registerReplyTool(server, send)).not.toThrow();
  });

  it("accepts a custom tool name", () => {
    const server = makeServer();
    const send = vi.fn().mockResolvedValue(undefined);
    expect(() =>
      registerReplyTool(server, send, { toolName: "comment" }),
    ).not.toThrow();
  });
});
