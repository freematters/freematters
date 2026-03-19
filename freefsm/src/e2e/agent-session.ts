/**
 * AgentSession — high-level multi-turn agent control.
 *
 * Wraps MultiTurnSession with message processing and timeout handling.
 *
 * Flow:
 *   1. send(text) buffers a user message (can be called multiple times)
 *   2. stream(timeout) yields TurnEvents as they arrive, or
 *      wait(timeout) accumulates all output and returns TurnResult
 *   3. send(text) again → stream/wait() for next turn
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

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "error"; text: string }
  | { type: "timeout" };

export class AgentSession {
  private session: MultiTurnSession;
  private options: AgentSessionOptions;

  /** Claude session ID, available after the init message is received. */
  get sessionId(): string | null {
    return this.session.sessionId;
  }

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

  /** Buffer a user message. Sent to the agent on the next stream/wait call. */
  send(text: string): void {
    this.session.send(text);
  }

  /**
   * Async generator that yields TurnEvents as the agent produces them.
   * Completes when the turn ends (result message) or on timeout.
   */
  async *stream(timeout: number): AsyncGenerator<TurnEvent> {
    const deadline = Date.now() + timeout;
    const iterator = this.session.stream();

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        yield { type: "timeout" };
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      });
      const nextPromise = iterator.next().then((r) => r);

      const result = await Promise.race([nextPromise, timeoutPromise]);
      clearTimeout(timer);

      if (result === "timeout") {
        yield { type: "timeout" };
        return;
      }

      if (result.done) return;
      yield* this.processMessage(result.value);
    }
  }

  /**
   * Read agent output until the current turn completes (result message).
   * Returns accumulated assistant text. Times out if the turn takes too long.
   */
  async wait(timeout: number): Promise<TurnResult> {
    const output: string[] = [];
    for await (const event of this.stream(timeout)) {
      if (event.type === "text") {
        output.push(event.text);
      } else if (event.type === "error") {
        output.push(`[error] ${event.text}`);
      } else if (event.type === "tool_use") {
        this.options.onToolUse?.(event.name, event.input);
      } else if (event.type === "timeout") {
        return { output: output.join("\n---\n") || "[timeout]" };
      }
    }
    return { output: output.join("\n---\n") };
  }

  close(): void {
    this.session.close();
  }

  private *processMessage(message: SDKMessage): Generator<TurnEvent> {
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
          yield { type: "text", text: block.text.trim() };
        } else if (block.type === "tool_use" && block.name) {
          yield {
            type: "tool_use",
            name: block.name,
            input: block.input ?? {},
          };
        }
      }
    } else if (message.type === "result") {
      const resultMsg = message as {
        type: "result";
        is_error?: boolean;
        result?: string;
      };
      if (resultMsg.is_error && resultMsg.result) {
        yield { type: "error", text: resultMsg.result };
      }
      // result messages end the turn — don't yield, just let the generator return
    } else if (message.type === "user" || message.type === "rate_limit_event") {
      // user echo / rate limit backoff — no action needed
    } else if (message.type === "system") {
      const sysMsg = message as { type: "system"; message?: string };
      if (sysMsg.message) {
        process.stderr.write(`[agent-session] system: ${sysMsg.message}\n`);
      }
    }
  }
}
