import { EventEmitter } from "node:events";
import WebSocket from "ws";
import type { ClientToGateway, GatewayToClient } from "./types.js";

export interface GatewayCliClientOptions {
  gatewayUrl: string;
  apiKey?: string;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

type GatewayEventMap = {
  run_created: [Extract<GatewayToClient, { type: "run_created" }>];
  run_started: [Extract<GatewayToClient, { type: "run_started" }>];
  agent_output: [Extract<GatewayToClient, { type: "agent_output" }>];
  user_input: [Extract<GatewayToClient, { type: "user_input" }>];
  state_changed: [Extract<GatewayToClient, { type: "state_changed" }>];
  run_completed: [Extract<GatewayToClient, { type: "run_completed" }>];
  error: [Extract<GatewayToClient, { type: "error" }>];
  close: [];
};

/**
 * WebSocket client for connecting to fflow Gateway from the CLI.
 *
 * Connects to `/ws/client`, sends `create_run` / `user_input` / `abort_run`
 * messages, and emits typed events for incoming `GatewayToClient` messages.
 *
 * Handles reconnection on unexpected disconnect.
 */
export class GatewayCliClient extends EventEmitter<GatewayEventMap> {
  private ws: WebSocket | null = null;
  private readonly opts: Required<GatewayCliClientOptions>;
  private reconnectAttempts = 0;
  private closed = false;

  constructor(opts: GatewayCliClientOptions) {
    super();
    this.opts = {
      gatewayUrl: opts.gatewayUrl,
      apiKey: opts.apiKey ?? "",
      reconnectDelayMs: opts.reconnectDelayMs ?? 1000,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
    };
  }

  /** Connect to the Gateway WebSocket endpoint. */
  connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const url = `${this.opts.gatewayUrl}/ws/client`;
      const headers: Record<string, string> = {};
      if (this.opts.apiKey) {
        headers["x-api-key"] = this.opts.apiKey;
      }

      const ws = new WebSocket(url, { headers });

      ws.on("open", () => {
        this.ws = ws;
        this.reconnectAttempts = 0;
        this.setupHandlers(ws);
        resolve();
      });

      ws.on("error", (err) => {
        if (!this.ws) {
          // Connection failed — check for auth errors
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("401")) {
            reject(new Error("Authentication failed: Missing API key"));
          } else if (message.includes("403")) {
            reject(new Error("Authentication failed: Invalid API key"));
          } else {
            reject(err);
          }
        }
      });
    });
  }

  /** Send a create_run message. */
  createRun(workflow: string, runId?: string, prompt?: string): void {
    const msg: ClientToGateway = {
      type: "create_run",
      workflow,
      ...(runId !== undefined && { run_id: runId }),
      ...(prompt !== undefined && { prompt }),
    };
    this.send(msg);
  }

  /** Send a user_input message. */
  sendInput(runId: string, input: string): void {
    const msg: ClientToGateway = {
      type: "user_input",
      run_id: runId,
      input,
    };
    this.send(msg);
  }

  /** Send a subscribe message to attach to an existing run. */
  subscribe(runId: string): void {
    const msg: ClientToGateway = {
      type: "subscribe",
      run_id: runId,
    };
    this.send(msg);
  }

  /** Send an abort_run message. */
  abortRun(runId: string): void {
    const msg: ClientToGateway = {
      type: "abort_run",
      run_id: runId,
    };
    this.send(msg);
  }

  /** Close the connection (no reconnect). */
  close(): void {
    this.closed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private send(msg: ClientToGateway): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private setupHandlers(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as GatewayToClient;
        this.emit(msg.type, msg as never);
      } catch {
        // ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (!this.closed) {
        this.attemptReconnect();
      } else {
        this.emit("close");
      }
    });

    ws.on("error", () => {
      // Error events are followed by close, reconnect is handled there
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      this.emit("close");
      return;
    }

    this.reconnectAttempts++;
    setTimeout(() => {
      if (this.closed) return;
      this.connect().catch(() => {
        // Retry will be triggered by close handler
      });
    }, this.opts.reconnectDelayMs);
  }
}
