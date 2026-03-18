/**
 * Verifier MCP tools — turn-based interaction with an embedded freefsm run.
 *
 * Communication:
 *   Embedded agent's session ends → turn_complete (with output) → verifier
 *   Verifier calls send_input(text) → becomes next session's prompt
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { DualStreamLogger } from "./dual-stream-logger.js";
import { EmbeddedRun } from "./embedded-run.js";
import type { MessageBus } from "./message-bus.js";

interface RunState {
  run: EmbeddedRun;
  bus: MessageBus;
}

export interface VerifierMcpServerOptions {
  logger?: DualStreamLogger;
}

export function createVerifierMcpServer(options?: VerifierMcpServerOptions) {
  const logger = options?.logger;
  let activeRun: RunState | undefined;

  const startEmbeddedRun = tool(
    "start_embedded_run",
    "Start an embedded freefsm run. Returns { run_id, store_root }.",
    {
      fsm_path: z.string().describe("Path to the FSM YAML file"),
      prompt: z.string().optional().describe("Initial user prompt"),
      root: z.string().optional().describe("Store root directory"),
      model: z.string().optional().describe("Claude model override"),
    },
    async (args) => {
      if (activeRun) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "An embedded run is already active.",
            },
          ],
        };
      }

      const run = new EmbeddedRun(args.fsm_path, {
        root: args.root,
        prompt: args.prompt,
        model: args.model,
      });

      await run.start();
      activeRun = { run, bus: run.getBus() };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              run_id: run.getRunId(),
              store_root: run.getStoreRoot(),
            }),
          },
        ],
      };
    },
  );

  const wait = tool(
    "wait",
    "Wait for the embedded agent to complete its current turn. Returns { type: 'turn_complete', output }.",
    {
      timeout: z
        .number()
        .optional()
        .default(120000)
        .describe("Timeout in milliseconds (default 120000)"),
    },
    async (args) => {
      if (!activeRun) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "No embedded run is active. Call start_embedded_run first.",
            },
          ],
        };
      }

      try {
        const msg = await activeRun.bus.waitForMessage(args.timeout);
        if (msg.output) {
          logger?.logEmbedded(msg.output);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(msg),
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

  const sendInput = tool(
    "send_input",
    "Send a message to the embedded agent as its next prompt.",
    {
      text: z.string().describe("The message text to send"),
    },
    async (args) => {
      if (!activeRun) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "No embedded run is active.",
            },
          ],
        };
      }

      logger?.logInput(args.text);
      activeRun.bus.post(args.text);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ ok: true }) },
        ],
      };
    },
  );

  return createSdkMcpServer({
    name: "freefsm-verifier",
    version: "1.0.0",
    tools: [startEmbeddedRun, wait, sendInput],
  });
}
