import fs from "node:fs";
import type http from "node:http";
import { WebSocket, WebSocketServer as WsServer } from "ws";
import { computeDiff } from "./diff.js";
import type { ConnectedUser } from "./presence.js";
import type { TokenStore } from "./token-store.js";

export interface WsMessage {
  type: string;
  payload: unknown;
}

interface FileSubscription {
  token: string;
  author: string | null;
  ws: WebSocket;
}

export class WebSocketServer {
  private wss: WsServer;
  private subscriptions: FileSubscription[];
  private tokenStore: TokenStore;
  private versions: Map<string, number>;
  private lastContent: Map<string, string>;

  constructor(httpServer: http.Server, tokenStore: TokenStore) {
    this.tokenStore = tokenStore;
    this.subscriptions = [];
    this.versions = new Map();
    this.lastContent = new Map();

    this.wss = new WsServer({ server: httpServer });
    this.wss.on("connection", (ws: WebSocket) => {
      this.handleConnection(ws);
    });
  }

  private handleConnection(ws: WebSocket): void {
    ws.on("message", (data: Buffer) => {
      try {
        const msg: WsMessage = JSON.parse(data.toString());
        this.handleMessage(ws, msg);
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      this.subscriptions = this.subscriptions.filter((s) => s.ws !== ws);
    });
  }

  private handleMessage(ws: WebSocket, msg: WsMessage): void {
    switch (msg.type) {
      case "file:subscribe":
        this.handleSubscribe(ws, msg.payload as { token: string; author?: string });
        break;
    }
  }

  private handleSubscribe(
    ws: WebSocket,
    payload: { token: string; author?: string },
  ): void {
    const entry = this.tokenStore.resolve(payload.token);
    if (!entry) return;

    this.subscriptions.push({
      token: payload.token,
      author: payload.author ?? null,
      ws,
    });

    try {
      const content = fs.readFileSync(entry.filePath, "utf-8");
      this.lastContent.set(payload.token, content);
      const version = this.getVersion(payload.token);
      const response: WsMessage = {
        type: "file:content",
        payload: { content, version },
      };
      ws.send(JSON.stringify(response));
    } catch {
      // file read error
    }
  }

  notifySaved(token: string, by: string): void {
    const version = this.incrementVersion(token);
    const msg: WsMessage = {
      type: "file:saved",
      payload: { by, version },
    };
    const data = JSON.stringify(msg);

    for (const s of this.subscriptions) {
      if (s.token === token && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    }
  }

  broadcastAgentStatus(token: string, online: boolean): void {
    const msg: WsMessage = {
      type: "agent:status",
      payload: { online },
    };
    const data = JSON.stringify(msg);

    for (const s of this.subscriptions) {
      if (s.token === token && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    }
  }

  broadcastPresence(token: string, users: ConnectedUser[]): void {
    const msg: WsMessage = {
      type: "presence:update",
      payload: { users },
    };
    const data = JSON.stringify(msg);

    for (const s of this.subscriptions) {
      if (s.token === token && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    }
  }

  notifyFileChanged(
    token: string,
    content: string,
    newComments: unknown[],
    by: string,
  ): void {
    const version = this.incrementVersion(token);
    const oldContent = this.lastContent.get(token) ?? "";
    const diff = computeDiff(oldContent, content);
    this.lastContent.set(token, content);
    const msg: WsMessage = {
      type: "file:changed",
      payload: { diff, newComments, version, by },
    };
    const data = JSON.stringify(msg);

    for (const s of this.subscriptions) {
      if (s.token === token && s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(data);
      }
    }
  }

  private getVersion(token: string): number {
    return this.versions.get(token) ?? 0;
  }

  private incrementVersion(token: string): number {
    const current = this.getVersion(token);
    const next = current + 1;
    this.versions.set(token, next);
    return next;
  }

  close(): void {
    this.wss.close();
  }
}
