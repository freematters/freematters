/**
 * Step 5: Integration tests for lite mode.
 *
 * These tests verify that start, goto, store, and output work together
 * end-to-end through the actual CLI. They do NOT re-test what individual
 * step tests already cover.
 *
 * - Design Test 2: Visited states tracking on goto
 * - Full round-trip: start lite → goto B (full) → goto A (lite)
 * - Hook reminder: formatReminder omits prompt text
 * - Non-lite round-trip: all full cards
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RunMeta, Snapshot } from "../store.js";
import { Store } from "../store.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { MINIMAL_FSM, MULTI_FSM, cleanupTempDir, createTempDir } from "./fixtures.js";

let tmp: string;
let fsmMulti: string;
let fsmMinimal: string;

beforeAll(() => {
  tmp = createTempDir("lite-integ");
  fsmMulti = join(tmp, "multi.yaml");
  writeFileSync(fsmMulti, MULTI_FSM, "utf-8");
  fsmMinimal = join(tmp, "minimal.yaml");
  writeFileSync(fsmMinimal, MINIMAL_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "integ"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Design Test 1: Lite flag persistence ────────────────────────

describe("start --lite: lite flag persistence", () => {
  test("start with lite: true → meta has lite: true, initial snapshot has visited_states with initial state", () => {
    const id = uniqueRunId("lite-persist");
    const root = join(tmp, "root-persist");

    runCli(`start ${fsmMinimal} --run-id ${id} --lite`, { root });

    const store = new Store(root);
    const meta = store.readMeta(id) as RunMeta & { lite?: boolean };
    expect(meta.lite).toBe(true);

    const snap = store.readSnapshot(id) as Snapshot & { visited_states?: string[] };
    expect(snap).not.toBeNull();
    expect(snap.visited_states).toEqual(["start"]);
  });
});

// ─── Design Test 2: Visited states tracking on goto ──────────────

describe("Design Test 2: visited states tracking via CLI", () => {
  test("start --lite → goto review → snapshot has both states and full card output", () => {
    const root = join(tmp, "dt2-root");
    const id = uniqueRunId("dt2");

    // Start with --lite
    const startResult = runCli(`start ${fsmMulti} --run-id ${id} --lite`, {
      root,
    });
    expect(startResult.exitCode).toBe(0);

    // Goto review (first visit — should be full card)
    const gotoResult = runCli(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoResult.exitCode).toBe(0);
    // Full card should contain the prompt
    expect(gotoResult.stdout).toContain("You are in **review** state.");
    expect(gotoResult.stdout).toContain("Review the work.");
    expect(gotoResult.stdout).not.toContain("Re-entering");

    // Verify snapshot has visited_states = ["start", "review"]
    const store = new Store(root);
    const snapshot = store.readSnapshot(id);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.visited_states).toBeDefined();
    expect(snapshot?.visited_states).toContain("start");
    expect(snapshot?.visited_states).toContain("review");
    expect(snapshot?.visited_states).toHaveLength(2);
  });
});

// ─── Full round-trip: lite mode ──────────────────────────────────

describe("Full round-trip: lite mode", () => {
  test("start lite → goto B (full card) → goto A (lite card) → verify output differences", () => {
    const root = join(tmp, "roundtrip-root");
    const id = uniqueRunId("roundtrip");

    // 1. Start with --lite at "start" state
    const startResult = runCli(`start ${fsmMulti} --run-id ${id} --lite`, {
      root,
    });
    expect(startResult.exitCode).toBe(0);
    expect(startResult.stdout).toContain("You are in **start** state.");

    // 2. Goto review (first visit → full card)
    const gotoReview = runCli(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoReview.exitCode).toBe(0);
    expect(gotoReview.stdout).toContain("You are in **review** state.");
    expect(gotoReview.stdout).toContain("Review the work.");
    expect(gotoReview.stdout).toContain("Your instructions:");
    expect(gotoReview.stdout).not.toContain("Re-entering");

    // 3. Goto start (re-visit → lite card)
    const gotoBack = runCli(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(gotoBack.exitCode).toBe(0);
    expect(gotoBack.stdout).toContain("Re-entering **start**");
    expect(gotoBack.stdout).toContain("fflow current");
    expect(gotoBack.stdout).toContain("ready → review");
    // Lite card must NOT contain prompt or "Your instructions:"
    expect(gotoBack.stdout).not.toContain("Your instructions:");
    expect(gotoBack.stdout).not.toContain("Begin work.");

    // 4. Verify snapshot tracks all three visits (start, review, start already in set)
    const store = new Store(root);
    const snapshot = store.readSnapshot(id);
    expect(snapshot?.visited_states).toContain("start");
    expect(snapshot?.visited_states).toContain("review");
    // Set semantics: "start" appears once, not twice
    expect(snapshot?.visited_states).toHaveLength(2);
  });
});

// ─── Guide and reminders behavior ─────────────────────────

describe("Guide and reminders in state cards", () => {
  test("fflow start includes guide in header", () => {
    const root = join(tmp, "guide-start-root");
    const id = uniqueRunId("guide-start");

    const result = runCli(`start ${fsmMulti} --run-id ${id}`, { root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Multi-state workflow");
    expect(result.stdout).toContain("Execute this state's instructions NOW");
    expect(result.stdout).toContain("MUST NOT truncate");
  });

  test("fflow start --lite includes guide in header", () => {
    const root = join(tmp, "guide-lite-root");
    const id = uniqueRunId("guide-lite");

    const result = runCli(`start ${fsmMulti} --run-id ${id} --lite`, { root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Multi-state workflow");
  });

  test("fflow goto first visit has reminders but no guide", () => {
    const root = join(tmp, "guide-goto-root");
    const id = uniqueRunId("guide-goto");

    runCli(`start ${fsmMulti} --run-id ${id}`, { root });
    const gotoResult = runCli(`goto review --run-id ${id} --on ready`, { root });
    expect(gotoResult.exitCode).toBe(0);
    expect(gotoResult.stdout).toContain("Execute this state's instructions NOW");
    expect(gotoResult.stdout).toContain("MUST NOT truncate");
    expect(gotoResult.stdout).not.toContain("Multi-state workflow");
  });
});

// ─── Non-lite round-trip: full cards always ───────────────

describe("Non-lite round-trip: always full cards", () => {
  test("start (no --lite) → goto B → goto A → revisit shows full card", () => {
    const root = join(tmp, "nonlite-roundtrip-root");
    const id = uniqueRunId("nonlite-rt");

    // 1. Start without --lite
    const startResult = runCli(`start ${fsmMulti} --run-id ${id}`, { root });
    expect(startResult.exitCode).toBe(0);
    expect(startResult.stdout).toContain("You are in **start** state.");

    // 2. Goto review (first visit → full card)
    const gotoReview = runCli(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoReview.exitCode).toBe(0);
    expect(gotoReview.stdout).toContain("You are in **review** state.");
    expect(gotoReview.stdout).toContain("Review the work.");

    // 3. Goto back to start (re-visit → still full card, not lite)
    const gotoBack = runCli(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(gotoBack.exitCode).toBe(0);
    expect(gotoBack.stdout).toContain("You are in **start** state.");
    expect(gotoBack.stdout).toContain("Your instructions:");
    expect(gotoBack.stdout).toContain("Begin work.");
    expect(gotoBack.stdout).not.toContain("Re-entering");

    // 4. Verify snapshot does NOT track visited_states without --lite
    const store = new Store(root);
    const snapshot = store.readSnapshot(id);
    expect(snapshot?.visited_states).toBeUndefined();
  });
});
