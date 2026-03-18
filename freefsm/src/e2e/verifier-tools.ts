/**
 * Verifier MCP tools — controls an embedded agent via V2 SDK session.
 *
 * Tools:
 *   run_agent(fsm_path) — starts a session, sends initial prompt, returns handle
 *   wait(timeout)       — waits for agent to finish current turn
 *   send(text)          — sends a message to resume the agent
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { loadFsm } from "../fsm.js";
import { formatStateCard, stateCardFromFsm } from "../output.js";
import { Store } from "../store.js";
import { AgentSession } from "./agent-session.js";
import type { DualStreamLogger } from "./dual-stream-logger.js";

export interface VerifierMcpServerOptions {
  logger?: DualStreamLogger;
}

export function createVerifierMcpServer(options?: VerifierMcpServerOptions) {
  const logger = options?.logger;
  let session: AgentSession | undefined;
  let storeRoot: string | undefined;
  let runId: string | undefined;

  const runAgent = tool(
    "run_agent",
    "Start an embedded freefsm agent session. Returns { run_id, store_root }.",
    {
      fsm_path: z.string().describe("Path to the FSM YAML file"),
      prompt: z.string().optional().describe("Additional context for the agent"),
      root: z.string().optional().describe("Store root directory"),
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
        // Load FSM and init store
        const fsm = loadFsm(args.fsm_path);
        storeRoot = args.root ?? `/tmp/freefsm-embedded-${Date.now()}`;
        const name = args.fsm_path.replace(/^.*\//, "").replace(/\.(fsm\.)?ya?ml$/i, "");
        runId = `${name}-${Date.now()}`;

        const store = new Store(storeRoot);
        store.initRun(runId, args.fsm_path);
        store.commit(
          runId,
          {
            event: "start",
            from_state: null,
            to_state: fsm.initial,
            on_label: null,
            actor: "system",
            reason: null,
          },
          { run_status: "active", state: fsm.initial },
        );

        // Build initial message with state card
        const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
        const stateCard = formatStateCard(card);
        const fsmGuide = fsm.guide ?? "No guide provided.";
        const systemContext = `You are running the "${name}" workflow.\n\n## FSM Guide\n\n${fsmGuide}`;

        let initialMessage = `${systemContext}\n\n${stateCard}`;
        if (args.prompt) {
          initialMessage += `\n\n## Additional Context\n\n${args.prompt}`;
        }

        // Create session with FSM MCP tools
        session = new AgentSession({
          model: args.model,
        });

        // Send initial prompt to start the first turn
        await session.send(initialMessage);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ run_id: runId, store_root: storeRoot }),
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
    "Send a message to the embedded agent to start a new turn.",
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
