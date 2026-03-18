/**
 * AgentSession — high-level multi-turn agent control.
 *
 * Wraps MultiTurnSession with message processing and timeout handling.
 *
 * Flow:
 *   1. send(text) buffers a user message (can be called multiple times)
 *   2. wait(timeout) reads agent output until turn complete, returns TurnResult
 *   3. send(text) again → wait() for next turn
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { MultiTurnSession } from "./multi-turn-session.js";

export interface AgentSessionOptions {
  model?: string;
  disallowedTools?: string[];
  /** Called for each tool use during a turn. */
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
}

export interface TurnResult {
  output: string;
}

export class AgentSession {
  private session: MultiTurnSession;
  private options: AgentSessionOptions;

  constructor(options: AgentSessionOptions = {}) {
    this.options = options;
    this.session = new MultiTurnSession({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: ["user", "project", "local"],
      disallowedTools: ["AskUserQuestion", "EnterPlanMode", "ExitPlanMode"],
      ...(options.model !== undefined && { model: options.model }),
    });
  }

  /** Buffer a user message. Sent to the agent on the next wait() call. */
  send(text: string): void {
    this.session.send(text);
  }

  /**
   * Read agent output until the current turn completes (result message).
   * Returns accumulated assistant text. Times out if the turn takes too long.
   */
  async wait(timeout: number): Promise<TurnResult> {
    const output: string[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
    }, timeout);

    try {
      for await (const message of this.session.stream()) {
        if (timedOut) break;
        this.processMessage(message, output);
      }
    } finally {
      clearTimeout(timer);
    }

    const text = output.join("\n---\n");
    if (timedOut) {
      return { output: text || "[timeout]" };
    }
    return { output: text };
  }

  close(): void {
    this.session.close();
  }

  private processMessage(message: SDKMessage, output: string[]): void {
    if (message.type === "assistant") {
      const msg = message as {
        type: "assistant";
        message: {
          content: Array<{
            type: string;
            text?: string;
            name?: string;
            input?: Record<string, unknown>;
          }>;
        };
      };
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text?.trim()) {
          output.push(block.text.trim());
        } else if (block.type === "tool_use" && block.name) {
          this.options.onToolUse?.(block.name, block.input ?? {});
        }
      }
    } else if (message.type === "result") {
      const resultMsg = message as {
        type: "result";
        is_error?: boolean;
        result?: string;
      };
      if (resultMsg.is_error && resultMsg.result) {
        output.push(`[error] ${resultMsg.result}`);
      } else if (resultMsg.result && output.length === 0) {
        // Only include result text if no assistant messages were captured
        // (e.g. unknown skill errors that skip assistant messages entirely)
        output.push(resultMsg.result);
      }
    } else if (message.type === "user" || message.type === "rate_limit_event") {
      // user echo / rate limit backoff — no action needed
    } else if (message.type === "system") {
      const sysMsg = message as { type: "system"; message?: string };
      if (sysMsg.message) {
        process.stderr.write(`[agent-session] system: ${sysMsg.message}\n`);
      }
    } else {
      process.stderr.write(`[agent-session] unhandled message type: ${message.type}\n`);
    }
  }
}
