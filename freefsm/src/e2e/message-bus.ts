/**
 * MessageBus — communication channel between the embedded agent and verifier.
 *
 * The embedded agent appends output and signals turn boundaries.
 * The verifier waits for events (turn_complete, input_request, exited)
 * and resolves input requests.
 *
 * Individual output (assistant text, tool calls) is buffered and only
 * delivered as part of turn_complete, input_request, or exited events.
 */

export type BusEvent =
  | { type: "turn_complete"; output: string }
  | { type: "input_request"; prompt: string; output: string }
  | { type: "exited"; code: number; output: string };

export class MessageBus {
  private eventQueue: BusEvent[] = [];
  private pendingWaiter:
    | { resolve: (event: BusEvent) => void; reject: (err: Error) => void }
    | undefined;
  private pendingInputResolver: ((text: string) => void) | undefined;
  private accumulatedOutput: string[] = [];

  /**
   * Append output text to the buffer. No event is pushed —
   * the text will be included in the next turn_complete, input_request,
   * or exited event.
   */
  appendOutput(text: string): void {
    this.accumulatedOutput.push(text);
  }

  /**
   * Signal that the embedded agent finished a turn.
   * Pushes a turn_complete event with all accumulated output.
   */
  enqueueTurnComplete(): void {
    const output = this.drainAccumulatedOutput();
    this.pushEvent({ type: "turn_complete", output });
  }

  /**
   * Enqueue an input request from the embedded agent.
   * Returns a Promise that resolves when the verifier calls resolveInput().
   * Pushes an input_request event with all accumulated output.
   */
  enqueueInputRequest(prompt: string): Promise<string> {
    const output = this.drainAccumulatedOutput();
    this.pushEvent({ type: "input_request", prompt, output });

    return new Promise<string>((resolve) => {
      this.pendingInputResolver = resolve;
    });
  }

  /**
   * Wait for the next event from the embedded agent.
   * Blocks (with timeout) until an event is available.
   * Rejects with an error if the timeout expires.
   */
  waitForEvent(timeout: number): Promise<BusEvent> {
    // If there's already an event in the queue, return it immediately
    const next = this.eventQueue.shift();
    if (next) {
      return Promise.resolve(next);
    }

    // Otherwise, wait for the next event
    return new Promise<BusEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWaiter = undefined;
        reject(new Error("timeout"));
      }, timeout);

      this.pendingWaiter = {
        resolve: (event: BusEvent) => {
          clearTimeout(timer);
          resolve(event);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  /**
   * Resolve a pending input request with the given text.
   * Throws if no input request is pending.
   */
  resolveInput(text: string): void {
    if (!this.pendingInputResolver) {
      throw new Error("No input request pending");
    }
    const resolver = this.pendingInputResolver;
    this.pendingInputResolver = undefined;
    resolver(text);
  }

  /**
   * Mark the embedded agent as exited.
   * Pushes an exited event with all accumulated output.
   */
  markExited(code: number): void {
    const output = this.drainAccumulatedOutput();
    this.pushEvent({ type: "exited", code, output });
  }

  private pushEvent(event: BusEvent): void {
    if (this.pendingWaiter) {
      const waiter = this.pendingWaiter;
      this.pendingWaiter = undefined;
      waiter.resolve(event);
    } else {
      this.eventQueue.push(event);
    }
  }

  private drainAccumulatedOutput(): string {
    const output = this.accumulatedOutput.join("\n");
    this.accumulatedOutput = [];
    return output;
  }
}
