import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { handlePostToolUse } from "../../hooks/post-tool-use.js";
import { Store } from "../../store.js";

let tmp: string;
let fsmPath: string;

const MINIMAL_FSM = `
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

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-hook-test-"));
  fsmPath = join(tmp, "workflow.yaml");
  writeFileSync(fsmPath, MINIMAL_FSM, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

let testCount = 0;
function freshRoot(): string {
  testCount++;
  return join(tmp, `root-${testCount}`);
}

function setupActiveRun(root: string, runId: string): Store {
  const store = new Store(root);
  store.initRun(runId, fsmPath);
  store.commit(
    runId,
    {
      event: "start",
      from_state: null,
      to_state: "plan",
      on_label: null,
      actor: "system",
      reason: null,
    },
    { run_status: "active", state: "plan" },
  );
  store.bindSession("test-session", runId);
  return store;
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

describe("handlePostToolUse — auto-detect freefsm start", () => {
  test("binds session from freefsm start command", () => {
    const root = freshRoot();
    const store = new Store(root);
    store.initRun("auto-run", fsmPath);
    store.commit(
      "auto-run",
      {
        event: "start",
        from_state: null,
        to_state: "plan",
        on_label: null,
        actor: "system",
        reason: null,
      },
      { run_status: "active", state: "plan" },
    );

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `freefsm start ${fsmPath} --run-id auto-run --root ${root}`,
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

describe("handlePostToolUse — auto-detect freefsm finish", () => {
  test("unbinds session on freefsm finish", () => {
    const root = freshRoot();
    const store = setupActiveRun(root, "finish-run");

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `freefsm finish --run-id finish-run --root ${root}`,
      },
      tool_response: "Run aborted.",
    });

    const result = handlePostToolUse(input, root);
    expect(result).toBeNull();
    expect(store.readSession("test-session")).toBeNull();
  });
});

describe("handlePostToolUse — auto-detect goto done", () => {
  test("unbinds session on freefsm goto done", () => {
    const root = freshRoot();
    const store = setupActiveRun(root, "goto-done-run");

    const input = makeInput({
      tool_name: "Bash",
      tool_input: {
        command: `freefsm goto done --run-id goto-done-run --on "complete" --root ${root}`,
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
    setupActiveRun(root, "counter-run");

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
    expect(result).toContain("Plan the work.");
    expect(result).toContain("approved → execute");
  });

  test("emits reminder again on 10th call", () => {
    const root = freshRoot();
    setupActiveRun(root, "counter-10");

    for (let i = 0; i < 9; i++) {
      handlePostToolUse(makeInput(), root);
    }

    const result = handlePostToolUse(makeInput(), root);
    expect(result).not.toBeNull();
    expect(result).toContain("[FSM Reminder]");
  });

  test("returns null when run_status is not active", () => {
    const root = freshRoot();
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
