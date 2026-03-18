/**
 * AgentSession — wraps a Claude Agent SDK V2 session for multi-turn control.
 *
 * Starts a generic Claude Code session (not FSM-specific).
 * The verifier controls the agent via send() and wait().
 */

import { unstable_v2_createSession } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKSession } from "@anthropic-ai/claude-agent-sdk";

export interface AgentSessionOptions {
  model?: string;
  disallowedTools?: string[];
}

export interface TurnResult {
  output: string;
}

export class AgentSession {
  private session: SDKSession;

  constructor(options: AgentSessionOptions = {}) {
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

  /** Send a message to start a new turn. Call wait() after to get the response. */
  async send(text: string): Promise<void> {
    await this.session.send(text);
  }

  /** Wait for the current turn to complete. Returns accumulated assistant text. */
  async wait(timeout: number): Promise<TurnResult> {
    const stream = this.session.stream();
    const turnOutput: string[] = [];

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("timeout")), timeout);
    });

    const consumePromise = (async () => {
      for await (const message of stream) {
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
      }
    })();

    try {
      await Promise.race([consumePromise, timeoutPromise]);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "timeout") {
        return { output: turnOutput.join("\n") };
      }
      throw err;
    }

    return { output: turnOutput.join("\n") };
  }

  getSessionId(): string {
    return this.session.sessionId;
  }

  close(): void {
    this.session.close();
  }
}
