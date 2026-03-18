/**
 * MessageBus — turn-based communication between embedded agent and verifier.
 *
 * Flow:
 *   1. Embedded agent's query() session runs, produces assistant output
 *   2. Session ends → completeTurn() flushes buffered output as turn_complete
 *   3. Verifier receives turn_complete via waitForMessage()
 *   4. Verifier sends a response via post() → embedded agent's next session uses it as prompt
 *   5. Repeat until verifier decides it's done (based on test plan, not agent lifecycle)
 */

export interface TurnComplete {
  type: "turn_complete";
  output: string;
}

export class MessageBus {
  // Outbound: embedded → verifier
  private outboundQueue: TurnComplete[] = [];
  private outboundWaiter:
    | { resolve: (msg: TurnComplete) => void; reject: (err: Error) => void }
    | undefined;

  // Inbound: verifier → embedded (next prompt)
  private inboundQueue: string[] = [];
  private inboundWaiter:
    | { resolve: (text: string) => void; reject: (err: Error) => void }
    | undefined;

  // Buffer for assistant output within a turn
  private turnOutput: string[] = [];

  // ── Embedded agent side ──

  /** Append output text to the current turn's buffer. */
  appendOutput(text: string): void {
    this.turnOutput.push(text);
  }

  /** Flush buffered output as a turn_complete event. */
  completeTurn(): void {
    const output = this.turnOutput.join("\n");
    this.turnOutput = [];
    const msg: TurnComplete = { type: "turn_complete", output };
    if (this.outboundWaiter) {
      const waiter = this.outboundWaiter;
      this.outboundWaiter = undefined;
      waiter.resolve(msg);
    } else {
      this.outboundQueue.push(msg);
    }
  }

  /**
   * Wait for the verifier to send the next prompt.
   * Called by runCore's retry loop. Rejects on timeout.
   */
  waitForPrompt(timeout: number): Promise<string> {
    if (this.inboundQueue.length > 0) {
      return Promise.resolve(this.inboundQueue.shift()!);
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inboundWaiter = undefined;
        reject(new Error("timeout"));
      }, timeout);

      this.inboundWaiter = {
        resolve: (text: string) => {
          clearTimeout(timer);
          resolve(text);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  // ── Verifier side ──

  /** Wait for the next turn_complete. Rejects on timeout. */
  waitForMessage(timeout: number): Promise<TurnComplete> {
    const next = this.outboundQueue.shift();
    if (next) {
      return Promise.resolve(next);
    }

    return new Promise<TurnComplete>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.outboundWaiter = undefined;
        reject(new Error("timeout"));
      }, timeout);

      this.outboundWaiter = {
        resolve: (msg: TurnComplete) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  /** Send a message to the embedded agent as its next prompt. */
  post(text: string): void {
    if (this.inboundWaiter) {
      const waiter = this.inboundWaiter;
      this.inboundWaiter = undefined;
      waiter.resolve(text);
    } else {
      this.inboundQueue.push(text);
    }
  }
}
