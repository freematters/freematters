import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseComments } from "./comment-parser.js";
import { computeDiff } from "./diff.js";
import type { FileWatcher } from "./file-watcher.js";
import type { SessionTracker } from "./session-tracker.js";
import type { TokenStore } from "./token-store.js";

export interface IpcRequest {
  method:
    | "share"
    | "poll"
    | "status"
    | "stop"
    | "heartbeat"
    | "session-start"
    | "session-end";
  params: Record<string, unknown>;
}

export interface IpcResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface PendingPoll {
  token: string;
  socket: net.Socket;
  originalContent: string;
  presenceSessionId: string | null;
}

export class IpcServer {
  private server: net.Server | null;
  private socketPath: string;
  private tokenStore: TokenStore;
  private httpPort: number;
  private onStopCallback: (() => void) | null;
  private onShareCallback:
    | ((params: Record<string, unknown>, result: IpcResponse) => Promise<void>)
    | null;
  private fileWatcher: FileWatcher | null;
  private sessionTracker: SessionTracker | null;
  private pendingPolls: PendingPoll[];
  private tunnelUrl: string | null;
  private activeSessions: Set<string>;
  private presenceLeaveCallback: ((sessionId: string) => void) | null;

  constructor(socketPath: string, tokenStore: TokenStore, httpPort: number) {
    this.server = null;
    this.socketPath = socketPath;
    this.tokenStore = tokenStore;
    this.httpPort = httpPort;
    this.onStopCallback = null;
    this.onShareCallback = null;
    this.fileWatcher = null;
    this.sessionTracker = null;
    this.pendingPolls = [];
    this.tunnelUrl = null;
    this.activeSessions = new Set();
    this.presenceLeaveCallback = null;
  }

  setPresenceLeave(callback: (sessionId: string) => void): void {
    this.presenceLeaveCallback = callback;
  }

  setHttpPort(port: number): void {
    this.httpPort = port;
  }

  setFileWatcher(fileWatcher: FileWatcher): void {
    this.fileWatcher = fileWatcher;
  }

  setSessionTracker(sessionTracker: SessionTracker): void {
    this.sessionTracker = sessionTracker;
  }

  setTunnelUrl(tunnelUrl: string | null): void {
    this.tunnelUrl = tunnelUrl;
  }

  onStop(callback: () => void): void {
    this.onStopCallback = callback;
  }

  setOnShare(
    callback: (params: Record<string, unknown>, result: IpcResponse) => Promise<void>,
  ): void {
    this.onShareCallback = callback;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket: net.Socket) => {
        let buffer = "";
        socket.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (line.trim().length === 0) continue;
            try {
              const request: IpcRequest = JSON.parse(line);
              this.handleRequest(request, socket);
            } catch (err: unknown) {
              const e = err as Error;
              const errorResponse: IpcResponse = { ok: false, error: e.message };
              socket.write(`${JSON.stringify(errorResponse)}\n`);
            }
          }
        });

        socket.on("close", () => {
          this.cleanupPollsForSocket(socket);
        });

        socket.on("error", () => {
          this.cleanupPollsForSocket(socket);
        });
      });

      this.server.on("error", (err: NodeJS.ErrnoException) => {
        reject(err);
      });

      const dir = path.dirname(this.socketPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.server.listen(this.socketPath, () => {
        resolve();
      });
    });
  }

  private handleRequest(request: IpcRequest, socket: net.Socket): void {
    switch (request.method) {
      case "share": {
        const response = this.handleShare(request.params);
        if (this.onShareCallback) {
          this.onShareCallback(request.params, response)
            .then(() => {
              socket.write(`${JSON.stringify(response)}\n`);
            })
            .catch(() => {
              socket.write(`${JSON.stringify(response)}\n`);
            });
        } else {
          socket.write(`${JSON.stringify(response)}\n`);
        }
        break;
      }
      case "poll": {
        this.handlePoll(request.params, socket);
        break;
      }
      case "status": {
        const response = this.handleStatus();
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
      case "stop": {
        const response = this.handleStop();
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
      case "heartbeat": {
        const response = this.handleHeartbeat(request.params);
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
      case "session-start": {
        const response = this.handleSessionStart(request.params);
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
      case "session-end": {
        const response = this.handleSessionEnd(request.params);
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
      default: {
        const response: IpcResponse = {
          ok: false,
          error: `Unknown method: ${request.method}`,
        };
        socket.write(`${JSON.stringify(response)}\n`);
        break;
      }
    }
  }

  private handleShare(params: Record<string, unknown>): IpcResponse {
    const filePath = params.filePath;
    if (!filePath || typeof filePath !== "string") {
      return { ok: false, error: "Missing filePath parameter" };
    }
    if (!path.isAbsolute(filePath)) {
      return { ok: false, error: `filePath must be absolute: ${filePath}` };
    }
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: `File not found: ${filePath}` };
    }
    try {
      fs.accessSync(filePath, fs.constants.W_OK);
    } catch {
      return {
        ok: false,
        error: `File not writable: ${filePath} (read-only filesystem?)`,
      };
    }
    const readonly = params.readonly === true;
    const result = this.tokenStore.register(filePath, readonly);
    const baseUrl = this.tunnelUrl ?? `http://127.0.0.1:${this.httpPort}`;
    const url = `${baseUrl}/edit/${result.token}`;
    const data: Record<string, unknown> = { token: result.token, url };
    if (result.readonlyToken) {
      data.readonlyToken = result.readonlyToken;
      data.readonlyUrl = `${baseUrl}/view/${result.readonlyToken}`;
    }
    return { ok: true, data };
  }

  private handlePoll(params: Record<string, unknown>, socket: net.Socket): void {
    const token = params.token as string;
    if (!token) {
      const response: IpcResponse = { ok: false, error: "Missing token parameter" };
      socket.write(`${JSON.stringify(response)}\n`);
      return;
    }

    const entry = this.tokenStore.resolve(token);
    if (!entry) {
      const response: IpcResponse = { ok: false, error: `Token not found: ${token}` };
      socket.write(`${JSON.stringify(response)}\n`);
      return;
    }

    let originalContent: string;
    try {
      originalContent = fs.readFileSync(entry.filePath, "utf-8");
    } catch (err: unknown) {
      const e = err as Error;
      const response: IpcResponse = {
        ok: false,
        error: `Cannot read file: ${e.message}`,
      };
      socket.write(`${JSON.stringify(response)}\n`);
      return;
    }

    if (this.sessionTracker) {
      this.sessionTracker.recordPoll(token);
    }

    const presenceSessionId = (params.presenceSessionId as string) ?? null;
    const pendingPoll: PendingPoll = {
      token,
      socket,
      originalContent,
      presenceSessionId,
    };
    this.pendingPolls.push(pendingPoll);

    if (this.fileWatcher) {
      this.fileWatcher.addOneTimeListener(
        entry.filePath,
        (_filePath: string, newContent: string) => {
          this.resolvePoll(pendingPoll, newContent);
        },
      );
    }
  }

  private resolvePoll(pendingPoll: PendingPoll, newContent: string): void {
    const idx = this.pendingPolls.indexOf(pendingPoll);
    if (idx === -1) return;

    this.pendingPolls.splice(idx, 1);

    if (this.sessionTracker) {
      this.sessionTracker.removePoll(pendingPoll.token);
    }
    if (pendingPoll.presenceSessionId && this.presenceLeaveCallback) {
      this.presenceLeaveCallback(pendingPoll.presenceSessionId);
    }

    const diff = computeDiff(pendingPoll.originalContent, newContent);
    const newComments = parseComments(newContent);

    const response: IpcResponse = {
      ok: true,
      data: { diff, newComments },
    };

    try {
      pendingPoll.socket.write(`${JSON.stringify(response)}\n`);
    } catch {
      // socket already closed
    }
  }

  private cleanupPollsForSocket(socket: net.Socket): void {
    const toRemove = this.pendingPolls.filter((p) => p.socket === socket);
    for (const poll of toRemove) {
      const idx = this.pendingPolls.indexOf(poll);
      if (idx !== -1) {
        this.pendingPolls.splice(idx, 1);
      }
      if (this.sessionTracker) {
        this.sessionTracker.removePoll(poll.token);
      }
      if (poll.presenceSessionId && this.presenceLeaveCallback) {
        this.presenceLeaveCallback(poll.presenceSessionId);
      }
    }
  }

  private handleStatus(): IpcResponse {
    const files = this.tokenStore.list().map((entry) => ({
      token: entry.token,
      path: entry.filePath,
    }));
    return { ok: true, data: { files, port: this.httpPort } };
  }

  private handleStop(): IpcResponse {
    if (this.onStopCallback) {
      setImmediate(() => {
        this.onStopCallback?.();
      });
    }
    return { ok: true, data: { message: "Server stopping" } };
  }

  private handleSessionStart(params: Record<string, unknown>): IpcResponse {
    const sessionId = params.sessionId as string;
    if (!sessionId) {
      return { ok: false, error: "Missing sessionId parameter" };
    }
    this.activeSessions.add(sessionId);
    return { ok: true, data: { sessions: this.activeSessions.size } };
  }

  private handleSessionEnd(params: Record<string, unknown>): IpcResponse {
    const sessionId = params.sessionId as string;
    if (!sessionId) {
      return { ok: false, error: "Missing sessionId parameter" };
    }
    this.activeSessions.delete(sessionId);
    const remaining = this.activeSessions.size;
    if (remaining === 0) {
      if (this.onStopCallback) {
        setImmediate(() => {
          this.onStopCallback?.();
        });
      }
      return { ok: true, data: { sessions: 0, stopping: true } };
    }
    return { ok: true, data: { sessions: remaining, stopping: false } };
  }

  private handleHeartbeat(params: Record<string, unknown>): IpcResponse {
    const sessionId = params.sessionId as string;
    if (!sessionId) {
      return { ok: false, error: "Missing sessionId parameter" };
    }
    const tokens = Array.isArray(params.tokens)
      ? (params.tokens as string[])
      : undefined;
    if (this.sessionTracker) {
      this.sessionTracker.recordHeartbeat(sessionId, tokens);
    }
    return { ok: true, data: { message: "heartbeat recorded" } };
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const poll of this.pendingPolls) {
        if (this.sessionTracker) {
          this.sessionTracker.removePoll(poll.token);
        }
        try {
          poll.socket.destroy();
        } catch {
          // ignore
        }
      }
      this.pendingPolls = [];

      if (this.server) {
        this.server.close(() => {
          this.cleanupSocket();
          resolve();
        });
      } else {
        this.cleanupSocket();
        resolve();
      }
    });
  }

  private cleanupSocket(): void {
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Socket already removed
    }
  }
}

export class IpcClient {
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  send(request: IpcRequest): Promise<IpcResponse> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath, () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });

      let buffer = "";
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try {
            const response: IpcResponse = JSON.parse(line);
            socket.end();
            resolve(response);
          } catch (err: unknown) {
            const e = err as Error;
            socket.end();
            reject(e);
          }
          return;
        }
      });

      socket.on("error", (err: Error) => {
        reject(err);
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("IPC request timed out"));
      });
    });
  }
}
