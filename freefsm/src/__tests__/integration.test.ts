import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const CLI = resolve(__dirname, "../../dist/cli.js");

let tmp: string;
let fsmMinimal: string; // 2-state: start → done
let fsmMulti: string; // 3-state: start → review → done (with back-transition)

const MINIMAL_FSM = `
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

const MULTI_FSM = `
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

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-integ-"));
  fsmMinimal = join(tmp, "minimal.yaml");
  fsmMulti = join(tmp, "multi.yaml");
  writeFileSync(fsmMinimal, MINIMAL_FSM, "utf-8");
  writeFileSync(fsmMulti, MULTI_FSM, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

let runCounter = 0;
function uniqueRunId(prefix = "run"): string {
  runCounter++;
  return `${prefix}-${runCounter}`;
}

function run(
  args: string,
  opts: { root?: string; expectFail?: boolean } = {},
): { stdout: string; exitCode: number } {
  const root = opts.root ?? join(tmp, "root");
  const fullArgs = `${args} --root ${root}`;
  try {
    const stdout = execFileSync("node", [CLI, ...fullArgs.split(/\s+/)], {
      encoding: "utf-8",
      env: { ...process.env, FREEFSM_ROOT: undefined },
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    if (opts.expectFail) {
      return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), exitCode: e.status };
    }
    throw err;
  }
}

function runJson(
  args: string,
  opts: { root?: string; expectFail?: boolean } = {},
): { envelope: Record<string, unknown>; exitCode: number } {
  const root = opts.root ?? join(tmp, "root");
  const fullArgs = `${args} -j --root ${root}`;
  try {
    const stdout = execFileSync("node", [CLI, ...fullArgs.split(/\s+/)], {
      encoding: "utf-8",
      env: { ...process.env, FREEFSM_ROOT: undefined },
    });
    return { envelope: JSON.parse(stdout), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    if (opts.expectFail) {
      // JSON errors go to stdout
      const raw = e.stdout ?? e.stderr ?? "";
      return { envelope: JSON.parse(raw), exitCode: e.status };
    }
    throw err;
  }
}

function runHook(
  input: Record<string, unknown>,
  root: string,
): Record<string, unknown> | null {
  const stdout = execFileSync("node", [CLI, "_hook", "post-tool-use"], {
    input: JSON.stringify(input),
    encoding: "utf-8",
    env: { ...process.env, FREEFSM_ROOT: root },
  });
  if (!stdout.trim()) return null;
  return JSON.parse(stdout);
}

// ─── CLI — start command ─────────────────────────────────────────

describe("CLI — start command", () => {
  test("human-readable output includes state card", () => {
    const id = uniqueRunId("start-human");
    const { stdout, exitCode } = run(`start ${fsmMinimal} --run-id ${id}`);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("FSM started.");
    expect(stdout).toContain("Minimal workflow");
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin here.");
    expect(stdout).toContain("next → done");
  });

  test("JSON output has correct envelope structure", () => {
    const id = uniqueRunId("start-json");
    const { envelope, exitCode } = runJson(`start ${fsmMinimal} --run-id ${id}`);
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
    const { envelope, exitCode } = runJson(`start ${fsmMinimal}`);
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    expect(typeof data.run_id).toBe("string");
    expect((data.run_id as string).length).toBeGreaterThan(0);
  });

  test("RUN_EXISTS error on duplicate run-id (exit 2)", () => {
    const id = uniqueRunId("start-dup");
    run(`start ${fsmMinimal} --run-id ${id}`);
    const { envelope, exitCode } = runJson(`start ${fsmMinimal} --run-id ${id}`, {
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_EXISTS");
  });
});

// ─── CLI — current command ───────────────────────────────────────

describe("CLI — current command", () => {
  test("shows current state after start", () => {
    const id = uniqueRunId("current-human");
    run(`start ${fsmMulti} --run-id ${id}`);
    const { stdout, exitCode } = run(`current --run-id ${id}`);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("You are in **start** state.");
    expect(stdout).toContain("Begin work.");
    expect(stdout).toContain("Draft spec");
    expect(stdout).toContain("ready → review");
  });

  test("JSON output matches contract", () => {
    const id = uniqueRunId("current-json");
    run(`start ${fsmMulti} --run-id ${id}`);
    const { envelope, exitCode } = runJson(`current --run-id ${id}`);
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
    const { envelope, exitCode } = runJson("current --run-id nonexistent", {
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_FOUND");
  });
});

// ─── CLI — goto command ──────────────────────────────────────────

describe("CLI — goto command", () => {
  test("transitions to valid target state", () => {
    const id = uniqueRunId("goto-valid");
    run(`start ${fsmMulti} --run-id ${id}`);
    const { stdout, exitCode } = run(`goto review --run-id ${id} --on ready`);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("You are in **review** state.");
    expect(stdout).toContain("Review the work.");
    expect(stdout).toContain("approved → done");
    expect(stdout).toContain("rejected → start");
  });

  test("goto done sets run_status=completed", () => {
    const id = uniqueRunId("goto-done");
    run(`start ${fsmMinimal} --run-id ${id}`);
    const { envelope, exitCode } = runJson(`goto done --run-id ${id} --on next`);
    expect(exitCode).toBe(0);
    const data = envelope.data as Record<string, unknown>;
    expect(data.run_status).toBe("completed");
    expect(data.completion_reason).toBe("done_auto");
    expect(data.state).toBe("done");
  });

  test("INVALID_TRANSITION error with available transitions", () => {
    const id = uniqueRunId("goto-invalid");
    run(`start ${fsmMulti} --run-id ${id}`);
    const { envelope, exitCode } = runJson(
      `goto done --run-id ${id} --on nonexistent`,
      { expectFail: true },
    );
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("INVALID_TRANSITION");
    expect(envelope.message as string).toContain("ready → review");
  });

  test("STATE_NOT_FOUND error", () => {
    const id = uniqueRunId("goto-nostate");
    run(`start ${fsmMinimal} --run-id ${id}`);
    const { envelope, exitCode } = runJson(
      `goto nonexistent --run-id ${id} --on next`,
      { expectFail: true },
    );
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("STATE_NOT_FOUND");
  });

  test("RUN_NOT_ACTIVE error on completed run", () => {
    const id = uniqueRunId("goto-completed");
    run(`start ${fsmMinimal} --run-id ${id}`);
    run(`goto done --run-id ${id} --on next`);
    const { envelope, exitCode } = runJson(`goto done --run-id ${id} --on next`, {
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_ACTIVE");
    expect(envelope.message as string).toContain("completed");
  });
});

// ─── CLI — finish command ────────────────────────────────────────

describe("CLI — finish command", () => {
  test("aborts active run, shows transition history", () => {
    const id = uniqueRunId("finish-human");
    run(`start ${fsmMulti} --run-id ${id}`);
    run(`goto review --run-id ${id} --on ready`);
    const { stdout, exitCode } = run(`finish --run-id ${id}`);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Run aborted at **review** state.");
    expect(stdout).toContain("Transition history:");
    expect(stdout).toContain("start");
    expect(stdout).toContain("-[ready]-> review");
    expect(stdout).toContain("-[aborted]");
  });

  test("JSON output with completion_reason=manual_abort", () => {
    const id = uniqueRunId("finish-json");
    run(`start ${fsmMinimal} --run-id ${id}`);
    const { envelope, exitCode } = runJson(`finish --run-id ${id}`);
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
    run(`start ${fsmMinimal} --run-id ${id}`);
    run(`finish --run-id ${id}`);
    const { envelope, exitCode } = runJson(`finish --run-id ${id}`, {
      expectFail: true,
    });
    expect(exitCode).toBe(2);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe("RUN_NOT_ACTIVE");
    expect(envelope.message as string).toContain("aborted");
  });
});

// ─── CLI — full workflow e2e ─────────────────────────────────────

describe("CLI — full workflow e2e", () => {
  test("start → goto → goto → current → goto done (complete lifecycle)", () => {
    const id = uniqueRunId("e2e");
    const root = join(tmp, "e2e-root");

    // 1. Start
    const startResult = runJson(`start ${fsmMulti} --run-id ${id}`, { root });
    expect(startResult.exitCode).toBe(0);
    expect((startResult.envelope.data as Record<string, unknown>).state).toBe("start");

    // 2. Goto review
    const gotoReview = runJson(`goto review --run-id ${id} --on ready`, { root });
    expect(gotoReview.exitCode).toBe(0);
    expect((gotoReview.envelope.data as Record<string, unknown>).state).toBe("review");

    // 3. Goto back to start (rejected)
    const gotoBack = runJson(`goto start --run-id ${id} --on rejected`, { root });
    expect(gotoBack.exitCode).toBe(0);
    expect((gotoBack.envelope.data as Record<string, unknown>).state).toBe("start");
    expect((gotoBack.envelope.data as Record<string, unknown>).run_status).toBe(
      "active",
    );

    // 4. Current — verify we're back at start
    const cur = runJson(`current --run-id ${id}`, { root });
    expect(cur.exitCode).toBe(0);
    expect((cur.envelope.data as Record<string, unknown>).state).toBe("start");

    // 5. Go through to done
    runJson(`goto review --run-id ${id} --on ready`, { root });
    const gotoDone = runJson(`goto done --run-id ${id} --on approved`, { root });
    expect(gotoDone.exitCode).toBe(0);
    expect((gotoDone.envelope.data as Record<string, unknown>).state).toBe("done");
    expect((gotoDone.envelope.data as Record<string, unknown>).run_status).toBe(
      "completed",
    );
  });
});

// ─── Hook — post-tool-use ────────────────────────────────────────

describe("Hook — post-tool-use", () => {
  test("no output when no active run", () => {
    const hookRoot = join(tmp, "hook-empty");
    const result = runHook(
      {
        session_id: "sess-1",
        tool_name: "Read",
        tool_input: {},
        tool_response: {},
      },
      hookRoot,
    );
    expect(result).toBeNull();
  });

  test("binds session on freefsm start detection", () => {
    const id = uniqueRunId("hook-bind");
    const hookRoot = join(tmp, "hook-bind-root");

    // First, actually start a run so storage exists
    run(`start ${fsmMulti} --run-id ${id}`, { root: hookRoot });

    // Simulate hook seeing the start command
    const result = runHook(
      {
        session_id: "hook-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm start ${fsmMulti} --run-id ${id} --root ${hookRoot}`,
        },
        tool_response: `FSM started.\n\nYou are in **start** state.\nrun_id: ${id}`,
      },
      hookRoot,
    );
    // First call after bind — counter is 1, not divisible by 5
    expect(result).toBeNull();

    // Now make 4 more calls to reach the 5th
    for (let i = 0; i < 4; i++) {
      runHook(
        {
          session_id: "hook-sess",
          tool_name: "Read",
          tool_input: {},
          tool_response: {},
        },
        hookRoot,
      );
    }

    // 6th call (but counter at 5 from the 4 above + 1 from bind) — should emit reminder
    // Actually: bind sets counter to 0, then step 3 in handlePostToolUse increments.
    // Call after bind: counter becomes 1 (no reminder).
    // 4 more calls: counter becomes 2,3,4,5 — 5th call emits reminder.
    // So the 4th call in the loop above should have been the 5th overall.
    // Let's verify by making one more explicit call at counter=6 (no reminder)
    // and then 4 more to reach 10 (reminder).
    // Actually let me re-check: the bind call itself also goes through
    // handlePostToolUse which increments counter to 1 after setting it to 0.
    // So: bind=0→1, loop[0]=2, loop[1]=3, loop[2]=4, loop[3]=5 → reminder at loop[3].
    // We already called those 4 in the loop. Let's just verify the next reminder at 10.
    const callsToTen = 4; // counter is at 5, need 6,7,8,9 then 10
    for (let i = 0; i < callsToTen; i++) {
      runHook(
        {
          session_id: "hook-sess",
          tool_name: "Read",
          tool_input: {},
          tool_response: {},
        },
        hookRoot,
      );
    }
    const reminder = runHook(
      {
        session_id: "hook-sess",
        tool_name: "Read",
        tool_input: {},
        tool_response: {},
      },
      hookRoot,
    );
    expect(reminder).not.toBeNull();
    const ctx = (reminder as Record<string, unknown>).hookSpecificOutput as Record<
      string,
      unknown
    >;
    expect(ctx.hookEventName).toBe("PostToolUse");
    expect(ctx.additionalContext as string).toContain("[FSM Reminder]");
    expect(ctx.additionalContext as string).toContain("State: start");
  });

  test("emits reminder every 5th call", () => {
    const id = uniqueRunId("hook-counter");
    const hookRoot = join(tmp, "hook-counter-root");

    run(`start ${fsmMulti} --run-id ${id}`, { root: hookRoot });

    // Bind session via simulated start detection
    runHook(
      {
        session_id: "counter-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm start ${fsmMulti} --run-id ${id} --root ${hookRoot}`,
        },
        tool_response: `run_id: ${id}`,
      },
      hookRoot,
    );

    // Calls 2-4: no reminder
    for (let i = 0; i < 3; i++) {
      const r = runHook(
        {
          session_id: "counter-sess",
          tool_name: "Read",
          tool_input: {},
          tool_response: {},
        },
        hookRoot,
      );
      expect(r).toBeNull();
    }

    // Call 5: reminder
    const r5 = runHook(
      {
        session_id: "counter-sess",
        tool_name: "Read",
        tool_input: {},
        tool_response: {},
      },
      hookRoot,
    );
    expect(r5).not.toBeNull();
    const ctx = (r5 as Record<string, unknown>).hookSpecificOutput as Record<
      string,
      unknown
    >;
    expect(ctx.additionalContext as string).toContain("[FSM Reminder]");
    expect(ctx.additionalContext as string).toContain("Begin work.");
  });

  test("unbinds session on freefsm finish detection", () => {
    const id = uniqueRunId("hook-finish");
    const hookRoot = join(tmp, "hook-finish-root");

    run(`start ${fsmMulti} --run-id ${id}`, { root: hookRoot });

    // Bind
    runHook(
      {
        session_id: "finish-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm start ${fsmMulti} --run-id ${id} --root ${hookRoot}`,
        },
        tool_response: `run_id: ${id}`,
      },
      hookRoot,
    );

    // Simulate finish detection
    runHook(
      {
        session_id: "finish-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm finish --run-id ${id} --root ${hookRoot}`,
        },
        tool_response: "Run aborted.",
      },
      hookRoot,
    );

    // Subsequent calls should return null (no binding)
    const result = runHook(
      {
        session_id: "finish-sess",
        tool_name: "Read",
        tool_input: {},
        tool_response: {},
      },
      hookRoot,
    );
    expect(result).toBeNull();
  });

  test("unbinds session on freefsm goto done detection", () => {
    const id = uniqueRunId("hook-goto-done");
    const hookRoot = join(tmp, "hook-goto-done-root");

    run(`start ${fsmMinimal} --run-id ${id}`, { root: hookRoot });

    // Bind
    runHook(
      {
        session_id: "goto-done-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm start ${fsmMinimal} --run-id ${id} --root ${hookRoot}`,
        },
        tool_response: `run_id: ${id}`,
      },
      hookRoot,
    );

    // Simulate goto done detection
    runHook(
      {
        session_id: "goto-done-sess",
        tool_name: "Bash",
        tool_input: {
          command: `freefsm goto done --run-id ${id} --on next --root ${hookRoot}`,
        },
        tool_response: "Transitioned to done.",
      },
      hookRoot,
    );

    // Subsequent calls should return null (no binding)
    const result = runHook(
      {
        session_id: "goto-done-sess",
        tool_name: "Read",
        tool_input: {},
        tool_response: {},
      },
      hookRoot,
    );
    expect(result).toBeNull();
  });
});
