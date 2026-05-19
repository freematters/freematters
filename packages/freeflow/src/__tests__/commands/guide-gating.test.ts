import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { current } from "../../commands/current.js";
import { goto } from "../../commands/goto.js";
import { start } from "../../commands/start.js";
import { type StateCard, formatSubagentDispatch } from "../../output.js";
import { Store } from "../../store.js";
import { cleanupTempDir, createTempDir, uniqueRunId } from "../fixtures.js";

/**
 * Workflow with a per-state guide on the initial state `a`, plus a second
 * state `b` we can toggle to and back from.
 */
const PER_STATE_GUIDE_FSM = `
version: 1
guide: "Top-level guide"
initial: a
states:
  a:
    prompt: "Prompt A."
    guide: "STATE-A-GUIDE"
    transitions:
      next: b
      finish: done
  b:
    prompt: "Prompt B."
    transitions:
      back: a
      finish: done
  done:
    prompt: "Done."
    transitions: {}
`;

let tmp: string;

afterEach(() => {
  if (tmp) cleanupTempDir(tmp);
});

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((str: string) => {
    writes.push(str);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return writes.join("");
}

describe("state-card guide gating", () => {
  test("T12: first-entry start includes guide and records shown_guides; subsequent current omits guide and leaves snapshot unchanged", () => {
    tmp = createTempDir("gate-t12");
    const fsmPath = join(tmp, "wf.yaml");
    writeFileSync(fsmPath, PER_STATE_GUIDE_FSM, "utf-8");
    const root = join(tmp, "root");
    const runId = uniqueRunId("t12");

    const startOut = captureStdout(() => {
      start({ fsmPath, runId, root, json: false });
    });
    expect(startOut).toContain("STATE-A-GUIDE");

    const store = new Store(root);
    const snap1 = store.readSnapshot(runId);
    expect(snap1).not.toBeNull();
    expect(snap1?.shown_guides).toEqual(["a"]);
    const last_seq1 = snap1?.last_seq;
    const updated_at1 = snap1?.updated_at;

    const currentOut = captureStdout(() => {
      current({ runId, root, json: false });
    });
    expect(currentOut).not.toContain("STATE-A-GUIDE");

    const snap2 = store.readSnapshot(runId);
    expect(snap2?.shown_guides).toEqual(["a"]);
    expect(snap2?.last_seq).toBe(last_seq1);
    expect(snap2?.updated_at).toBe(updated_at1);
  });

  test("T13: revisiting the same state via goto does not re-show guide and does not duplicate shown_guides", () => {
    tmp = createTempDir("gate-t13");
    const fsmPath = join(tmp, "wf.yaml");
    writeFileSync(fsmPath, PER_STATE_GUIDE_FSM, "utf-8");
    const root = join(tmp, "root");
    const runId = uniqueRunId("t13");

    const startOut = captureStdout(() => {
      start({ fsmPath, runId, root, json: false });
    });
    expect(startOut).toContain("STATE-A-GUIDE");

    const store = new Store(root);
    expect(store.readSnapshot(runId)?.shown_guides).toEqual(["a"]);

    // Go to b
    captureStdout(() => {
      goto({ target: "b", runId, on: "next", root, json: false });
    });
    expect(store.readSnapshot(runId)?.shown_guides).toEqual(["a"]);

    // Back to a — second visit should not re-show the guide
    const backOut = captureStdout(() => {
      goto({ target: "a", runId, on: "back", root, json: false });
    });
    expect(backOut).not.toContain("STATE-A-GUIDE");
    expect(store.readSnapshot(runId)?.shown_guides).toEqual(["a"]);
  });

  test("subagent dispatch bypass: formatSubagentDispatch always includes per-state guide regardless of shown_guides", () => {
    const card: StateCard = {
      state: "work",
      prompt: "Do the heavy lifting.",
      todos: null,
      transitions: { complete: "done" },
      guide: "SUBAGENT-STATE-GUIDE",
      subagent: true,
    };

    // Simulate the "already shown" case: caller has not stripped the guide
    // because formatSubagentDispatch is the bypass path.
    const out = formatSubagentDispatch(card, "run-xyz");
    expect(out).toContain("SUBAGENT-STATE-GUIDE");
  });
});
