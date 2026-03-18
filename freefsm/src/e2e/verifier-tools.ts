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
import { AgentSession } from "./agent-session.js";
import type { DualStreamLogger } from "./dual-stream-logger.js";

export interface VerifierMcpServerOptions {
  logger?: DualStreamLogger;
}

export function createVerifierMcpServer(options?: VerifierMcpServerOptions) {
  const logger = options?.logger;
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
            const inputStr = JSON.stringify(input);
            const short = inputStr.length > 100 ? `${inputStr.slice(0, 100)}...` : inputStr;
            logger?.logEmbedded(`[tool] ${name}(${short})`);
          },
        });
        await session.send(args.prompt);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, session_id: session.getSessionId() }),
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
            { type: "text" as const, text: "No agent session is active. Call run_agent first." },
          ],
        };
      }

      try {
        const result = await session.wait(args.timeout);
        if (result.output) {
          logger?.logEmbedded(result.output);
        }
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result) },
          ],
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "timeout") {
          return {
            content: [
              { type: "text" as const, text: JSON.stringify({ type: "timeout" }) },
            ],
          };
        }
        throw err;
      }
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
          content: [
            { type: "text" as const, text: "No agent session is active." },
          ],
        };
      }

      try {
        logger?.logInput(args.text);
        await session.send(args.text);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ ok: true }) },
          ],
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

  return createSdkMcpServer({
    name: "freefsm-verifier",
    version: "1.0.0",
    tools: [runAgent, wait, send],
  });
}
