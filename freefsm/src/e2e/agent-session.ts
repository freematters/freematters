/**
 * AgentSession — wraps a Claude Agent SDK V2 session for multi-turn control.
 *
 * Starts a generic Claude Code session (not FSM-specific).
 * The verifier controls the agent via send() and wait().
 *
 * Key: stream() is started immediately after send() to avoid missing messages.
 * wait() just waits for the stream consumption to finish.
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKSession } from "@anthropic-ai/claude-agent-sdk";

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
  private session: SDKSession;
  private onToolUse?: (name: string, input: Record<string, unknown>) => void;
  // The promise for the current turn's stream consumption
  private turnPromise: Promise<TurnResult> | undefined;

  constructor(options: AgentSessionOptions = {}) {
    this.onToolUse = options.onToolUse;
    this.session = unstable_v2_createSession({
      model: options.model ?? "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      dangerouslySkipPermissions: true,
      settingSources: ["user", "project", "local"],
      disallowedTools: options.disallowedTools ?? [
        "AskUserQuestion",
        "ExitPlanMode",
        "EnterPlanMode",
      ],
    } as Parameters<typeof unstable_v2_createSession>[0]);
  }

  /**
   * Send a message and immediately start consuming the response stream.
   * Call wait() to get the result once the turn completes.
   */
  async send(text: string): Promise<void> {
    await this.session.send(text);
    // Start consuming the stream immediately so we don't miss messages
    this.turnPromise = this.consumeStream();
  }

  /**
   * Wait for the current turn to complete. Returns accumulated assistant text.
   * Applies a timeout — if exceeded, returns whatever output was captured so far.
   */
  async wait(timeout: number): Promise<TurnResult> {
    if (!this.turnPromise) {
      return { output: "" };
    }

    const timeoutPromise = new Promise<TurnResult>((resolve) => {
      setTimeout(() => resolve({ output: "[timeout]" }), timeout);
    });

    return Promise.race([this.turnPromise, timeoutPromise]);
  }

  close(): void {
    this.session.close();
  }

  /**
   * Consume the stream for the current turn.
   * Buffers assistant text and calls onToolUse for tool calls.
   */
  private async consumeStream(): Promise<TurnResult> {
    const stream = this.session.stream();
    const turnOutput: string[] = [];
    let isError = false;

    for await (const message of stream) {
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
          if (block.type === "text" && block.text) {
            turnOutput.push(block.text);
          } else if (block.type === "tool_use" && block.name) {
            this.onToolUse?.(block.name, block.input ?? {});
          }
        }
      } else if (message.type === "result") {
        const resultMsg = message as {
          type: "result";
          result?: string;
          is_error?: boolean;
          subtype?: string;
        };
        if (resultMsg.is_error) {
          isError = true;
          if (resultMsg.result) {
            turnOutput.push(`[error] ${resultMsg.result}`);
          }
        } else if (resultMsg.result) {
          turnOutput.push(resultMsg.result);
        }
      }
    }

    return { output: turnOutput.join("\n") };
  }
}
