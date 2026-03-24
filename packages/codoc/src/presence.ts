import crypto from "node:crypto";

const HEARTBEAT_TIMEOUT_MS = 60000;
const CLEANUP_INTERVAL_MS = 15000;

export interface ConnectedUser {
  author: string;
  mode: "write" | "read";
  connectedAt: number;
  lastActivity: number;
}

interface SessionEntry {
  sessionId: string;
  token: string;
  author: string;
  mode: "write" | "read";
  connectedAt: number;
  lastActivity: number;
}

export type PresenceChangeCallback = (token: string) => void;

export class PresenceTracker {
  private sessions: Map<string, SessionEntry>;
  private cleanupTimer: ReturnType<typeof setInterval> | null;
  private onChangeCallback: PresenceChangeCallback | null;

  constructor() {
    this.sessions = new Map();
    this.cleanupTimer = null;
    this.onChangeCallback = null;
  }

  setOnChange(callback: PresenceChangeCallback): void {
    this.onChangeCallback = callback;
  }

  startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  join(token: string, author: string, mode: "write" | "read"): string {
    const sessionId = crypto.randomBytes(16).toString("hex");
    const now = Date.now();
    this.sessions.set(sessionId, {
      sessionId,
      token,
      author,
      mode,
      connectedAt: now,
      lastActivity: now,
    });
    if (this.onChangeCallback) {
      this.onChangeCallback(token);
    }
    return sessionId;
  }

  leave(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const token = entry.token;
    this.sessions.delete(sessionId);
    if (this.onChangeCallback) {
      this.onChangeCallback(token);
    }
  }

  heartbeat(sessionId: string): boolean {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    entry.lastActivity = Date.now();
    return true;
  }

  getUsers(token: string): ConnectedUser[] {
    const now = Date.now();
    const users: ConnectedUser[] = [];
    for (const entry of this.sessions.values()) {
      if (entry.token === token && now - entry.lastActivity < HEARTBEAT_TIMEOUT_MS) {
        users.push({
          author: entry.author,
          mode: entry.mode,
          connectedAt: entry.connectedAt,
          lastActivity: entry.lastActivity,
        });
      }
    }
    return users;
  }

  private cleanup(): void {
    const now = Date.now();
    const tokensToNotify = new Set<string>();
    for (const [sessionId, entry] of this.sessions) {
      if (now - entry.lastActivity >= HEARTBEAT_TIMEOUT_MS) {
        tokensToNotify.add(entry.token);
        this.sessions.delete(sessionId);
      }
    }
    if (this.onChangeCallback) {
      for (const token of tokensToNotify) {
        this.onChangeCallback(token);
      }
    }
  }
}
