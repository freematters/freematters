/**
 * AgentSession — wraps the Claude Agent SDK V2 session for multi-turn control.
 *
 * Uses unstable_v2_createSession which provides:
 *   send(message) — send a user message
 *   stream()      — get an async generator of messages for the current turn
 *   close()       — end the session
 */

import {
  unstable_v2_createSession,
} from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKSession } from "@anthropic-ai/claude-agent-sdk";

export interface AgentSessionOptions {
  prompt?: string;
  model?: string;
  disallowedTools?: string[];
}

export interface TurnResult {
  output: string;
  done: boolean;
}

/**
 * Manages a Claude Agent SDK V2 session for an embedded agent.
 *
 * The session persists across multiple turns. The verifier controls
 * the pace by calling wait() and send().
 */
export class AgentSession {
  private session: SDKSession;
  private currentStream: AsyncGenerator<SDKMessage, void> | undefined;

  constructor(options: AgentSessionOptions) {
    this.session = unstable_v2_createSession({
      model: options.model ?? "claude-sonnet-4-6",
      permissionMode: "bypassPermissions",
      disallowedTools: options.disallowedTools ?? [
        "AskUserQuestion",
        "ExitPlanMode",
        "EnterPlanMode",
      ],
    });
  }

  /**
   * Send a message and start a new turn.
   * Call wait() after this to get the agent's response.
   */
  async send(text: string): Promise<void> {
    await this.session.send(text);
  }

  /**
   * Wait for the current turn to complete.
   * Consumes the stream until a result message or the generator finishes.
   * Returns accumulated assistant text.
   */
  async wait(timeout: number): Promise<TurnResult> {
    const stream = this.session.stream();
    this.currentStream = stream;

    const turnOutput: string[] = [];
    let done = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), timeout);
    });

    try {
      const consumePromise = (async () => {
        for await (const message of stream) {
          // Buffer assistant text
          if (message.type === "assistant") {
            const msg = message as {
              type: "assistant";
              message: {
                content: Array<{ type: string; text?: string }>;
              };
            };
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text) {
                turnOutput.push(block.text);
              }
            }
          }

          // Result = turn complete
          if (message.type === "result") {
            const resultMsg = message as {
              type: "result";
              subtype: string;
            };
            // The stream will end after result, but we don't need to break
            // The for-await will naturally complete
          }
        }
      })();

      await Promise.race([consumePromise, timeoutPromise]);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "timeout") {
        return { output: turnOutput.join("\n"), done: false };
      }
      throw err;
    }

    return { output: turnOutput.join("\n"), done };
  }

  /** Get the session ID. */
  getSessionId(): string {
    return this.session.sessionId;
  }

  /** Close the session. */
  close(): void {
    this.session.close();
  }
}
