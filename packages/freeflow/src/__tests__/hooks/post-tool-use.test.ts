import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { handlePostToolUse } from "../../hooks/post-tool-use.js";
import { Store } from "../../store.js";
import {
  PLANNING_FSM,
  cleanupTempDir,
  createTempDir,
  setupActiveRun,
  setupRun,
  writeFsmFile,
} from "../fixtures.js";

let tmp: string;
let fsmPath: string;

beforeAll(() => {
  tmp = createTempDir("hook-test");
  fsmPath = writeFsmFile(tmp, "workflow.yaml", PLANNING_FSM);
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let testCount = 0;
function freshRoot(): string {
  testCount++;
  return join(tmp, `root-${testCount}`);
}

/** Write settings.json to enable the hook in a given root directory. */
function enableHook(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "settings.json"),
    JSON.stringify({ hooks: { postToolUse: true } }),
    "utf-8",
  );
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "test-session",
    tool_name: "Read",
    tool_input: {},
    tool_response: {},
    ...overrides,
  };
}

describe("handlePostToolUse — no active run", () => {
  test("returns null when no session binding exists", () => {
    const root = freshRoot();
    const result = handlePostToolUse(makeInput(), root);
    expect(result).toBeNull();
  });
});

describe("handlePostToolUse — auto-detect fflow start", () => {
  test("binds session from fflow start command", () => {
    const root = freshRoot();
    enableHook(root);
    const store = setupRun(root, "auto-run", fsmPath, "plan");

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `fflow start ${fsmPath} --run-id auto-run --root ${root}`,
      },
      tool_response: "You are in **plan** state.\n\nrun_id: auto-run",
    });

    const result = handlePostToolUse(input, root);
    // First call after bind — counter is 1, not divisible by 5
    expect(result).toBeNull();
    // But session is now bound
    expect(store.readSession("test-session")).toBe("auto-run");
  });
});

describe("handlePostToolUse — auto-detect fflow finish", () => {
  test("unbinds session on fflow finish", () => {
    const root = freshRoot();
    enableHook(root);
    const store = setupActiveRun(root, "finish-run", fsmPath, "test-session", "plan");

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `fflow finish --run-id finish-run --root ${root}`,
      },
      tool_response: "Run aborted.",
    });

    const result = handlePostToolUse(input, root);
    expect(result).toBeNull();
    expect(store.readSession("test-session")).toBeNull();
  });
});

describe("handlePostToolUse — auto-detect goto done", () => {
  test("unbinds session on fflow goto done", () => {
    const root = freshRoot();
    enableHook(root);
    const store = setupActiveRun(
      root,
      "goto-done-run",
      fsmPath,
      "test-session",
      "plan",
    );

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `fflow goto done --run-id goto-done-run --on "complete" --root ${root}`,
      },
      tool_response: "Transitioned to done.",
    });

    const result = handlePostToolUse(input, root);
    expect(result).toBeNull();
    expect(store.readSession("test-session")).toBeNull();
  });
});

describe("handlePostToolUse — counter and reminder", () => {
  test("emits reminder on every 5th call", () => {
    const root = freshRoot();
    enableHook(root);
    setupActiveRun(root, "counter-run", fsmPath, "test-session", "plan");

    // Calls 1-4: no reminder
    for (let i = 0; i < 4; i++) {
      const result = handlePostToolUse(makeInput(), root);
      expect(result).toBeNull();
    }

    // Call 5: reminder emitted
    const result = handlePostToolUse(makeInput(), root);
    expect(result).not.toBeNull();
    expect(result).toContain("[FSM Reminder]");
    expect(result).toContain("State: plan");
    // formatReminder no longer includes prompt text (lite-mode simplification)
    expect(result).not.toContain("Plan the work.");
    expect(result).toContain("approved → execute");
  });

  test("emits reminder again on 10th call", () => {
    const root = freshRoot();
    enableHook(root);
    setupActiveRun(root, "counter-10", fsmPath, "test-session", "plan");

    for (let i = 0; i < 9; i++) {
      handlePostToolUse(makeInput(), root);
    }

    const result = handlePostToolUse(makeInput(), root);
    expect(result).not.toBeNull();
    expect(result).toContain("[FSM Reminder]");
  });

  test("returns null when run_status is not active", () => {
    const root = freshRoot();
    enableHook(root);
    const store = new Store(root);
    store.initRun("completed-run", fsmPath);
    store.commit(
      "completed-run",
      {
        event: "start",
        from_state: null,
        to_state: "done",
        on_label: null,
        actor: "system",
        reason: null,
      },
      { run_status: "completed", state: "done" },
    );
    store.bindSession("test-session", "completed-run");
    // Set counter to 4 so next call would be 5th
    store.writeCounter("test-session", 4);

    const result = handlePostToolUse(makeInput(), root);
    expect(result).toBeNull();
    // Session should be cleaned up
    expect(store.readSession("test-session")).toBeNull();
  });
});

describe("handlePostToolUse — hook gate", () => {
  test("returns null when settings.json is missing", () => {
    const root = freshRoot();
    // No settings.json — hook should be disabled
    setupActiveRun(root, "gate-missing", fsmPath, "test-session", "plan");
    const store = new Store(root);
    store.writeCounter("test-session", 4);

    const result = handlePostToolUse(makeInput(), root);
    expect(result).toBeNull();
  });

  test("returns null when hooks.postToolUse is false", () => {
    const root = freshRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: false } }),
      "utf-8",
    );
    setupActiveRun(root, "gate-false", fsmPath, "test-session", "plan");
    const store = new Store(root);
    store.writeCounter("test-session", 4);

    const result = handlePostToolUse(makeInput(), root);
    expect(result).toBeNull();
  });

  test("returns reminder when hooks.postToolUse is true (counter at 4→5)", () => {
    const root = freshRoot();
    enableHook(root);
    setupActiveRun(root, "gate-true", fsmPath, "test-session", "plan");
    const store = new Store(root);
    store.writeCounter("test-session", 4);

    const result = handlePostToolUse(makeInput(), root);
    expect(result).not.toBeNull();
    expect(result).toContain("[FSM Reminder]");
    expect(result).toContain("State: plan");
  });
});
