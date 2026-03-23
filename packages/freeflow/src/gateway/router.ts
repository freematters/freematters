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

  // --- Daemon management ---

  registerDaemon(daemonId: string, ws: WebSocket, capacity: number): void {
    this.daemons.set(daemonId, { ws, capacity, activeRuns: new Set() });
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
      this.daemons.delete(daemonId);
    }
  }

  findDaemonIdByWs(ws: WebSocket): string | undefined {
    for (const [id, info] of this.daemons) {
      if (info.ws === ws) return id;
    }
    return undefined;
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
    this.clients.set(clientId, { ws, subscribedRun: runId });
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  getClientsForRun(runId: string): WebSocket[] {
    const result: WebSocket[] = [];
    for (const info of this.clients.values()) {
      if (info.subscribedRun === runId) {
        result.push(info.ws);
      }
    }
    return result;
  }

  findClientIdByWs(ws: WebSocket): string | undefined {
    for (const [id, info] of this.clients) {
      if (info.ws === ws) return id;
    }
    return undefined;
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
