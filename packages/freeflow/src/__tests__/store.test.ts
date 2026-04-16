import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Store } from "../store.js";
import {
  cleanupTempDir,
  createTempDir,
  gotoEvent,
  gotoSnapshot,
  startEvent,
  startSnapshot,
} from "./fixtures.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("store-test");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

// Fresh store per test to avoid cross-contamination
let testCount = 0;
function freshStore(): Store {
  testCount++;
  return new Store(join(tmp, `root-${testCount}`));
}

// --- Tests ---

describe("Store — commit", () => {
  test("increments seq on subsequent commits", () => {
    const s = freshStore();
    s.initRun("seq-inc", "/fake.yaml");
    s.commit("seq-inc", startEvent("plan"), startSnapshot("plan"));

    const { event: e2 } = s.commit(
      "seq-inc",
      gotoEvent("plan", "coding", "plan approved"),
      gotoSnapshot("coding"),
    );
    expect(e2.seq).toBe(2);

    const { event: e3 } = s.commit(
      "seq-inc",
      gotoEvent("coding", "review", "tests pass"),
      gotoSnapshot("review"),
    );
    expect(e3.seq).toBe(3);
  });
});

describe("Store — terminal states", () => {
  test("goto done produces completed snapshot", () => {
    const s = freshStore();
    s.initRun("complete", "/fake.yaml");
    s.commit("complete", startEvent("plan"), startSnapshot("plan"));
    const { snapshot } = s.commit("complete", gotoEvent("plan", "done", "all done"), {
      run_status: "completed",
      state: "done",
    });

    expect(snapshot.run_status).toBe("completed");
    expect(snapshot.state).toBe("done");

    // Snapshot persisted correctly
    const snap = s.readSnapshot("complete");
    expect(snap?.run_status).toBe("completed");
  });

  test("abort produces aborted snapshot", () => {
    const s = freshStore();
    s.initRun("abort", "/fake.yaml");
    s.commit("abort", startEvent("plan"), startSnapshot("plan"));
    const { snapshot } = s.commit(
      "abort",
      {
        event: "abort",
        from_state: "plan",
        to_state: null,
        on_label: null,
        actor: "human",
        reason: "manual_abort",
      },
      { run_status: "aborted", state: "plan" },
    );

    expect(snapshot.run_status).toBe("aborted");
    expect(snapshot.state).toBe("plan");

    const snap = s.readSnapshot("abort");
    expect(snap?.run_status).toBe("aborted");
  });

  test("backward compat: reading finish events normalizes to abort", () => {
    const s = freshStore();
    s.initRun("compat-finish", "/fake.yaml");
    s.commit("compat-finish", startEvent("plan"), startSnapshot("plan"));

    // Manually write a "finish" event to the JSONL file (simulating old data)
    const eventsPath = join(s.getRunDir("compat-finish"), "events.jsonl");
    const finishEvent = JSON.stringify({
      seq: 2,
      ts: new Date().toISOString(),
      run_id: "compat-finish",
      event: "finish",
      from_state: "plan",
      to_state: null,
      on_label: null,
      actor: "human",
      reason: "manual_abort",
      metadata: null,
    });
    appendFileSync(eventsPath, `${finishEvent}\n`, "utf-8");

    const events = s.readEvents("compat-finish");
    expect(events).toHaveLength(2);
    expect(events[1].event).toBe("abort");
  });
});

describe("Store — session management", () => {
  test("unbindSession also removes counter", () => {
    const s = freshStore();
    s.bindSession("sess-clean", "run-1");
    s.writeCounter("sess-clean", 3);
    s.unbindSession("sess-clean");
    expect(s.readCounter("sess-clean")).toBe(0);
  });
});

describe("Store — lite mode data models", () => {
  test("backwards-compatible snapshot parsing: missing visited_states returns undefined", () => {
    const s = freshStore();
    s.initRun("compat", "/fake.yaml");
    // Commit without visited_states (old-style snapshot)
    s.commit("compat", startEvent("plan"), startSnapshot("plan"));

    const snap = s.readSnapshot("compat");
    expect(snap).not.toBeNull();
    expect(snap?.visited_states).toBeUndefined();
  });

  test("commit() with visited_states in snapshot input persists the array", () => {
    const s = freshStore();
    s.initRun("visited", "/fake.yaml");
    s.commit("visited", startEvent("plan"), {
      run_status: "active",
      state: "plan",
      visited_states: ["plan"],
    });

    const snap = s.readSnapshot("visited");
    expect(snap).not.toBeNull();
    expect(snap?.visited_states).toEqual(["plan"]);

    // Second commit adds another state
    s.commit("visited", gotoEvent("plan", "coding", "approved"), {
      run_status: "active",
      state: "coding",
      visited_states: ["plan", "coding"],
    });

    const snap2 = s.readSnapshot("visited");
    expect(snap2?.visited_states).toEqual(["plan", "coding"]);
  });

  test("commit() without visited_states carries forward from current snapshot", () => {
    const s = freshStore();
    s.initRun("carry", "/fake.yaml");
    // First commit with visited_states
    s.commit("carry", startEvent("plan"), {
      run_status: "active",
      state: "plan",
      visited_states: ["plan"],
    });

    // Second commit without visited_states — should carry forward
    s.commit("carry", gotoEvent("plan", "coding", "approved"), {
      run_status: "active",
      state: "coding",
    });

    const snap = s.readSnapshot("carry");
    expect(snap?.visited_states).toEqual(["plan"]);
  });
});

describe("Store — concurrent writes", () => {
  test("parallel commits produce monotonic seq with no corruption", async () => {
    const root = join(tmp, "concurrent-root");
    const s = new Store(root);
    s.initRun("conc", "/fake.yaml");
    s.commit("conc", startEvent("plan"), startSnapshot("plan"));

    const workerCount = 10;
    const srcStore = join(import.meta.dirname, "..", "store.ts");

    // Run workers in parallel via Promise.all + exec (using tsx for TS)
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const promises = Array.from({ length: workerCount }, (_, i) =>
      execAsync(
        `npx tsx -e '
          import { Store } from "${srcStore}";
          const s = new Store("${root}");
          s.commit("conc", {
            event: "goto",
            from_state: "plan",
            to_state: "plan",
            on_label: "step-${i}",
            actor: "agent",
            reason: null,
          }, { run_status: "active", state: "plan" });
        '`,
      ),
    );

    await Promise.all(promises);

    // Verify: 1 start + N goto = N+1 events
    const events = s.readEvents("conc");
    expect(events).toHaveLength(workerCount + 1);

    // Seq must be strictly monotonic
    const seqs = events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }

    // Snapshot last_seq matches
    const snap = s.readSnapshot("conc");
    expect(snap?.last_seq).toBe(workerCount + 1);
  });
});
