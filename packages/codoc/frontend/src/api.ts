export interface FileData {
  content: string;
  filePath: string;
  readonly: boolean;
  readonlyToken?: string;
}

export interface WsMessage {
  type: string;
  payload: unknown;
}

export async function fetchFile(token: string): Promise<FileData> {
  const res = await fetch(`/api/file/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch file: ${res.status}`);
  }
  return res.json();
}

export interface SaveResult {
  ok: boolean;
  conflict: boolean;
  conflictContent: string | null;
}

export async function saveFile(
  token: string,
  content: string,
  baseContent?: string,
): Promise<SaveResult> {
  const body: Record<string, string> = { content };
  if (baseContent !== undefined) {
    body.baseContent = baseContent;
  }
  const res = await fetch(`/api/file/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) {
    const data = await res.json();
    return { ok: false, conflict: true, conflictContent: data.content ?? null };
  }
  if (!res.ok) {
    throw new Error(`Failed to save file: ${res.status}`);
  }
  return { ok: true, conflict: false, conflictContent: null };
}

export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}`;
  return new WebSocket(wsUrl);
}

export function sendWsMessage(ws: WebSocket, type: string, payload: unknown): void {
  ws.send(JSON.stringify({ type, payload }));
}

export interface BlameEntry {
  lineStart: number;
  lineEnd: number;
  author: string;
  hash: string;
  isAgent: boolean;
}

export interface LogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export async function fetchBlame(token: string): Promise<BlameEntry[]> {
  const res = await fetch(`/api/blame/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch blame: ${res.status}`);
  }
  return res.json();
}

export async function fetchHistory(token: string): Promise<LogEntry[]> {
  const res = await fetch(`/api/history/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch history: ${res.status}`);
  }
  return res.json();
}

export async function fetchHistoryContent(
  token: string,
  hash: string,
): Promise<string> {
  const res = await fetch(`/api/history/${token}/${hash}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch history content: ${res.status}`);
  }
  const data = await res.json();
  return data.content;
}

export async function revertToCommit(
  token: string,
  hash: string,
): Promise<{ content: string }> {
  const res = await fetch(`/api/revert/${token}/${hash}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Failed to revert: ${res.status}`);
  }
  return res.json();
}

export async function mergeThreeWay(
  base: string,
  ours: string,
  theirs: string,
): Promise<{ content: string; conflict: boolean }> {
  const res = await fetch("/api/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base, ours, theirs }),
  });
  if (!res.ok) {
    throw new Error(`Merge failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchAgentStatus(
  token: string,
): Promise<{ agentOnline: boolean }> {
  const res = await fetch(`/api/status/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch agent status: ${res.status}`);
  }
  return res.json();
}

export interface PresenceUser {
  author: string;
  mode: "write" | "read";
  connectedAt: number;
  lastActivity: number;
}

export async function fetchPresence(token: string): Promise<PresenceUser[]> {
  const res = await fetch(`/api/presence/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch presence: ${res.status}`);
  }
  const data = await res.json();
  return data.users;
}

export async function joinPresence(
  token: string,
  author: string,
  mode: "write" | "read",
): Promise<string> {
  const res = await fetch(`/api/presence/${token}/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ author, mode }),
  });
  if (!res.ok) {
    throw new Error(`Failed to join presence: ${res.status}`);
  }
  const data = await res.json();
  return data.sessionId;
}

export async function leavePresence(token: string, sessionId: string): Promise<void> {
  const res = await fetch(`/api/presence/${token}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to leave presence: ${res.status}`);
  }
}

export async function heartbeatPresence(
  token: string,
  sessionId: string,
): Promise<void> {
  const res = await fetch(`/api/presence/${token}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to heartbeat presence: ${res.status}`);
  }
}

export interface DiffData {
  original: string;
  modified: string;
  diff: string;
}

export async function fetchDiff(token: string): Promise<DiffData> {
  const res = await fetch(`/api/diff/${token}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch diff: ${res.status}`);
  }
  return res.json();
}
