/**
 * Verifier MCP tools — MCP server exposing start_embedded_run, wait, and send_input
 * for the verifier agent to interact with an embedded freefsm run.
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

/**
 * Create a verifier MCP server with tools for controlling an embedded freefsm run.
 *
 * The returned MCP server exposes three tools:
 * - start_embedded_run: launches an embedded freefsm run
 * - wait: waits for the next event from the embedded agent
 * - send_input: sends input to a pending request_input call
 */
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
              text: "An embedded run is already active. Wait for it to exit before starting another.",
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

      activeRun = {
        run,
        bus: run.getBus(),
      };

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
    "Wait for the embedded agent to complete a turn, request input, or exit. Returns status: turn_complete, awaiting_input, exited, or timeout.",
    {
      timeout: z
        .number()
        .optional()
        .default(60000)
        .describe("Timeout in milliseconds (default 60000)"),
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
        const event = await activeRun.bus.waitForEvent(args.timeout);

        switch (event.type) {
          case "input_request":
            if (event.output) {
              logger?.logEmbedded(event.output);
            }
            logger?.logEmbedded(`[request_input] ${event.prompt}`);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    status: "awaiting_input",
                    prompt: event.prompt,
                    output: event.output,
                  }),
                },
              ],
            };
          case "turn_complete":
            if (event.output) {
              logger?.logEmbedded(event.output);
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    status: "turn_complete",
                    output: event.output,
                  }),
                },
              ],
            };
          case "exited":
            if (event.output) {
              logger?.logEmbedded(event.output);
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    status: "exited",
                    code: event.code,
                    output: event.output,
                  }),
                },
              ],
            };
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.message === "timeout") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ status: "timeout" }),
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
    "Send input text to the embedded agent. Fails if no request_input is pending.",
    {
      text: z.string().describe("The input text to send"),
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
        logger?.logInput(args.text);
        activeRun.bus.resolveInput(args.text);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true }),
            },
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
    tools: [startEmbeddedRun, wait, sendInput],
  });
}
