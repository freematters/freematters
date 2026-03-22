import { describe, expect, test } from "vitest";
import { type StateCard, formatLiteCard, formatReminder } from "../output.js";

function makeCard(overrides: Partial<StateCard> = {}): StateCard {
  return {
    state: "requirements",
    prompt: "Gather requirements from the user. Ask clarifying questions.",
    todos: ["ask questions", "summarize findings"],
    transitions: { done: "design" },
    ...overrides,
  };
}

describe("formatLiteCard", () => {
  test("Design Test 5: output structure — contains Re-entering, todo, transition, fflow current hint; does NOT contain prompt", () => {
    const card = makeCard();
    const out = formatLiteCard(card);

    expect(out).toContain("Re-entering **requirements**");
    expect(out).toContain("fflow current");
    expect(out).toContain("ask questions");
    expect(out).toContain("summarize findings");
    expect(out).toContain("done → design");
    // Must NOT contain the prompt
    expect(out).not.toContain("Gather requirements");
    expect(out).not.toContain("clarifying questions");
  });

  test("with no todos omits the todo section", () => {
    const card = makeCard({ todos: null });
    const out = formatLiteCard(card);

    expect(out).toContain("Re-entering **requirements**");
    expect(out).toContain("done → design");
    expect(out).not.toContain("MUST create a task");
  });

  test("with empty transitions shows terminal state message", () => {
    const card = makeCard({ transitions: {} });
    const out = formatLiteCard(card);

    expect(out).toContain("Re-entering **requirements**");
    expect(out).toContain("terminal state");
    expect(out).not.toContain("Keep driving");
  });
});

describe("formatReminder (simplified)", () => {
  test("Design Test 6: contains state name, transitions, todos; does NOT contain any prompt text", () => {
    const longPrompt =
      "This is a very long prompt that should not appear in the reminder output. " +
      "It contains detailed instructions about gathering requirements and asking questions.";
    const card = makeCard({ prompt: longPrompt });
    const out = formatReminder(card);

    expect(out).toContain("requirements");
    expect(out).toContain("done → design");
    expect(out).toContain("ask questions");
    expect(out).toContain("summarize findings");
    // Must NOT contain any part of the prompt
    expect(out).not.toContain("very long prompt");
    expect(out).not.toContain("gathering requirements");
    expect(out).not.toContain("detailed instructions");
  });

  test("with guide — guide is still included", () => {
    const card = makeCard({ guide: "Always follow the coding standards." });
    const out = formatReminder(card);

    expect(out).toContain("Always follow the coding standards.");
    expect(out).toContain("requirements");
    expect(out).toContain("done → design");
  });

  test("with fsmGuide — fsmGuide is still included when no state guide", () => {
    const card = makeCard();
    const out = formatReminder(card, "Global workflow guide.");

    expect(out).toContain("Global workflow guide.");
  });
});
