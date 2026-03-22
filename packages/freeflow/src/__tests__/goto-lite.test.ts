/**
 * Tests for Step 3: Lite-aware goto command.
 *
 * Design Test 3: Lite card on re-entry
 * Design Test 4: Non-lite run ignores visited states
 * Design Test 8: fflow current always returns full card (verify current.ts unchanged)
 * Unit tests: first-visit full card, re-visit lite card, JSON mode full prompt
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Store } from "../store.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import {
  MULTI_FSM,
  cleanupTempDir,
  createTempDir,
  gotoEvent,
  startEvent,
  startSnapshot,
} from "./fixtures.js";

let tmp: string;
let fsmMulti: string;

beforeAll(() => {
  tmp = createTempDir("goto-lite");
  fsmMulti = join(tmp, "multi.yaml");
  writeFileSync(fsmMulti, MULTI_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "run"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Helper: set up a lite run at a given state with visited_states pre-populated.
 * Creates the run via store directly (not CLI) so we can control visited_states.
 */
function setupLiteRun(
  root: string,
  runId: string,
  currentState: string,
  visitedStates: string[],
): Store {
  const store = new Store(root);
  store.initRun(runId, fsmMulti);
  store.updateMeta(runId, { lite: true });
  store.commit(runId, startEvent(currentState), {
    run_status: "active",
    state: currentState,
    visited_states: visitedStates,
  });
  return store;
}

/**
 * Helper: set up a non-lite run at a given state.
 */
function setupNonLiteRun(
  root: string,
  runId: string,
  currentState: string,
  visitedStates: string[],
): Store {
  const store = new Store(root);
  store.initRun(runId, fsmMulti);
  // No lite flag
  store.commit(runId, startEvent(currentState), {
    run_status: "active",
    state: currentState,
    visited_states: visitedStates,
  });
  return store;
}

// ─── Lite mode: first visit outputs full card ─────────────────────

describe("goto lite mode — first visit", () => {
  test("outputs full card and adds state to visited_states", () => {
    const root = join(tmp, "first-visit-root");
    const id = uniqueRunId("first-visit");
    // Start at "start" with only "start" visited
    setupLiteRun(root, id, "start", ["start"]);

    // goto review (first visit to review)
    const { stdout, exitCode } = runCli(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(exitCode).toBe(0);
    // Should output full card (contains "Your instructions:" and the prompt)
    expect(stdout).toContain("You are in **review** state.");
    expect(stdout).toContain("Review the work.");
    expect(stdout).toContain("approved → done");

    // Verify snapshot has updated visited_states
    const store = new Store(root);
    const snapshot = store.readSnapshot(id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.visited_states).toContain("start");
    expect(snapshot?.visited_states).toContain("review");
  });
});

// ─── Lite mode: re-visited state outputs lite card ──────────────

describe("goto lite mode — re-visited state", () => {
  test("Design Test 3: outputs lite card on re-entry", () => {
    const root = join(tmp, "revisit-root");
    const id = uniqueRunId("revisit");
    // Start at "review" with both "start" and "review" already visited
    setupLiteRun(root, id, "review", ["start", "review"]);

    // goto start (re-visit via "rejected" transition)
    const { stdout, exitCode } = runCli(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(exitCode).toBe(0);
    // Should output lite card: has Re-entering, no prompt
    expect(stdout).toContain("Re-entering **start**");
    expect(stdout).toContain("fflow current");
    expect(stdout).toContain("ready → review");
    // Should NOT contain the prompt text
    expect(stdout).not.toContain("Your instructions:");
    expect(stdout).not.toContain("Begin work.");
  });
});

// ─── Non-lite run: always full card ──────────────────────────────

describe("goto non-lite mode", () => {
  test("Design Test 4: non-lite run ignores visited states — full card always", () => {
    const root = join(tmp, "nonlite-root");
    const id = uniqueRunId("nonlite");
    // Start at "review" with "start" already visited, but NOT lite mode
    setupNonLiteRun(root, id, "review", ["start", "review"]);

    // goto start (re-visit, but non-lite)
    const { stdout, exitCode } = runCli(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(exitCode).toBe(0);
    // Should output full card even though state was visited
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin work.");
    expect(stdout).not.toContain("Re-entering");
  });
});

// ─── JSON mode: always includes full prompt ──────────────────────

describe("goto lite mode — JSON output", () => {
  test("JSON mode always includes full prompt regardless of lite", () => {
    const root = join(tmp, "json-root");
    const id = uniqueRunId("json-lite");
    // Start at "review" with "start" already visited, lite mode
    setupLiteRun(root, id, "review", ["start", "review"]);

    // goto start in JSON mode (re-visit in lite mode)
    const { envelope, exitCode } = runCliJson(
      `goto start --run-id ${id} --on rejected`,
      {
        root,
      },
    );
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as Record<string, unknown>;
    // JSON output always has full prompt
    expect(data.prompt).toBe("Begin work.");
    expect(data.state).toBe("start");
    expect(data.transitions).toEqual({ ready: "review" });
  });
});

// ─── Design Test 8: fflow current always returns full card ───────

describe("fflow current — always full card", () => {
  test("Design Test 8: current returns full card even in lite mode with visited state", () => {
    const root = join(tmp, "current-root");
    const id = uniqueRunId("current-lite");
    // Start at "start" with "start" already visited, lite mode
    setupLiteRun(root, id, "start", ["start"]);

    // current should always return full card
    const { stdout, exitCode } = runCli(`current --run-id ${id}`, {
      root,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin work.");
    expect(stdout).not.toContain("Re-entering");
  });
});
