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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { handlePostToolUse } from "../hooks/post-tool-use.js";
import { Store } from "../store.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import {
  MULTI_FSM,
  PLANNING_FSM,
  cleanupTempDir,
  createTempDir,
  startEvent,
  writeFsmFile,
} from "./fixtures.js";

let tmp: string;
let fsmMulti: string;

beforeAll(() => {
  tmp = createTempDir("lite-integ");
  fsmMulti = join(tmp, "multi.yaml");
  writeFileSync(fsmMulti, MULTI_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "integ"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

// ─── Non-lite round-trip: all full cards ─────────────────────────

describe("Non-lite round-trip: all full cards", () => {
  test("start (no --lite) → goto B → goto A → all outputs are full cards", () => {
    const root = join(tmp, "nonlite-roundtrip-root");
    const id = uniqueRunId("nonlite-rt");

    // 1. Start without --lite
    const startResult = runCli(`start ${fsmMulti} --run-id ${id}`, { root });
    expect(startResult.exitCode).toBe(0);
    expect(startResult.stdout).toContain("You are in **start** state.");

    // 2. Goto review
    const gotoReview = runCli(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoReview.exitCode).toBe(0);
    expect(gotoReview.stdout).toContain("You are in **review** state.");
    expect(gotoReview.stdout).toContain("Review the work.");
    expect(gotoReview.stdout).not.toContain("Re-entering");

    // 3. Goto back to start (re-visit, but non-lite → should still be full card)
    const gotoBack = runCli(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(gotoBack.exitCode).toBe(0);
    expect(gotoBack.stdout).toContain("You are in **start** state.");
    expect(gotoBack.stdout).toContain("Begin work.");
    expect(gotoBack.stdout).toContain("Your instructions:");
    expect(gotoBack.stdout).not.toContain("Re-entering");
  });
});

// ─── Hook reminder: formatReminder omits prompt text ─────────────

describe("PostToolUse hook reminder: no prompt text", () => {
  test("reminder output contains state and transitions but not prompt text", () => {
    const root = join(tmp, "hook-reminder-root");
    const fsmPath = writeFsmFile(tmp, "planning-hook.yaml", PLANNING_FSM);

    // Enable hook
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: true } }),
      "utf-8",
    );

    // Set up an active run with session binding
    const store = new Store(root);
    const runId = uniqueRunId("hook-reminder");
    store.initRun(runId, fsmPath);
    store.commit(runId, startEvent("plan"), { run_status: "active", state: "plan" });
    store.bindSession("hook-session", runId);

    const makeInput = (overrides: Record<string, unknown> = {}) => ({
      session_id: "hook-session",
      tool_name: "Read",
      tool_input: {},
      tool_response: {},
      ...overrides,
    });

    // Advance counter to 4 so next call triggers reminder
    for (let i = 0; i < 4; i++) {
      const result = handlePostToolUse(makeInput(), root);
      expect(result).toBeNull();
    }

    // 5th call: reminder should fire
    const reminder = handlePostToolUse(makeInput(), root);
    expect(reminder).not.toBeNull();
    expect(reminder).toContain("[FSM Reminder]");
    expect(reminder).toContain("State: plan");
    expect(reminder).toContain("approved → execute");
    // Reminder must NOT contain the prompt text
    expect(reminder).not.toContain("Plan the work.");
  });
});
