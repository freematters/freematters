import { describe, expect, test } from "vitest";
import type { FsmState } from "../fsm.js";
import {
  type StateCard,
  formatStateCard,
  formatSubagentDispatch,
  stateCardFromFsm,
} from "../output.js";

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

describe("formatStateCard with subagent", () => {
  test("Test 6: formatStateCard unchanged for subagent states", () => {
    const card = makeCard({ subagent: true });
    const out = formatStateCard(card);

    // Normal state card content should be present
    expect(out).toContain("execute");
    expect(out).toContain("Run the implementation steps.");
    expect(out).toContain("done → done");
    // Should NOT contain subagent dispatch instructions
    expect(out).not.toContain("subagent execution");
  });
});

describe("stateCardFromFsm subagent flag", () => {
  test("Test 7: preserves subagent flag when present", () => {
    const fsmState: FsmState = {
      prompt: "Do the work.",
      transitions: { done: "done" },
      subagent: true,
    };
    const card = stateCardFromFsm("execute", fsmState);

    expect(card.subagent).toBe(true);
  });

  test("Test 7b: does not set subagent when flag absent", () => {
    const fsmState: FsmState = {
      prompt: "Do the work.",
      transitions: { done: "done" },
    };
    const card = stateCardFromFsm("execute", fsmState);

    expect(card.subagent).toBeUndefined();
  });
});
