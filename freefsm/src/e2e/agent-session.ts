/**
 * AgentSession — wraps a Claude Agent SDK query() session for turn-based control.
 *
 * Provides runAgent/wait/send for the verifier to control an embedded agent
 * within a single continuous session (no session restarts).
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { loadFsm } from "../fsm.js";
import { formatStateCard, stateCardFromFsm } from "../output.js";
import { Store } from "../store.js";
import { createFsmMcpServer } from "../commands/run.js";

export interface AgentSessionOptions {
  fsmPath: string;
  root?: string;
  prompt?: string;
  model?: string;
  additionalMcpServers?: Record<string, McpServerConfig>;
}

export interface TurnResult {
  output: string;
  done: boolean;
}

/**
 * Manages a single Claude Agent SDK session for an embedded freefsm run.
 *
 * The session stays alive across multiple turns. The verifier controls
 * the pace by calling wait() and send().
 */
export class AgentSession {
  private session: ReturnType<typeof query> | undefined;
  private sessionId: string | undefined;
  private runId: string;
  private storeRoot: string;
  private pendingWait:
    | { resolve: (result: TurnResult) => void; reject: (err: Error) => void }
    | undefined;
  private turnOutput: string[] = [];
  private sessionDone = false;

  constructor(
    private options: AgentSessionOptions,
  ) {
    const name = options.fsmPath
      .replace(/^.*\//, "")
      .replace(/\.(fsm\.)?ya?ml$/i, "");
    this.runId = `${name}-${Date.now()}`;
    this.storeRoot = options.root ?? process.cwd();
  }

  getRunId(): string {
    return this.runId;
  }

  getStoreRoot(): string {
    return this.storeRoot;
  }

  /**
   * Start the agent session. Initializes the FSM store, creates the MCP server,
   * and launches the query() session. Begins consuming messages in the background.
   */
  async start(): Promise<void> {
    const fsm = loadFsm(this.options.fsmPath);

    const store = new Store(this.storeRoot);
    store.initRun(this.runId, this.options.fsmPath);
    store.commit(
      this.runId,
      {
        event: "start",
        from_state: null,
        to_state: fsm.initial,
        on_label: null,
        actor: "system",
        reason: null,
      },
      { run_status: "active", state: fsm.initial },
    );

    const fsmServer = createFsmMcpServer(fsm, store, this.runId);

    const card = stateCardFromFsm(fsm.initial, fsm.states[fsm.initial]);
    const stateCard = formatStateCard(card);
    const initialMessage = this.options.prompt
      ? `${stateCard}\n\n## User Prompt\n\n${this.options.prompt}`
      : stateCard;

    // Build system prompt from FSM guide
    const fsmName = fsm.guide ? fsm.guide.split(/[.\n]/)[0] : "workflow";
    const systemPrompt = `You are running the "${fsmName}" workflow.\n\n## FSM Guide\n\n${fsm.guide ?? "No guide provided."}`;

    const mcpServers: Record<string, McpServerConfig> = {
      freefsm: fsmServer,
      ...this.options.additionalMcpServers,
    };

    this.session = query({
      prompt: initialMessage,
      options: {
        systemPrompt,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        mcpServers,
        ...(this.options.model !== undefined && { model: this.options.model }),
      },
    });

    // Start consuming in the background
    this.consumeLoop();
  }

  /**
   * Wait for the current turn to complete (next result message).
   * Returns the accumulated assistant text and whether the session is done.
   */
  wait(timeout: number): Promise<TurnResult> {
    // If session already done, return immediately
    if (this.sessionDone) {
      const output = this.turnOutput.join("\n");
      this.turnOutput = [];
      return Promise.resolve({ output, done: true });
    }

    return new Promise<TurnResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWait = undefined;
        reject(new Error("timeout"));
      }, timeout);

      this.pendingWait = {
        resolve: (result: TurnResult) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
    });
  }

  /**
   * Send a message to resume the agent session.
   * The agent will process this as a new user message within the same session.
   */
  async send(text: string): Promise<void> {
    if (!this.session || this.sessionDone) {
      throw new Error("Session is not active");
    }

    const userMessage = {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: text,
      },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? "default",
    };

    await this.session.streamInput(
      (async function* () {
        yield userMessage;
      })(),
    );
  }

  /**
   * Background loop that consumes the async generator.
   * Buffers assistant text and signals turn completion on result messages.
   */
  private async consumeLoop(): Promise<void> {
    if (!this.session) return;

    try {
      // Use manual next() to avoid break/return which would close the generator
      while (true) {
        const { value, done } = await this.session.next();
        if (done) {
          this.sessionDone = true;
          this.signalTurnComplete(true);
          break;
        }

        const message = value as SDKMessage;

        // Capture session_id from first message
        if (!this.sessionId && "session_id" in message) {
          this.sessionId = (message as { session_id: string }).session_id;
        }

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
              this.turnOutput.push(block.text);
            }
          }
        }

        // Result message = turn complete
        if (message.type === "result") {
          this.signalTurnComplete(false);
        }
      }
    } catch (err: unknown) {
      this.sessionDone = true;
      const msg = err instanceof Error ? err.message : String(err);
      this.turnOutput.push(`[agent error] ${msg}`);
      this.signalTurnComplete(true);
    }
  }

  private signalTurnComplete(done: boolean): void {
    if (this.pendingWait) {
      const output = this.turnOutput.join("\n");
      this.turnOutput = [];
      const waiter = this.pendingWait;
      this.pendingWait = undefined;
      waiter.resolve({ output, done });
    }
  }
}
