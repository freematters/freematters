/**
 * Verifier MCP tools — controls an embedded Claude Code session.
 *
 * Tools:
 *   run_agent(prompt) — starts a Claude Code session with the given prompt
 *   wait(timeout)     — waits for the agent to finish its current turn
 *   send(text)        — sends a follow-up message to the agent
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { formatToolArgs } from "../agent-log.js";
import { AgentSession } from "./agent-session.js";
import type { DualStreamLogger } from "./dual-stream-logger.js";

export interface VerifierMcpServerOptions {
  logger?: DualStreamLogger;
  verbose?: boolean;
}

export function createVerifierMcpServer(options?: VerifierMcpServerOptions) {
  const logger = options?.logger;
  const verbose = options?.verbose ?? false;
  let session: AgentSession | undefined;

  const runAgent = tool(
    "run_agent",
    "Start an embedded Claude Code agent session with the given prompt.",
    {
      prompt: z.string().describe("The initial prompt for the agent"),
      model: z.string().optional().describe("Claude model override"),
    },
    async (args) => {
      if (session) {
        return {
          isError: true as const,
          content: [
            { type: "text" as const, text: "An agent session is already active." },
          ],
        };
      }

      try {
        session = new AgentSession({
          model: args.model,
          onToolUse: (name, input) => {
            if (verbose) {
              logger?.logEmbedded(`⚡ ${name}${formatToolArgs(name, input)}`);
            }
          },
        });
        session.send(args.prompt);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true }),
            },
          ],
        };
      } catch (err: unknown) {
        session = undefined;
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Failed to start agent: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  );

  const wait = tool(
    "wait",
    "Wait for the embedded agent to complete its current turn. Returns { output }.",
    {
      timeout: z
        .number()
        .optional()
        .default(120000)
        .describe("Timeout in milliseconds (default 120000)"),
    },
    async (args) => {
      if (!session) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "No agent session is active. Call run_agent first.",
            },
          ],
        };
      }

      const output: string[] = [];
      for await (const event of session.stream(args.timeout)) {
        if (event.type === "text") {
          logger?.logEmbedded(event.text);
          output.push(event.text);
        } else if (event.type === "tool_use" && verbose) {
          logger?.logEmbedded(
            `⚡ ${event.name}${formatToolArgs(event.name, event.input)}`,
          );
        } else if (event.type === "error") {
          logger?.logEmbedded(`[error] ${event.text}`);
          output.push(`[error] ${event.text}`);
        } else if (event.type === "timeout") {
          logger?.logEmbedded("[timeout]");
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ type: "timeout" }) },
            ],
          };
        }
      }
      const result = { output: output.join("\n---\n") };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  const send = tool(
    "send",
    "Send a follow-up message to the embedded agent to start a new turn.",
    {
      text: z.string().describe("The message text to send"),
    },
    async (args) => {
      if (!session) {
        return {
          isError: true as const,
          content: [{ type: "text" as const, text: "No agent session is active." }],
        };
      }

      try {
        logger?.logInput(args.text);
        session.send(args.text);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ ok: true }) }],
        };
      } catch (err: unknown) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: err instanceof Error ? err.message : String(err),
            },
          ],
        };
      }
    },
  );

  const server = createSdkMcpServer({
    name: "freefsm-verifier",
    version: "1.0.0",
    tools: [runAgent, wait, send],
  });

  let embeddedSessionId: string | null = null;

  // Use defineProperties instead of Object.assign to preserve the getter.
  // Object.assign flattens getters into their current values at assignment time.
  Object.defineProperties(server, {
    tools: { value: { runAgent, wait, send }, enumerable: true },
    embeddedSessionId: {
      get() {
        return embeddedSessionId;
      },
      enumerable: true,
    },
    closeSession: {
      value() {
        if (session) {
          embeddedSessionId = session.sessionId;
          session.close();
          session = undefined;
        }
      },
      enumerable: true,
    },
  });

  return server as typeof server & {
    tools: { runAgent: typeof runAgent; wait: typeof wait; send: typeof send };
    readonly embeddedSessionId: string | null;
    closeSession(): void;
  };
}
