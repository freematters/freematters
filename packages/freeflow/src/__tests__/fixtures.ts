/**
 * Shared test fixtures for freeflow tests.
 *
 * Consolidates FSM YAML constants, temp directory helpers, Store setup,
 * and event builders used across multiple test files.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, SnapshotInput } from "../store.js";
import { Store } from "../store.js";

// ─── FSM YAML Constants ─────────────────────────────────────────

/** 2-state: start → done */
export const MINIMAL_FSM = `
version: 1
guide: "Minimal workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

/** 3-state: start → middle → done */
export const LINEAR_3STATE_FSM = `
version: 1
guide: "Three-state workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: middle
  middle:
    prompt: "Middle step."
    transitions:
      finish: done
  done:
    prompt: "Finished."
    transitions: {}
`;

/** 3-state with back-transition and todos: start ↔ review → done */
export const MULTI_FSM = `
version: 1
guide: "Multi-state workflow"
initial: start
states:
  start:
    prompt: "Begin work."
    todos:
      - "Draft spec"
      - "Review spec"
    transitions:
      ready: review
  review:
    prompt: "Review the work."
    transitions:
      approved: done
      rejected: start
  done:
    prompt: "All done."
    transitions: {}
`;

/** 3-state planning workflow with todos: plan → execute → done */
export const PLANNING_FSM = `
version: 1
guide: "Test workflow"
initial: plan
states:
  plan:
    prompt: "Plan the work."
    todos:
      - "Write spec"
    transitions:
      approved: execute
  execute:
    prompt: "Do the work."
    transitions:
      complete: done
  done:
    prompt: "Finished."
    transitions: {}
`;

// ─── Temp Directory Helpers ──────────────────────────────────────

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `freeflow-${prefix}-`));
}

export function cleanupTempDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** Write a YAML string to a file in the temp dir. Returns the file path. */
export function writeFsmFile(tmpDir: string, name: string, content: string): string {
  const p = join(tmpDir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

// ─── Store Setup Helpers ─────────────────────────────────────────

let storeCounter = 0;

/** Create a fresh Store with a unique root dir under tmpDir. */
export function freshStore(tmpDir: string): Store {
  storeCounter++;
  return new Store(join(tmpDir, `root-${storeCounter}`));
}

/** Reset the store counter (call in beforeAll if needed). */
export function resetStoreCounter(): void {
  storeCounter = 0;
}

// ─── Event Builders ──────────────────────────────────────────────

export function startEvent(toState: string): EventInput {
  return {
    event: "start",
    from_state: null,
    to_state: toState,
    on_label: null,
    actor: "system",
    reason: null,
  };
}

export function startSnapshot(state: string): SnapshotInput {
  return { run_status: "active", state };
}

export function gotoEvent(from: string, to: string, label: string): EventInput {
  return {
    event: "goto",
    from_state: from,
    to_state: to,
    on_label: label,
    actor: "agent",
    reason: null,
  };
}

export function gotoSnapshot(state: string): SnapshotInput {
  return { run_status: "active", state };
}

/**
 * Initialize a run and commit a start event.
 * Returns the Store instance.
 */
export function setupRun(
  root: string,
  runId: string,
  fsmPath: string,
  initialState = "start",
): Store {
  const store = new Store(root);
  store.initRun(runId, fsmPath);
  store.commit(runId, startEvent(initialState), startSnapshot(initialState));
  return store;
}

/**
 * Initialize a run, commit a start event, and bind a session.
 * Returns the Store instance.
 */
export function setupActiveRun(
  root: string,
  runId: string,
  fsmPath: string,
  sessionId: string,
  initialState = "start",
): Store {
  const store = setupRun(root, runId, fsmPath, initialState);
  store.bindSession(sessionId, runId);
  return store;
}
