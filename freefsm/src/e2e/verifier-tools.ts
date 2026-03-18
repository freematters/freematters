/**
 * Verifier MCP tools — controls an embedded freefsm agent session.
 *
 * Tools:
 *   runAgent(fsm_path) — starts a Claude Agent SDK session, bypasses permissions
 *   wait(timeout)      — waits for the agent to complete its current turn
 *   send(text)         — sends a message to resume the agent session
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
    "Start an embedded freefsm agent session. Returns { run_id, store_root }.",
    {
      fsm_path: z.string().describe("Path to the FSM YAML file"),
      prompt: z.string().optional().describe("Initial user prompt"),
      root: z.string().optional().describe("Store root directory"),
      model: z.string().optional().describe("Claude model override"),
    },
    async (args) => {
      if (session) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "An agent session is already active.",
            },
          ],
        };
      }

      try {
        session = new AgentSession({
          fsmPath: args.fsm_path,
          root: args.root,
          prompt: args.prompt,
          model: args.model,
        });

        await session.start();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                run_id: session.getRunId(),
                store_root: session.getStoreRoot(),
              }),
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
    "Wait for the embedded agent to complete its current turn. Returns { output, done }.",
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

      try {
        const result = await session.wait(args.timeout);
        if (result.output) {
          logger?.logEmbedded(result.output);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result),
            },
          ],
        };
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "timeout") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ type: "timeout" }),
              },
            ],
          };
        }
        throw err;
      }
    },
  );

  const send = tool(
    "send",
    "Send a message to the embedded agent to resume its session.",
    {
      text: z.string().describe("The message text to send"),
    },
    async (args) => {
      if (!session) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "No agent session is active.",
            },
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
