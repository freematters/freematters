import { describe, expect, test } from "vitest";
import { type StateCard, formatReminder } from "../output.js";

describe("formatReminder", () => {
  test("formats basic state reminder", () => {
    const card: StateCard = {
      state: "Execute",
      prompt: "Implement according to plan.",
      todos: null,
      transitions: {
        "implementation complete": "Test",
        "plan incorrect": "Plan",
      },
    };
    const out = formatReminder(card);
    expect(out).toContain("[FSM Reminder]");
    expect(out).toContain("State: Execute");
    expect(out).toContain("Implement according to plan.");
    expect(out).toContain("implementation complete → Test");
    expect(out).toContain("plan incorrect → Plan");
  });

  test("includes todos when present", () => {
    const card: StateCard = {
      state: "Plan",
      prompt: "Plan the work.",
      todos: ["Write spec", "Review spec"],
      transitions: { approved: "Execute" },
    };
    const out = formatReminder(card);
    expect(out).toContain("Write spec");
    expect(out).toContain("Review spec");
  });

  test("truncates long prompts", () => {
    const longPrompt = "X".repeat(300);
    const card: StateCard = {
      state: "Long",
      prompt: longPrompt,
      todos: null,
      transitions: { next: "done" },
    };
    const out = formatReminder(card);
    expect(out.length).toBeLessThan(longPrompt.length + 200);
    expect(out).toContain("...");
  });

  test("handles empty transitions (done state)", () => {
    const card: StateCard = {
      state: "done",
      prompt: "All done.",
      todos: null,
      transitions: {},
    };
    const out = formatReminder(card);
    expect(out).toContain("done");
    expect(out).not.toContain("Transitions:");
  });
});
