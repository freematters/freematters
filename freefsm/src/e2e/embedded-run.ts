/**
 * EmbeddedRun — wraps `freefsm run` for embedded (in-process) execution.
 *
 * Creates a MessageBus and Store, then calls the shared runCore logic
 * as an async background task. The verifier interacts with the embedded
 * agent through the MessageBus.
 */

import { generateRunId, runCore } from "../commands/run.js";
import { MessageBus } from "./message-bus.js";

export interface EmbeddedRunOptions {
  runId?: string;
  root?: string;
  prompt?: string;
  model?: string;
  logFn?: (msg: string, color?: string) => void;
}

export class EmbeddedRun {
  private fsmPath: string;
  private options: EmbeddedRunOptions;
  private bus: MessageBus;
  private runId: string;
  private storeRoot: string;

  constructor(fsmPath: string, options: EmbeddedRunOptions = {}) {
    this.fsmPath = fsmPath;
    this.options = options;
    this.bus = new MessageBus();
    this.storeRoot = options.root ?? process.cwd();
    this.runId = options.runId ?? generateRunId(fsmPath);
  }

  /**
   * Launch the Agent SDK session in the background.
   * The session runs asynchronously; use getBus() to observe events.
   */
  async start(): Promise<void> {
    // Suppress logging in embedded mode unless a logFn is provided
    const logFn = this.options.logFn ?? (() => {});

    // Run the agent loop in the background — don't await it.
    // When it finishes, mark the bus as exited.
    runCore({
      fsmPath: this.fsmPath,
      runId: this.runId,
      root: this.storeRoot,
      prompt: this.options.prompt,
      model: this.options.model,
      bus: this.bus,
      logFn,
    })
      .then((result) => {
        this.bus.markExited(result.isError ? 1 : 0);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.bus.appendOutput(`[embedded error] ${msg}`);
        this.bus.markExited(1);
      });
  }

  /**
   * Get the MessageBus for interacting with the embedded agent.
   */
  getBus(): MessageBus {
    return this.bus;
  }

  /**
   * Get the run ID. Available immediately after construction.
   */
  getRunId(): string {
    return this.runId;
  }

  /**
   * Get the store root path for post-hoc inspection.
   */
  getStoreRoot(): string {
    return this.storeRoot;
  }
}
