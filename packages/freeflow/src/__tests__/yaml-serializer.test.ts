import { load as yamlLoad } from "js-yaml";
import { describe, expect, test } from "vitest";
import type { Fsm } from "../fsm.js";
import { serializeYaml } from "../yaml-serializer.js";

/** Build a minimal valid Fsm for testing. */
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

describe("serializeYaml", () => {
  test("minimal Fsm round-trips through YAML parse", () => {
    const fsm = minimalFsm();
    const yaml = serializeYaml(fsm);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;

    expect(parsed.version).toBe(1);
    expect(parsed.initial).toBe("start");
    expect(parsed).not.toHaveProperty("guide");
    expect(parsed).not.toHaveProperty("allowed_tools");

    const states = parsed.states as Record<string, Record<string, unknown>>;
    expect(states.start.prompt).toBe("Begin here.");
    expect(states.start.transitions).toEqual({ next: "done" });
    expect(states.done.prompt).toBe("Finished.");
    expect(states.done.transitions).toEqual({});
  });

  test("multi-line prompts use YAML block scalar style", () => {
    const fsm = minimalFsm();
    fsm.states.start.prompt = "Line one.\nLine two.\n";
    const yaml = serializeYaml(fsm);

    // Block scalar indicator: pipe character after "prompt:"
    expect(yaml).toMatch(/prompt:\s*\|/);

    // Round-trip preserves content
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    const states = parsed.states as Record<string, Record<string, unknown>>;
    expect(states.start.prompt).toBe("Line one.\nLine two.\n");
  });

  test("guide included only when present", () => {
    const fsm = minimalFsm();
    const yamlNoGuide = serializeYaml(fsm);
    expect(yamlNoGuide).not.toContain("guide:");

    fsm.guide = "A workflow guide.";
    const yamlWithGuide = serializeYaml(fsm);
    expect(yamlWithGuide).toContain("guide:");

    const parsed = yamlLoad(yamlWithGuide) as Record<string, unknown>;
    expect(parsed.guide).toBe("A workflow guide.");
  });

  test("multi-line guide uses block scalar style", () => {
    const fsm = minimalFsm();
    fsm.guide = "Guide line one.\nGuide line two.\n";
    const yaml = serializeYaml(fsm);

    // The top-level guide should use block scalar
    expect(yaml).toMatch(/^guide:\s*\|/m);

    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    expect(parsed.guide).toBe("Guide line one.\nGuide line two.\n");
  });

  test("allowed_tools included only when present", () => {
    const fsm = minimalFsm();
    const yamlNoTools = serializeYaml(fsm);
    expect(yamlNoTools).not.toContain("allowed_tools:");

    fsm.allowed_tools = ["Read", "Write", "Bash"];
    const yamlWithTools = serializeYaml(fsm);
    expect(yamlWithTools).toContain("allowed_tools:");

    const parsed = yamlLoad(yamlWithTools) as Record<string, unknown>;
    expect(parsed.allowed_tools).toEqual(["Read", "Write", "Bash"]);
  });

  test("terminal state has transitions: {}", () => {
    const fsm = minimalFsm();
    const yaml = serializeYaml(fsm);

    // The done state must have explicit empty transitions
    const parsed = yamlLoad(yaml) as Record<string, unknown>;
    const states = parsed.states as Record<string, Record<string, unknown>>;
    expect(states.done.transitions).toEqual({});
  });

  test("state guide included only when present", () => {
    const fsm = minimalFsm();
    const yamlNoStateGuide = serializeYaml(fsm);

    // No state-level guide in output
    const parsed1 = yamlLoad(yamlNoStateGuide) as Record<string, unknown>;
    const states1 = parsed1.states as Record<string, Record<string, unknown>>;
    expect(states1.start).not.toHaveProperty("guide");

    // Add state-level guide
    fsm.states.start.guide = "State-specific guidance.";
    const yamlWithStateGuide = serializeYaml(fsm);
    const parsed2 = yamlLoad(yamlWithStateGuide) as Record<string, unknown>;
    const states2 = parsed2.states as Record<string, Record<string, unknown>>;
    expect(states2.start.guide).toBe("State-specific guidance.");
  });

  test("todos included only when present", () => {
    const fsm = minimalFsm();
    const yamlNoTodos = serializeYaml(fsm);
    const parsed1 = yamlLoad(yamlNoTodos) as Record<string, unknown>;
    const states1 = parsed1.states as Record<string, Record<string, unknown>>;
    expect(states1.start).not.toHaveProperty("todos");

    fsm.states.start.todos = ["Write code", "Run tests"];
    const yamlWithTodos = serializeYaml(fsm);
    const parsed2 = yamlLoad(yamlWithTodos) as Record<string, unknown>;
    const states2 = parsed2.states as Record<string, Record<string, unknown>>;
    expect(states2.start.todos).toEqual(["Write code", "Run tests"]);
  });

  test("full Fsm with all optional fields round-trips", () => {
    const fsm: Fsm = {
      version: 1,
      guide: "Global guide.\nSecond line.\n",
      initial: "plan",
      allowed_tools: ["Read", "Bash"],
      states: {
        plan: {
          prompt: "Plan the work.\nBreak into tasks.\n",
          todos: ["Draft spec", "Review spec"],
          guide: "Per-state guide for planning.",
          transitions: { approved: "execute" },
        },
        execute: {
          prompt: "Do the work.",
          transitions: { complete: "done" },
        },
        done: {
          prompt: "All done.",
          transitions: {},
        },
      },
    };

    const yaml = serializeYaml(fsm);
    const parsed = yamlLoad(yaml) as Record<string, unknown>;

    expect(parsed.version).toBe(1);
    expect(parsed.guide).toBe("Global guide.\nSecond line.\n");
    expect(parsed.initial).toBe("plan");
    expect(parsed.allowed_tools).toEqual(["Read", "Bash"]);

    const states = parsed.states as Record<string, Record<string, unknown>>;
    expect(states.plan.prompt).toBe("Plan the work.\nBreak into tasks.\n");
    expect(states.plan.todos).toEqual(["Draft spec", "Review spec"]);
    expect(states.plan.guide).toBe("Per-state guide for planning.");
    expect(states.plan.transitions).toEqual({ approved: "execute" });
    expect(states.execute.prompt).toBe("Do the work.");
    expect(states.done.transitions).toEqual({});
  });
});
