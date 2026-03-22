import { randomUUID } from "node:crypto";
import type WebSocket from "ws";
import type { Store } from "../store.js";
import type { Router } from "./router.js";
import type { ClientToGateway, GatewayRunStatus } from "./types.js";
import { isClientMessage } from "./types.js";

interface RunState {
  run_id: string;
  workflow: string;
  gateway_status: GatewayRunStatus;
  prompt?: string;
}

export class ClientHandler {
  private store: Store;
  private router: Router;
  private runs = new Map<string, RunState>();

  constructor(store: Store, router: Router) {
    this.store = store;
    this.router = router;
  }

  handleConnection(ws: WebSocket): void {
    const clientId = randomUUID();

    ws.on("message", (data) => {
      try {
        const raw = JSON.parse(data.toString());
        if (!isClientMessage(raw)) {
          this.sendError(ws, undefined, "Invalid message format");
          return;
        }
        this.handleMessage(clientId, ws, raw);
      } catch {
        this.sendError(ws, undefined, "Invalid JSON");
      }
    });

    ws.on("close", () => {
      this.router.removeClient(clientId);
    });
  }

  private handleMessage(clientId: string, ws: WebSocket, msg: ClientToGateway): void {
    switch (msg.type) {
      case "create_run":
        this.handleCreateRun(clientId, ws, msg);
        break;
      case "user_input":
        this.handleUserInput(msg);
        break;
      case "abort_run":
        this.handleAbortRun(msg);
        break;
      case "subscribe":
        this.handleSubscribe(clientId, ws, msg);
        break;
    }
  }

  private handleCreateRun(
    clientId: string,
    ws: WebSocket,
    msg: Extract<ClientToGateway, { type: "create_run" }>,
  ): void {
    const runId = msg.run_id ?? randomUUID();
    const runState: RunState = {
      run_id: runId,
      workflow: msg.workflow,
      gateway_status: "pending",
      prompt: msg.prompt,
    };
    this.runs.set(runId, runState);

    // Initialize in store
    this.store.initRun(runId, msg.workflow);
    this.store.updateGatewayInfo(runId, { client_id: clientId });

    // Subscribe client to this run
    this.router.subscribeClient(clientId, ws, runId);

    // Notify client
    this.send(ws, { type: "run_created", run_id: runId });

    // Try to assign to a daemon
    const daemonId = this.router.pickAvailableDaemon();
    if (daemonId) {
      runState.gateway_status = "waiting_daemon";
      this.router.assignRunToDaemon(runId, daemonId);
      this.store.updateGatewayInfo(runId, { daemon_id: daemonId });

      const daemonWs = this.router.getDaemon(daemonId)?.ws;
      if (daemonWs) {
        this.send(daemonWs, {
          type: "start_run",
          run_id: runId,
          workflow: msg.workflow,
          ...(msg.prompt && { prompt: msg.prompt }),
        });
        runState.gateway_status = "starting";
      }
    }
  }

  private handleUserInput(msg: Extract<ClientToGateway, { type: "user_input" }>): void {
    const daemonWs = this.router.getDaemonWsForRun(msg.run_id);
    if (daemonWs) {
      this.send(daemonWs, {
        type: "user_input",
        run_id: msg.run_id,
        input: msg.input,
      });
    }
  }

  private handleAbortRun(msg: Extract<ClientToGateway, { type: "abort_run" }>): void {
    const run = this.runs.get(msg.run_id);
    if (run) {
      run.gateway_status = "aborted";
    }
    const daemonWs = this.router.getDaemonWsForRun(msg.run_id);
    if (daemonWs) {
      this.send(daemonWs, { type: "abort_run", run_id: msg.run_id });
    }
  }

  private handleSubscribe(
    clientId: string,
    ws: WebSocket,
    msg: Extract<ClientToGateway, { type: "subscribe" }>,
  ): void {
    this.router.subscribeClient(clientId, ws, msg.run_id);
  }

  // --- REST support ---

  createRun(
    workflow: string,
    prompt?: string,
  ): { run_id: string; status: GatewayRunStatus } {
    const runId = randomUUID();
    const runState: RunState = {
      run_id: runId,
      workflow,
      gateway_status: "pending",
      prompt,
    };
    this.runs.set(runId, runState);
    this.store.initRun(runId, workflow);
    return { run_id: runId, status: "pending" };
  }

  listRuns(): Array<{
    run_id: string;
    workflow: string;
    gateway_status: GatewayRunStatus;
  }> {
    const result: Array<{
      run_id: string;
      workflow: string;
      gateway_status: GatewayRunStatus;
    }> = [];
    for (const run of this.runs.values()) {
      result.push({
        run_id: run.run_id,
        workflow: run.workflow,
        gateway_status: run.gateway_status,
      });
    }
    return result;
  }

  getRun(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  abortRun(runId: string): { run_id: string; status: GatewayRunStatus } | undefined {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    run.gateway_status = "aborted";
    return { run_id: runId, status: "aborted" };
  }

  // --- Helpers ---

  private send(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private sendError(ws: WebSocket, runId: string | undefined, message: string): void {
    this.send(ws, { type: "error", run_id: runId, message });
  }
}
