import { describe, expect, test } from "vitest";
import type { FsmState } from "../fsm.js";
import { type StateCard, formatSubagentDispatch, stateCardFromFsm } from "../output.js";

function makeCard(overrides: Partial<StateCard> = {}): StateCard {
  return {
    state: "execute",
    prompt: "Run the implementation steps.",
    todos: null,
    transitions: { done: "done" },
    ...overrides,
  };
}

describe("formatSubagentDispatch", () => {
  test("Test 5: renders dispatch instructions for subagent state", () => {
    const card = makeCard({ subagent: true });
    const out = formatSubagentDispatch(card, "run-123");

    expect(out).toContain("subagent execution");
    expect(out).toContain("fflow current --run-id run-123");
    expect(out).toContain("Execution Summary");
    expect(out).toContain("Proposed Transition");
    expect(out).toContain("done → done");
  });
});

describe("stateCardFromFsm subagent flag", () => {
  test("Test 7c: preserves explicit subagent: false", () => {
    const fsmState: FsmState = {
      prompt: "Do the work.",
      transitions: { done: "done" },
      subagent: false,
    };
    const card = stateCardFromFsm("execute", fsmState);

    expect(card.subagent).toBe(false);
  });
});
