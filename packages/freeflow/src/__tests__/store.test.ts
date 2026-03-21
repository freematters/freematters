import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { type EventInput, type SnapshotInput, Store } from "../store.js";
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

describe("Store — initRun", () => {
  test("throws if run already exists", () => {
    const s = freshStore();
    s.initRun("dup", "/fake.yaml");

    expect(() => s.initRun("dup", "/fake.yaml")).toThrow(/already exists/);
  });
});

describe("Store — runExists", () => {
  test("returns false for non-existent run", () => {
    const s = freshStore();
    expect(s.runExists("nope")).toBe(false);
  });

  test("returns true after initRun", () => {
    const s = freshStore();
    s.initRun("exists", "/fake.yaml");
    expect(s.runExists("exists")).toBe(true);
  });
});

describe("Store — readMeta", () => {
  test("throws for non-existent run", () => {
    const s = freshStore();
    expect(() => s.readMeta("ghost")).toThrow();
  });
});

describe("Store — readSnapshot", () => {
  test("returns null when no snapshot exists", () => {
    const s = freshStore();
    s.initRun("no-snap", "/fake.yaml");
    expect(s.readSnapshot("no-snap")).toBeNull();
  });

  test("returns snapshot after commit", () => {
    const s = freshStore();
    s.initRun("snap-test", "/fake.yaml");
    s.commit("snap-test", startEvent("plan"), startSnapshot("plan"));

    const snap = s.readSnapshot("snap-test");
    expect(snap).not.toBeNull();
    expect(snap?.run_id).toBe("snap-test");
    expect(snap?.run_status).toBe("active");
    expect(snap?.state).toBe("plan");
    expect(snap?.last_seq).toBe(1);
    expect(typeof snap?.updated_at).toBe("string");
  });
});

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

  test("stores metadata when provided", () => {
    const s = freshStore();
    s.initRun("meta-ev", "/fake.yaml");
    const { event } = s.commit(
      "meta-ev",
      { ...startEvent("plan"), metadata: { key: "value" } },
      startSnapshot("plan"),
    );
    expect(event.metadata).toEqual({ key: "value" });
  });

  test("throws for non-existent run", () => {
    const s = freshStore();
    expect(() =>
      s.commit("ghost", startEvent("plan"), startSnapshot("plan")),
    ).toThrow();
  });
});

describe("Store — readEvents", () => {
  test("returns empty array when no events", () => {
    const s = freshStore();
    s.initRun("no-events", "/fake.yaml");
    expect(s.readEvents("no-events")).toEqual([]);
  });

  test("returns all events in order", () => {
    const s = freshStore();
    s.initRun("multi", "/fake.yaml");
    s.commit("multi", startEvent("plan"), startSnapshot("plan"));
    s.commit("multi", gotoEvent("plan", "coding", "approved"), gotoSnapshot("coding"));
    s.commit("multi", gotoEvent("coding", "done", "tests pass"), {
      run_status: "completed",
      state: "done",
    });

    const events = s.readEvents("multi");
    expect(events).toHaveLength(3);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
    expect(events[2].seq).toBe(3);
    expect(events[0].event).toBe("start");
    expect(events[1].event).toBe("goto");
    expect(events[2].event).toBe("goto");
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

  test("finish produces aborted snapshot", () => {
    const s = freshStore();
    s.initRun("abort", "/fake.yaml");
    s.commit("abort", startEvent("plan"), startSnapshot("plan"));
    const { snapshot } = s.commit(
      "abort",
      {
        event: "finish",
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
});

describe("Store — session management", () => {
  test("bindSession writes and readSession returns it", () => {
    const s = freshStore();
    s.bindSession("sess-1", "run-abc");
    expect(s.readSession("sess-1")).toBe("run-abc");
  });

  test("readSession returns null for unbound session", () => {
    const s = freshStore();
    expect(s.readSession("nonexistent")).toBeNull();
  });

  test("unbindSession removes binding", () => {
    const s = freshStore();
    s.bindSession("sess-2", "run-xyz");
    s.unbindSession("sess-2");
    expect(s.readSession("sess-2")).toBeNull();
  });

  test("unbindSession no-ops for missing session", () => {
    const s = freshStore();
    expect(() => s.unbindSession("ghost")).not.toThrow();
  });

  test("readCounter returns 0 for new session", () => {
    const s = freshStore();
    expect(s.readCounter("sess-new")).toBe(0);
  });

  test("writeCounter persists and readCounter retrieves", () => {
    const s = freshStore();
    s.writeCounter("sess-c", 7);
    expect(s.readCounter("sess-c")).toBe(7);
  });

  test("unbindSession also removes counter", () => {
    const s = freshStore();
    s.bindSession("sess-clean", "run-1");
    s.writeCounter("sess-clean", 3);
    s.unbindSession("sess-clean");
    expect(s.readCounter("sess-clean")).toBe(0);
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
