const HEARTBEAT_TIMEOUT_MS = 30000;

export type StatusChangeCallback = (token: string | null, online: boolean) => void;

interface HeartbeatEntry {
  timestamp: number;
  tokens: Set<string>;
}

export class SessionTracker {
  private activePolls: Set<string>;
  private heartbeats: Map<string, HeartbeatEntry>;
  private onStatusChange: StatusChangeCallback | null;

  constructor() {
    this.activePolls = new Set();
    this.heartbeats = new Map();
    this.onStatusChange = null;
  }

  setOnStatusChange(callback: StatusChangeCallback): void {
    this.onStatusChange = callback;
  }

  recordPoll(token: string): void {
    this.activePolls.add(token);
    if (this.onStatusChange) {
      this.onStatusChange(token, true);
    }
  }

  removePoll(token: string): void {
    this.activePolls.delete(token);
    if (this.onStatusChange) {
      this.onStatusChange(token, this.isAgentOnline(token));
    }
  }

  recordHeartbeat(sessionId: string, tokens?: string[]): void {
    const entry = this.heartbeats.get(sessionId);
    const tokenSet = entry ? entry.tokens : new Set<string>();
    if (tokens) {
      for (const t of tokens) {
        tokenSet.add(t);
      }
    }
    this.heartbeats.set(sessionId, { timestamp: Date.now(), tokens: tokenSet });
    if (this.onStatusChange) {
      this.onStatusChange(null, true);
    }
  }

  isAgentOnline(token?: string): boolean {
    if (token !== undefined) {
      if (this.activePolls.has(token)) {
        return true;
      }
    } else {
      if (this.activePolls.size > 0) {
        return true;
      }
    }

    const now = Date.now();
    for (const [, entry] of this.heartbeats) {
      if (now - entry.timestamp < HEARTBEAT_TIMEOUT_MS) {
        if (token === undefined || entry.tokens.size === 0 || entry.tokens.has(token)) {
          return true;
        }
      }
    }

    return false;
  }
}
