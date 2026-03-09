import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// --- Types ---

export type RunStatus = "active" | "completed" | "aborted";
export type EventType = "start" | "goto" | "finish";
export type Actor = "agent" | "human" | "system";

export interface RunMeta {
  run_id: string;
  fsm_path: string;
  created_at: string;
  version: number;
  session_id?: string;
}

export interface StoreEvent {
  seq: number;
  ts: string;
  run_id: string;
  event: EventType;
  from_state: string | null;
  to_state: string | null;
  on_label: string | null;
  actor: Actor;
  reason: string | null;
  metadata: Record<string, unknown> | null;
}

export interface Snapshot {
  run_id: string;
  run_status: RunStatus;
  state: string;
  last_seq: number;
  updated_at: string;
}

export interface EventInput {
  event: EventType;
  from_state: string | null;
  to_state: string | null;
  on_label: string | null;
  actor: Actor;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface SnapshotInput {
  run_status: RunStatus;
  state: string;
}

// --- Helpers ---

function nowISO(): string {
  return new Date().toISOString();
}

const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 5000;

// --- Store ---

export class Store {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  private runDir(runId: string): string {
    return join(this.root, "runs", runId);
  }

  private metaPath(runId: string): string {
    return join(this.runDir(runId), "fsm.meta.json");
  }

  private eventsPath(runId: string): string {
    return join(this.runDir(runId), "events.jsonl");
  }

  private snapshotPath(runId: string): string {
    return join(this.runDir(runId), "snapshot.json");
  }

  private lockPath(runId: string): string {
    return join(this.runDir(runId), "lock");
  }

  private sessionsDir(): string {
    return join(this.root, "sessions");
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionsDir(), `${sessionId}.json`);
  }

  private counterPath(sessionId: string): string {
    return join(this.sessionsDir(), `${sessionId}.counter`);
  }

  // --- Locking ---

  private acquireLock(runId: string): void {
    const lockDir = this.lockPath(runId);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (true) {
      try {
        mkdirSync(lockDir);
        return; // acquired
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
        if (Date.now() >= deadline) {
          throw new Error(`Failed to acquire lock for run "${runId}" (timeout)`);
        }
        // Spin-wait
        const start = Date.now();
        while (Date.now() - start < LOCK_RETRY_MS) {
          // busy wait
        }
      }
    }
  }

  private releaseLock(runId: string): void {
    try {
      rmdirSync(this.lockPath(runId));
    } catch {
      // ignore — lock dir may have been cleaned up
    }
  }

  // --- Public API ---

  initRun(runId: string, fsmPath: string): RunMeta {
    const dir = this.runDir(runId);
    if (existsSync(dir)) {
      throw new Error(`Run "${runId}" already exists`);
    }
    mkdirSync(dir, { recursive: true });

    const meta: RunMeta = {
      run_id: runId,
      fsm_path: fsmPath,
      created_at: nowISO(),
      version: 1,
    };
    writeFileSync(this.metaPath(runId), JSON.stringify(meta, null, 2), "utf-8");
    return meta;
  }

  runExists(runId: string): boolean {
    return existsSync(this.runDir(runId));
  }

  readMeta(runId: string): RunMeta {
    const p = this.metaPath(runId);
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as RunMeta;
  }

  updateMeta(runId: string, updates: Partial<RunMeta>): void {
    const meta = this.readMeta(runId);
    Object.assign(meta, updates);
    writeFileSync(this.metaPath(runId), JSON.stringify(meta, null, 2), "utf-8");
  }

  readSnapshot(runId: string): Snapshot | null {
    const p = this.snapshotPath(runId);
    if (!existsSync(p)) {
      return null;
    }
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as Snapshot;
  }

  readEvents(runId: string): StoreEvent[] {
    const p = this.eventsPath(runId);
    if (!existsSync(p)) {
      return [];
    }
    const raw = readFileSync(p, "utf-8").trim();
    if (raw.length === 0) {
      return [];
    }
    return raw.split("\n").map((line) => JSON.parse(line) as StoreEvent);
  }

  withLock<T>(runId: string, fn: () => T): T {
    this.acquireLock(runId);
    try {
      return fn();
    } finally {
      this.releaseLock(runId);
    }
  }

  commit(
    runId: string,
    eventInput: EventInput,
    snapshotInput: SnapshotInput,
    options?: { lockHeld?: boolean },
  ): { event: StoreEvent; snapshot: Snapshot } {
    const skipLock = options?.lockHeld === true;
    if (!skipLock) this.acquireLock(runId);
    try {
      // Read current seq from snapshot (or 0 if first event)
      const currentSnap = this.readSnapshot(runId);
      const lastSeq = currentSnap?.last_seq ?? 0;
      const now = nowISO();

      // Build event
      const event: StoreEvent = {
        seq: lastSeq + 1,
        ts: now,
        run_id: runId,
        event: eventInput.event,
        from_state: eventInput.from_state,
        to_state: eventInput.to_state,
        on_label: eventInput.on_label,
        actor: eventInput.actor,
        reason: eventInput.reason,
        metadata: eventInput.metadata ?? null,
      };

      // Append event
      appendFileSync(this.eventsPath(runId), `${JSON.stringify(event)}\n`, "utf-8");

      // Write snapshot
      const snapshot: Snapshot = {
        run_id: runId,
        run_status: snapshotInput.run_status,
        state: snapshotInput.state,
        last_seq: event.seq,
        updated_at: now,
      };
      writeFileSync(
        this.snapshotPath(runId),
        JSON.stringify(snapshot, null, 2),
        "utf-8",
      );

      return { event, snapshot };
    } finally {
      if (!skipLock) this.releaseLock(runId);
    }
  }

  // --- Session Management ---

  bindSession(sessionId: string, runId: string): void {
    const dir = this.sessionsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      this.sessionPath(sessionId),
      JSON.stringify({ run_id: runId }),
      "utf-8",
    );
  }

  readSession(sessionId: string): string | null {
    const p = this.sessionPath(sessionId);
    if (!existsSync(p)) return null;
    const raw = readFileSync(p, "utf-8");
    const data = JSON.parse(raw) as { run_id: string };
    return data.run_id;
  }

  unbindSession(sessionId: string): void {
    const sp = this.sessionPath(sessionId);
    if (existsSync(sp)) unlinkSync(sp);
    const cp = this.counterPath(sessionId);
    if (existsSync(cp)) unlinkSync(cp);
  }

  readCounter(sessionId: string): number {
    const p = this.counterPath(sessionId);
    if (!existsSync(p)) return 0;
    const raw = readFileSync(p, "utf-8").trim();
    return Number.parseInt(raw, 10) || 0;
  }

  writeCounter(sessionId: string, value: number): void {
    const dir = this.sessionsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.counterPath(sessionId), String(value), "utf-8");
  }
}
