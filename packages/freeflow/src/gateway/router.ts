import type WebSocket from "ws";
import type { GatewayToClient } from "./types.js";

interface DaemonInfo {
  ws: WebSocket;
  capacity: number;
  activeRuns: Set<string>;
}

interface ClientInfo {
  ws: WebSocket;
  subscribedRun?: string;
}

export class Router {
  private daemons = new Map<string, DaemonInfo>();
  private clients = new Map<string, ClientInfo>();
  private runToDaemon = new Map<string, string>();
  private outputBuffers = new Map<string, GatewayToClient[]>();

  /** Reverse index: WebSocket → daemonId for O(1) lookup. */
  private wsToDaemon = new Map<WebSocket, string>();
  /** Reverse index: WebSocket → clientId for O(1) lookup. */
  private wsToClient = new Map<WebSocket, string>();
  /** Reverse index: runId → Set of clientIds for O(1) lookup. */
  private runToClients = new Map<string, Set<string>>();

  // --- Daemon management ---

  registerDaemon(daemonId: string, ws: WebSocket, capacity: number): void {
    this.daemons.set(daemonId, { ws, capacity, activeRuns: new Set() });
    this.wsToDaemon.set(ws, daemonId);
  }

  getDaemon(daemonId: string): { ws: WebSocket; capacity: number } | undefined {
    const d = this.daemons.get(daemonId);
    if (!d) return undefined;
    return { ws: d.ws, capacity: d.capacity };
  }

  removeDaemon(daemonId: string): void {
    const d = this.daemons.get(daemonId);
    if (d) {
      for (const runId of d.activeRuns) {
        this.runToDaemon.delete(runId);
      }
      this.wsToDaemon.delete(d.ws);
      this.daemons.delete(daemonId);
    }
  }

  findDaemonIdByWs(ws: WebSocket): string | undefined {
    return this.wsToDaemon.get(ws);
  }

  // --- Run-Daemon mapping ---

  assignRunToDaemon(runId: string, daemonId: string): void {
    this.runToDaemon.set(runId, daemonId);
    const d = this.daemons.get(daemonId);
    if (d) d.activeRuns.add(runId);
  }

  getDaemonForRun(runId: string): string | undefined {
    return this.runToDaemon.get(runId);
  }

  getDaemonWsForRun(runId: string): WebSocket | undefined {
    const daemonId = this.runToDaemon.get(runId);
    if (!daemonId) return undefined;
    return this.daemons.get(daemonId)?.ws;
  }

  pickAvailableDaemon(): string | undefined {
    for (const [id, info] of this.daemons) {
      const available = info.capacity - info.activeRuns.size;
      if (available > 0) return id;
    }
    return undefined;
  }

  // --- Client management ---

  subscribeClient(clientId: string, ws: WebSocket, runId: string): void {
    const existing = this.clients.get(clientId);

    // Remove from previous run's reverse index if re-subscribing
    if (existing?.subscribedRun) {
      const prevClients = this.runToClients.get(existing.subscribedRun);
      if (prevClients) {
        prevClients.delete(clientId);
        if (prevClients.size === 0) {
          this.runToClients.delete(existing.subscribedRun);
        }
      }
    }

    this.clients.set(clientId, { ws, subscribedRun: runId });
    this.wsToClient.set(ws, clientId);

    // Add to run's reverse index
    let clientSet = this.runToClients.get(runId);
    if (!clientSet) {
      clientSet = new Set();
      this.runToClients.set(runId, clientSet);
    }
    clientSet.add(clientId);
  }

  removeClient(clientId: string): void {
    const info = this.clients.get(clientId);
    if (info) {
      // Remove from run reverse index
      if (info.subscribedRun) {
        const clientSet = this.runToClients.get(info.subscribedRun);
        if (clientSet) {
          clientSet.delete(clientId);
          if (clientSet.size === 0) {
            this.runToClients.delete(info.subscribedRun);
          }
        }
      }
      this.wsToClient.delete(info.ws);
    }
    this.clients.delete(clientId);
  }

  getClientsForRun(runId: string): WebSocket[] {
    const clientIds = this.runToClients.get(runId);
    if (!clientIds) return [];
    const result: WebSocket[] = [];
    for (const clientId of clientIds) {
      const info = this.clients.get(clientId);
      if (info) {
        result.push(info.ws);
      }
    }
    return result;
  }

  findClientIdByWs(ws: WebSocket): string | undefined {
    return this.wsToClient.get(ws);
  }

  // --- Output buffering ---

  /** Buffer a message for a run (used for replay on reconnect). */
  bufferMessage(runId: string, msg: GatewayToClient): void {
    let buffer = this.outputBuffers.get(runId);
    if (!buffer) {
      buffer = [];
      this.outputBuffers.set(runId, buffer);
    }
    buffer.push(msg);
  }

  /** Get buffered messages for a run. */
  getBufferedMessages(runId: string): GatewayToClient[] {
    return this.outputBuffers.get(runId) ?? [];
  }

  /** Clear the buffer for a run. */
  clearBuffer(runId: string): void {
    this.outputBuffers.delete(runId);
  }
}
