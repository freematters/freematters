/**
 * MessageBus — communication channel between the embedded agent and verifier.
 *
 * The embedded agent enqueues output and input requests.
 * The verifier waits for events and resolves input requests.
 */

export type BusEvent =
  | { type: "output"; text: string }
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
   * Enqueue an output event from the embedded agent.
   * Output text is also accumulated for inclusion in subsequent
   * input_request and exited events.
   */
  enqueueOutput(text: string): void {
    this.accumulatedOutput.push(text);
    this.pushEvent({ type: "output", text });
  }

  /**
   * Enqueue an input request from the embedded agent.
   * Returns a Promise that resolves when the verifier calls resolveInput().
   * Also pushes an input_request event to the event queue.
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
      this.consumeAccumulated(next);
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
          this.consumeAccumulated(event);
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
   * Pushes an exited event with the accumulated output.
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

  /**
   * When an output event is consumed via waitForEvent, remove its text
   * from the accumulator so it doesn't appear again in input_request/exited.
   */
  private consumeAccumulated(event: BusEvent): void {
    if (event.type === "output") {
      const idx = this.accumulatedOutput.indexOf(event.text);
      if (idx !== -1) {
        this.accumulatedOutput.splice(idx, 1);
      }
    }
  }

  private drainAccumulatedOutput(): string {
    const output = this.accumulatedOutput.join("\n");
    this.accumulatedOutput = [];
    return output;
  }
}
