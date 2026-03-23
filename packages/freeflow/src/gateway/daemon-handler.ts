import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { Router } from "./router.js";
import type { DaemonToGateway, GatewayToClient } from "./types.js";
import { isDaemonMessage } from "./types.js";

export class DaemonHandler {
  private router: Router;

  /** Callback invoked when a run completes, allowing ClientHandler to update state. */
  onRunCompleted?: (runId: string, status: string) => void;

  /** Callback invoked when a new daemon registers, allowing pending runs to be dispatched. */
  onDaemonRegistered?: () => void;

  constructor(router: Router) {
    this.router = router;
  }

  handleConnection(ws: WebSocket): void {
    ws.on("message", (data) => {
      try {
        const raw = JSON.parse(data.toString());
        if (!isDaemonMessage(raw)) {
          this.send(ws, { type: "error", message: "Invalid message format" });
          return;
        }
        this.handleMessage(ws, raw);
      } catch {
        this.send(ws, { type: "error", message: "Invalid JSON" });
      }
    });

    ws.on("close", () => {
      const daemonId = this.router.findDaemonIdByWs(ws);
      if (daemonId) {
        this.router.removeDaemon(daemonId);
      }
    });
  }

  private handleMessage(ws: WebSocket, msg: DaemonToGateway): void {
    if (msg.type === "register") {
      this.handleRegister(ws, msg);
      return;
    }

    // All non-register messages have run_id
    const runId = msg.run_id;
    switch (msg.type) {
      case "agent_ready":
        this.forwardToClients(runId, {
          type: "run_started",
          run_id: runId,
          state: "initial",
        });
        break;
      case "agent_output":
        this.forwardToClients(runId, msg);
        break;
      case "state_changed":
        this.forwardToClients(runId, msg);
        break;
      case "run_completed":
        this.forwardToClients(runId, msg);
        this.router.clearBuffer(runId);
        this.onRunCompleted?.(runId, msg.status);
        break;
      case "error":
        this.forwardToClients(runId, {
          type: "error",
          run_id: runId,
          message: msg.message,
        });
        break;
    }
  }

  private handleRegister(
    ws: WebSocket,
    msg: Extract<DaemonToGateway, { type: "register" }>,
  ): void {
    const daemonId = `daemon-${randomUUID().slice(0, 8)}`;
    this.router.registerDaemon(daemonId, ws, msg.capacity);
    this.send(ws, { type: "registered", daemon_id: daemonId });
    this.onDaemonRegistered?.();
  }

  private forwardToClients(runId: string, msg: GatewayToClient): void {
    // Buffer the message for replay on reconnect
    this.router.bufferMessage(runId, msg);

    const clients = this.router.getClientsForRun(runId);
    for (const clientWs of clients) {
      this.send(clientWs, msg);
    }
  }

  private send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
