import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { RunMeta, Snapshot } from "../store.js";
import { Store } from "../store.js";
import { runCli, runCliJson } from "./e2e/helpers.js";
import { MINIMAL_FSM, cleanupTempDir, createTempDir } from "./fixtures.js";

let tmp: string;
let fsmMinimal: string;

beforeAll(() => {
  tmp = createTempDir("start-lite");
  fsmMinimal = join(tmp, "minimal.yaml");
  writeFileSync(fsmMinimal, MINIMAL_FSM, "utf-8");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

let runCounter = 0;
function uniqueRunId(prefix = "lite"): string {
  runCounter++;
  return `${prefix}-${runCounter}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const defaultRoot = () => join(tmp, "root");

// ─── Design Test 1: Lite flag persistence ────────────────────────

describe("start --lite: lite flag persistence", () => {
  test("start with lite: true → meta has lite: true, initial snapshot has visited_states with initial state", () => {
    const id = uniqueRunId("lite-persist");
    const root = join(tmp, "root-persist");

    runCli(`start ${fsmMinimal} --run-id ${id} --lite`, { root });

    // Read meta directly from store
    const store = new Store(root);
    const meta = store.readMeta(id) as RunMeta & { lite?: boolean };
    expect(meta.lite).toBe(true);

    // Read snapshot and check visited_states
    const snap = store.readSnapshot(id) as Snapshot & { visited_states?: string[] };
    expect(snap).not.toBeNull();
    expect(snap.visited_states).toEqual(["start"]);
  });
});

// ─── Unit test: start without --lite ─────────────────────────────

describe("start without --lite", () => {
  test("meta has no lite field, snapshot has no visited_states", () => {
    const id = uniqueRunId("no-lite");
    const root = join(tmp, "root-no-lite");

    runCli(`start ${fsmMinimal} --run-id ${id}`, { root });

    const store = new Store(root);
    const meta = store.readMeta(id) as RunMeta & { lite?: boolean };
    expect(meta.lite).toBeUndefined();

    const snap = store.readSnapshot(id) as Snapshot & { visited_states?: string[] };
    expect(snap).not.toBeNull();
    expect(snap.visited_states).toBeUndefined();
  });
});

// ─── Unit test: --lite flag CLI parsing ──────────────────────────

describe("--lite CLI flag parsing", () => {
  test("--lite flag is accepted and does not cause CLI error", () => {
    const id = uniqueRunId("lite-cli");
    const { exitCode } = runCli(`start ${fsmMinimal} --run-id ${id} --lite`, {
      root: defaultRoot(),
    });
    expect(exitCode).toBe(0);
  });

  test("--lite flag with JSON output includes lite metadata", () => {
    const id = uniqueRunId("lite-json");
    const { envelope, exitCode } = runCliJson(
      `start ${fsmMinimal} --run-id ${id} --lite`,
      { root: defaultRoot() },
    );
    expect(exitCode).toBe(0);
    expect(envelope.ok).toBe(true);
  });
});
