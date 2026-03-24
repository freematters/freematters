const HEARTBEAT_TIMEOUT_MS = 30000;
const OFFLINE_DELAY_MS = 10000;

export type StatusChangeCallback = (token: string | null, online: boolean) => void;

interface HeartbeatEntry {
  timestamp: number;
  tokens: Set<string>;
}

export class SessionTracker {
  private activePolls: Set<string>;
  private heartbeats: Map<string, HeartbeatEntry>;
  private onStatusChange: StatusChangeCallback | null;
  private offlineTimers: Map<string, ReturnType<typeof setTimeout>>;

  constructor() {
    this.activePolls = new Set();
    this.heartbeats = new Map();
    this.onStatusChange = null;
    this.offlineTimers = new Map();
  }

  setOnStatusChange(callback: StatusChangeCallback): void {
    this.onStatusChange = callback;
  }

  recordPoll(token: string): void {
    const existing = this.offlineTimers.get(token);
    if (existing) {
      clearTimeout(existing);
      this.offlineTimers.delete(token);
    }
    this.activePolls.add(token);
    if (this.onStatusChange) {
      this.onStatusChange(token, true);
    }
  }

  removePoll(token: string): void {
    this.activePolls.delete(token);
    if (!this.isAgentOnline(token)) {
      const timer = setTimeout(() => {
        this.offlineTimers.delete(token);
        if (this.onStatusChange && !this.isAgentOnline(token)) {
          this.onStatusChange(token, false);
        }
      }, OFFLINE_DELAY_MS);
      this.offlineTimers.set(token, timer);
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
