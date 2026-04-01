import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCli, runCliJson } from "./e2e/helpers.js";
import {
  MINIMAL_FSM,
  MULTI_FSM,
  cleanupTempDir,
  createTempDir,
  uniqueRunId,
} from "./fixtures.js";

let tmp: string;
let fsmMinimal: string; // 2-state: start → done
let fsmMulti: string; // 3-state: start → review → done (with back-transition)

beforeAll(() => {
  tmp = createTempDir("integ");
  fsmMinimal = join(tmp, "minimal.yaml");
  fsmMulti = join(tmp, "multi.yaml");
  writeFileSync(fsmMinimal, MINIMAL_FSM, "utf-8");
  writeFileSync(fsmMulti, MULTI_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

const defaultRoot = () => join(tmp, "root");

// ─── CLI — start command ─────────────────────────────────────────

describe.concurrent("CLI — start command", () => {
  test("human-readable output includes state card", () => {
    const id = uniqueRunId("start-human");
    const { stdout, exitCode } = runCli(`start ${fsmMinimal} --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("FSM started.");
    expect(stdout).toContain("Minimal workflow");
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin here.");
    expect(stdout).toContain("next → done");
  });

  test("JSON output has correct envelope structure", () => {
    const id = uniqueRunId("start-json");
    const { envelope, exitCode } = runCliJson(`start ${fsmMinimal} --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.code).toBeNull();
    expect(envelope.message).toBe("Run started");
    const data = envelope.data as Record<string, unknown>;
    expect(data.run_id).toBe(id);
    expect(data.state).toBe("start");
    expect(data.prompt).toBe("Begin here.");
    expect(data.run_status).toBe("active");
    expect(data.transitions).toEqual({ next: "done" });
  });

  test("auto-generates run-id when omitted", () => {
    const { envelope, exitCode } = runCliJson(`start ${fsmMinimal}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    expect(typeof data.run_id).toBe("string");
    expect((data.run_id as string).length).toBeGreaterThan(0);
  });

  test("RUN_EXISTS error on duplicate run-id (exit 2)", () => {
    const id = uniqueRunId("start-dup");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`start ${fsmMinimal} --run-id ${id}`, {
      root: defaultRoot(),
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_EXISTS");
  });
});

// ─── CLI — current command ───────────────────────────────────────

describe.concurrent("CLI — current command", () => {
  test("shows current state after start", () => {
    const id = uniqueRunId("current-human");
    runCli(`start ${fsmMulti} --run-id ${id}`, { root: defaultRoot() });
    const { stdout, exitCode } = runCli(`current --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin work.");
    expect(stdout).toContain("Draft spec");
    expect(stdout).toContain("ready → review");
  });

  test("JSON output matches contract", () => {
    const id = uniqueRunId("current-json");
    runCli(`start ${fsmMulti} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`current --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.message).toBe("Current state");
    const data = envelope.data as Record<string, unknown>;
    expect(data.run_id).toBe(id);
    expect(data.state).toBe("start");
    expect(data.prompt).toBe("Begin work.");
    expect(data.todos).toEqual(["Draft spec", "Review spec"]);
    expect(data.transitions).toEqual({ ready: "review" });
    expect(data.run_status).toBe("active");
  });

  test("RUN_NOT_FOUND error (exit 2)", () => {
    const { envelope, exitCode } = runCliJson("current --run-id nonexistent", {
      root: defaultRoot(),
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_FOUND");
  });
});

// ─── CLI — goto command ──────────────────────────────────────────

describe.concurrent("CLI — goto command", () => {
  test("transitions to valid target state", () => {
    const id = uniqueRunId("goto-valid");
    runCli(`start ${fsmMulti} --run-id ${id}`, { root: defaultRoot() });
    const { stdout, exitCode } = runCli(`goto review --run-id ${id} --on ready`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("You are in **review** state.");
    expect(stdout).toContain("Review the work.");
    expect(stdout).toContain("approved → done");
    expect(stdout).toContain("rejected → start");
  });

  test("goto done sets run_status=completed", () => {
    const id = uniqueRunId("goto-done");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`goto done --run-id ${id} --on next`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    expect(data.run_status).toBe("completed");
    expect(data.completion_reason).toBe("done_auto");
    expect(data.state).toBe("done");
  });

  test("INVALID_TRANSITION error with available transitions", () => {
    const id = uniqueRunId("goto-invalid");
    runCli(`start ${fsmMulti} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(
      `goto done --run-id ${id} --on nonexistent`,
      { root: defaultRoot(), expectFail: true },
    );
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("INVALID_TRANSITION");
    expect(envelope.message as string).toContain("ready → review");
  });

  test("STATE_NOT_FOUND error", () => {
    const id = uniqueRunId("goto-nostate");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(
      `goto nonexistent --run-id ${id} --on next`,
      { root: defaultRoot(), expectFail: true },
    );
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("STATE_NOT_FOUND");
  });

  test("RUN_NOT_ACTIVE error on completed run", () => {
    const id = uniqueRunId("goto-completed");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    runCli(`goto done --run-id ${id} --on next`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`goto done --run-id ${id} --on next`, {
      root: defaultRoot(),
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_ACTIVE");
    expect(envelope.message as string).toContain("completed");
  });
});

// ─── CLI — finish command ────────────────────────────────────────

describe.concurrent("CLI — finish command", () => {
  test("aborts active run, shows transition history", () => {
    const id = uniqueRunId("finish-human");
    runCli(`start ${fsmMulti} --run-id ${id}`, { root: defaultRoot() });
    runCli(`goto review --run-id ${id} --on ready`, { root: defaultRoot() });
    const { stdout, exitCode } = runCli(`finish --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Run aborted at **review** state.");
    expect(stdout).toContain("Transition history:");
    expect(stdout).toContain("start");
    expect(stdout).toContain("-[ready]-> review");
    expect(stdout).toContain("-[aborted]");
  });

  test("JSON output with completion_reason=manual_abort", () => {
    const id = uniqueRunId("finish-json");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`finish --run-id ${id}`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
    expect(envelope.message).toBe("Run aborted");
    const data = envelope.data as Record<string, unknown>;
    expect(data.run_status).toBe("aborted");
    expect(data.completion_reason).toBe("manual_abort");
    expect(data.run_id).toBe(id);
  });

  test("RUN_NOT_ACTIVE error on already aborted run", () => {
    const id = uniqueRunId("finish-double");
    runCli(`start ${fsmMinimal} --run-id ${id}`, { root: defaultRoot() });
    runCli(`finish --run-id ${id}`, { root: defaultRoot() });
    const { envelope, exitCode } = runCliJson(`finish --run-id ${id}`, {
      root: defaultRoot(),
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_ACTIVE");
    expect(envelope.message as string).toContain("aborted");
  });
});

// ─── CLI — full workflow e2e ─────────────────────────────────────

describe.concurrent("CLI — full workflow e2e", () => {
  test("start → goto → goto → current → goto done (complete lifecycle)", () => {
    const id = uniqueRunId("e2e");
    const root = join(tmp, "e2e-root");

    // 1. Start
    const startResult = runCliJson(`start ${fsmMulti} --run-id ${id}`, {
      root,
    });
    expect(startResult.exitCode).toBe(0);
    expect((startResult.envelope.data as Record<string, unknown>).state).toBe("start");

    // 2. Goto review
    const gotoReview = runCliJson(`goto review --run-id ${id} --on ready`, {
      root,
    });
    expect(gotoReview.exitCode).toBe(0);
    expect((gotoReview.envelope.data as Record<string, unknown>).state).toBe("review");

    // 3. Goto back to start (rejected)
    const gotoBack = runCliJson(`goto start --run-id ${id} --on rejected`, {
      root,
    });
    expect(gotoBack.exitCode).toBe(0);
    expect((gotoBack.envelope.data as Record<string, unknown>).state).toBe("start");
    expect((gotoBack.envelope.data as Record<string, unknown>).run_status).toBe(
      "active",
    );

    // 4. Current — verify we're back at start
    const cur = runCliJson(`current --run-id ${id}`, { root });
    expect(cur.exitCode).toBe(0);
    expect((cur.envelope.data as Record<string, unknown>).state).toBe("start");

    // 5. Go through to done
    runCliJson(`goto review --run-id ${id} --on ready`, { root });
    const gotoDone = runCliJson(`goto done --run-id ${id} --on approved`, {
      root,
    });
    expect(gotoDone.exitCode).toBe(0);
    expect((gotoDone.envelope.data as Record<string, unknown>).state).toBe("done");
    expect((gotoDone.envelope.data as Record<string, unknown>).run_status).toBe(
      "completed",
    );
  });
});

// ─── CLI — verify command ────────────────────────────────────────

describe.concurrent("CLI — verify command", () => {
  test("exits with ARGS_INVALID when plan file does not exist", () => {
    const planPath = join(tmp, "nonexistent-plan.md");
    const testDir = join(tmp, "noplan-out");
    const { envelope, exitCode } = runCliJson(
      `verify ${planPath} --test-dir ${testDir}`,
      { expectFail: true },
    );
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("ARGS_INVALID");
  });
});
