/**
 * MultiTurnSession — bridges send() calls with a v1 query() async generator.
 *
 * Keeps a single query() session alive across multiple turns by using a
 * message queue that feeds an async generator input stream.
 *
 * Usage:
 *   const session = new MultiTurnSession(options);
 *   session.send("hello");
 *   for await (const msg of session.stream()) { ... } // breaks on "result"
 *   session.send("follow up");
 *   for await (const msg of session.stream()) { ... } // next turn
 */

import { type SDKMessage, query } from "@anthropic-ai/claude-agent-sdk";

export class MultiTurnSession {
  private messageQueue: string[] = [];
  private waitForMessage: { resolve: (value: string) => void } | null = null;
  private queryInstance: ReturnType<typeof query> | null = null;
  private iterator: AsyncIterator<SDKMessage> | null = null;

  constructor(private queryOptions: Record<string, unknown> = {}) {}

  /**
   * Queue a user message. Resolves immediately — the generator
   * picks it up when stream() is iterated.
   */
  send(text: string): void {
    if (this.waitForMessage) {
      const waiter = this.waitForMessage;
      this.waitForMessage = null;
      waiter.resolve(text);
    } else {
      this.messageQueue.push(text);
    }
  }

  /**
   * Yield SDK messages for the current turn. Creates the query() session
   * on first call. Breaks after a "result" message (turn complete).
   *
   * Uses a manually-driven iterator to avoid `for await` calling return()
   * on break, which would close the underlying query session.
   */
  async *stream(): AsyncGenerator<SDKMessage> {
    if (!this.queryInstance) {
      const self = this;

      async function* inputStream() {
        while (true) {
          const text = await self.nextMessage();
          yield {
            type: "user" as const,
            session_id: "",
            message: {
              role: "user" as const,
              content: [{ type: "text" as const, text }],
            },
            parent_tool_use_id: null,
          };
        }
      }

      this.queryInstance = query({
        prompt: inputStream(),
        options: this.queryOptions,
      });
      this.iterator = this.queryInstance[Symbol.asyncIterator]();
    }

    if (!this.iterator) return;

    while (true) {
      const { value, done } = await this.iterator.next();
      if (done) return;
      yield value;
      if (value.type === "result") {
        return;
      }
    }
  }

  close(): void {
    this.queryInstance?.close();
  }

  private nextMessage(): Promise<string> {
    const text = this.messageQueue.shift();
    if (text !== undefined) {
      return Promise.resolve(text);
    }

    return new Promise<string>((resolve) => {
      this.waitForMessage = { resolve };
    });
  }
}
