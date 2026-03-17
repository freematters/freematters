import { describe, expect, test } from "vitest";
import { enumeratePaths } from "../../e2e/path-enumerator.js";
import type { Fsm } from "../../fsm.js";

function makeFsm(
  initial: string,
  states: Record<string, { transitions: Record<string, string> }>,
): Fsm {
  const fsmStates: Fsm["states"] = {};
  for (const [name, s] of Object.entries(states)) {
    fsmStates[name] = { prompt: `Prompt for ${name}`, transitions: s.transitions };
  }
  return { version: 1, initial, states: fsmStates };
}

describe("enumeratePaths", () => {
  test("linear FSM produces one path", () => {
    const fsm = makeFsm("start", {
      start: { transitions: { next: "middle" } },
      middle: { transitions: { next: "done" } },
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    expect(paths).toHaveLength(1);
    expect(paths[0].states).toEqual(["start", "middle", "done"]);
    expect(paths[0].transitions).toEqual(["next", "next"]);
  });

  test("branching FSM produces multiple paths", () => {
    const fsm = makeFsm("start", {
      start: { transitions: { approve: "review", reject: "done" } },
      review: { transitions: { finish: "done" } },
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    expect(paths).toHaveLength(2);

    const stateSequences = paths.map((p) => p.states);
    expect(stateSequences).toContainEqual(["start", "review", "done"]);
    expect(stateSequences).toContainEqual(["start", "done"]);
  });

  test("single-state FSM (just done) produces one trivial path", () => {
    // Edge case: initial is done
    const fsm = makeFsm("done", {
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    expect(paths).toHaveLength(1);
    expect(paths[0].states).toEqual(["done"]);
    expect(paths[0].transitions).toEqual([]);
  });

  test("cycle is handled — does not visit same state twice in a path", () => {
    const fsm = makeFsm("a", {
      a: { transitions: { forward: "b", skip: "done" } },
      b: { transitions: { back: "a", forward: "done" } },
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    // Should not hang; should produce finite paths
    expect(paths.length).toBeGreaterThanOrEqual(2);
    // No path should contain duplicate states
    for (const p of paths) {
      const unique = new Set(p.states);
      expect(unique.size).toBe(p.states.length);
    }
  });

  test("each path has name based on transitions", () => {
    const fsm = makeFsm("start", {
      start: { transitions: { go: "done" } },
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    expect(paths).toHaveLength(1);
    expect(paths[0].name).toBe("start -> done");
  });

  test("diamond FSM enumerates all distinct paths to done", () => {
    const fsm = makeFsm("start", {
      start: { transitions: { left: "a", right: "b" } },
      a: { transitions: { merge: "done" } },
      b: { transitions: { merge: "done" } },
      done: { transitions: {} },
    });

    const paths = enumeratePaths(fsm);
    expect(paths).toHaveLength(2);
    const stateSequences = paths.map((p) => p.states);
    expect(stateSequences).toContainEqual(["start", "a", "done"]);
    expect(stateSequences).toContainEqual(["start", "b", "done"]);
  });
});
