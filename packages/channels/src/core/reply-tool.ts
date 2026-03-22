import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

export interface ReplyToolOptions {
  toolName?: string;
  toolDescription?: string;
}

/**
 * Register a single reply/comment tool on the server.
 * NOTE: Only one tool can be registered per server because setRequestHandler
 * replaces any existing handler for the same schema. If multiple tools are
 * needed in the future, refactor to accumulate tools in a registry.
 */
export function registerReplyTool(
  server: Server,
  send: (chatId: string, text: string) => Promise<void>,
  options?: ReplyToolOptions,
): void {
  const toolName = options?.toolName ?? "reply";
  const toolDescription =
    options?.toolDescription ?? "Send a message back over this channel";

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: toolName,
        description: toolDescription,
        inputSchema: {
          type: "object" as const,
          properties: {
            chat_id: {
              type: "string",
              description: "The conversation to reply in",
            },
            text: {
              type: "string",
              description: "The message to send",
            },
          },
          required: ["chat_id", "text"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === toolName) {
      const { chat_id, text } = req.params.arguments as {
        chat_id: string;
        text: string;
      };
      await send(chat_id, text);
      return { content: [{ type: "text" as const, text: "sent" }] };
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  });
}
