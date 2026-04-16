import { describe, expect, test } from "vitest";
import type { Fsm } from "../fsm.js";
import { serializeMarkdown } from "../markdown-serializer.js";

function minimalFsm(): Fsm {
  return {
    version: 1,
    initial: "start",
    states: {
      start: {
        prompt: "Begin here.",
        transitions: { next: "done" },
      },
      done: {
        prompt: "Finished.",
        transitions: {},
      },
    },
  };
}

describe("serializeMarkdown", () => {
  test("frontmatter includes allowed_tools only when present", () => {
    const fsm = minimalFsm();
    const mdWithout = serializeMarkdown(fsm);
    expect(mdWithout).not.toContain("allowed_tools");

    fsm.allowed_tools = ["Read", "Write"];
    const mdWith = serializeMarkdown(fsm);
    expect(mdWith).toContain("allowed_tools");
    expect(mdWith).toContain("- Read");
    expect(mdWith).toContain("- Write");
  });

  test("Guide section present only when fsm.guide is set", () => {
    const fsm = minimalFsm();
    const mdNoGuide = serializeMarkdown(fsm);
    expect(mdNoGuide).not.toContain("## Guide");

    fsm.guide = "Follow these rules for all states.";
    const mdWithGuide = serializeMarkdown(fsm);
    expect(mdWithGuide).toContain("## Guide");
    expect(mdWithGuide).toContain("Follow these rules for all states.");
  });

  test("todos appear as list items under ### Todos", () => {
    const fsm = minimalFsm();
    fsm.states.start.todos = ["Write code", "Run tests"];
    const md = serializeMarkdown(fsm);

    const startSection = md.slice(
      md.indexOf("## State: start"),
      md.indexOf("## State: done"),
    );
    expect(startSection).toContain("### Todos");
    expect(startSection).toContain("- Write code");
    expect(startSection).toContain("- Run tests");
  });

  test("state-level guide is prepended to Instructions with separator", () => {
    const fsm = minimalFsm();
    fsm.states.start.guide = "State-specific guidance here.";
    const md = serializeMarkdown(fsm);

    const startSection = md.slice(
      md.indexOf("## State: start"),
      md.indexOf("## State: done"),
    );
    expect(startSection).toContain("### Instructions");
    // Guide should come before the prompt
    const instructionsIdx = startSection.indexOf("### Instructions");
    const guideIdx = startSection.indexOf(
      "State-specific guidance here.",
      instructionsIdx,
    );
    const promptIdx = startSection.indexOf("Begin here.", instructionsIdx);
    expect(guideIdx).toBeLessThan(promptIdx);
    // Separator between guide and prompt
    const between = startSection.slice(
      guideIdx + "State-specific guidance here.".length,
      promptIdx,
    );
    expect(between).toContain("---");
  });
});
