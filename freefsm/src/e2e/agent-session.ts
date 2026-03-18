/**
 * AgentSession — wraps a Claude Agent SDK v1 query() for multi-turn control.
 *
 * Uses an AsyncIterable as the prompt source, allowing us to push
 * follow-up messages into the same session without restarting.
 *
 * Flow:
 *   1. send(text) pushes a user message into the input queue
 *   2. query() consumes it and produces assistant messages
 *   3. wait() blocks until a result message (turn complete)
 *   4. send(text) pushes another message → next turn
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export interface AgentSessionOptions {
  model?: string;
  disallowedTools?: string[];
  /** Called for each tool use during a turn. */
  onToolUse?: (name: string, input: Record<string, unknown>) => void;
}

export interface TurnResult {
  output: string;
}

/**
 * A controllable async iterable that allows pushing messages on demand.
 * The query() session consumes from this — it stays alive as long as
 * we don't call end().
 */
class InputQueue {
  private queue: SDKUserMessage[] = [];
  private waiter: ((msg: SDKUserMessage) => void) | undefined;
  private done = false;

  push(msg: SDKUserMessage): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = undefined;
      w(msg);
    } else {
      this.queue.push(msg);
    }
  }

  end(): void {
    this.done = true;
    // If someone is waiting, they'll get undefined on next check
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage, void> {
    while (!this.done) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        const msg = await new Promise<SDKUserMessage>((resolve) => {
          this.waiter = resolve;
        });
        yield msg;
      }
    }
  }
}

export class AgentSession {
  private inputQueue: InputQueue;
  private onToolUse?: (name: string, input: Record<string, unknown>) => void;
  private sessionObj: ReturnType<typeof query> | undefined;
  private options: AgentSessionOptions;

  // Turn synchronization
  private turnOutput: string[] = [];
  private turnResolve: ((result: TurnResult) => void) | undefined;
  private turnReject: ((err: Error) => void) | undefined;
  private consumeDone = false;
  private consumeError: Error | undefined;

  constructor(options: AgentSessionOptions = {}) {
    this.options = options;
    this.onToolUse = options.onToolUse;
    this.inputQueue = new InputQueue();
  }

  /**
   * Send a message to the agent. On first call, starts the query() session.
   * On subsequent calls, pushes a follow-up message into the same session.
   */
  async send(text: string): Promise<void> {
    const userMsg: SDKUserMessage = {
      type: "user",
      message: {
        role: "user",
        content: text,
      },
      parent_tool_use_id: null,
      session_id: "embedded",
    };

    // Reset turn output for the new turn
    this.turnOutput = [];

    this.inputQueue.push(userMsg);

    if (!this.sessionObj) {
      // First send — start the query session
      this.sessionObj = query({
        prompt: this.inputQueue,
        options: {
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          ...(this.options.model !== undefined && { model: this.options.model }),
        },
      });

      // Start consuming in the background
      this.consumeLoop();
    }
  }

  /**
   * Wait for the current turn to complete (next result message).
   * Returns accumulated assistant text from this turn.
   */
  wait(timeout: number): Promise<TurnResult> {
    if (this.consumeError) {
      const err = this.consumeError;
      this.consumeError = undefined;
      return Promise.reject(err);
    }

    if (this.consumeDone) {
      const output = this.turnOutput.join("\n");
      this.turnOutput = [];
      return Promise.resolve({ output });
    }

    return new Promise<TurnResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.turnResolve = undefined;
        this.turnReject = undefined;
        const output = this.turnOutput.join("\n");
        this.turnOutput = [];
        resolve({ output: output || "[timeout]" });
      }, timeout);

      this.turnResolve = (result: TurnResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      this.turnReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  close(): void {
    this.inputQueue.end();
    this.sessionObj?.close();
  }

  /**
   * Background loop consuming the query() async generator.
   * Buffers assistant text per turn, signals turn completion on result messages.
   */
  private async consumeLoop(): Promise<void> {
    if (!this.sessionObj) return;

    try {
      for await (const message of this.sessionObj) {
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
              this.turnOutput.push(block.text);
            } else if (block.type === "tool_use" && block.name) {
              this.onToolUse?.(block.name, block.input ?? {});
            }
          }
        } else if (message.type === "result") {
          const resultMsg = message as {
            type: "result";
            result?: string;
            is_error?: boolean;
          };
          if (resultMsg.is_error && resultMsg.result) {
            this.turnOutput.push(`[error] ${resultMsg.result}`);
          }
          // Signal turn complete
          if (this.turnResolve) {
            const output = this.turnOutput.join("\n");
            this.turnOutput = [];
            const resolver = this.turnResolve;
            this.turnResolve = undefined;
            resolver({ output });
          }
        }
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.consumeDone = true;
      if (this.turnReject) {
        const rejector = this.turnReject;
        this.turnResolve = undefined;
        this.turnReject = undefined;
        rejector(error);
      } else {
        // No one waiting yet — store for next wait() call
        this.consumeError = error;
      }
      return;
    }

    this.consumeDone = true;
    // If someone is waiting, resolve with whatever we have
    if (this.turnResolve) {
      const output = this.turnOutput.join("\n");
      this.turnOutput = [];
      const resolver = this.turnResolve;
      this.turnResolve = undefined;
      this.turnReject = undefined;
      resolver({ output });
    }
  }
}
