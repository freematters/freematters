import { dump } from "js-yaml";
import type { Fsm } from "./fsm.js";
import { fsmToMermaid } from "./output.js";

/**
 * Serialize an Fsm object into markdown workflow format.
 * Generates frontmatter, state machine mermaid diagram, and state sections.
 */
export function serializeMarkdown(fsm: Fsm): string {
  const lines: string[] = [];

  // 1. YAML frontmatter
  const frontmatter: Record<string, unknown> = {
    version: fsm.version,
    initial: fsm.initial,
  };
  if (fsm.allowed_tools) {
    frontmatter.allowed_tools = fsm.allowed_tools;
  }
  lines.push("---");
  lines.push(dump(frontmatter, { lineWidth: -1 }).trimEnd());
  lines.push("---");
  lines.push("");

  // 2. Title
  lines.push("# Workflow");
  lines.push("");

  // 3. State Machine mermaid diagram
  lines.push("## State Machine");
  lines.push("");
  lines.push("```mermaid");
  lines.push(fsmToMermaid(fsm.states, fsm.initial));
  lines.push("```");
  lines.push("");

  // 4. Guide (if present)
  if (fsm.guide) {
    lines.push("## Guide");
    lines.push("");
    lines.push(fsm.guide);
    lines.push("");
  }

  // 5. State sections
  for (const [name, state] of Object.entries(fsm.states)) {
    lines.push(`## State: ${name}`);
    lines.push("");

    // Instructions (skip for delegation states with no prompt)
    if (state.prompt) {
      lines.push("### Instructions");
      lines.push("");
      if (state.guide) {
        lines.push(state.guide);
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      lines.push(state.prompt);
      lines.push("");
    }

    // Todos (only if present)
    if (state.todos && state.todos.length > 0) {
      lines.push("### Todos");
      lines.push("");
      for (const todo of state.todos) {
        lines.push(`- ${todo}`);
      }
      lines.push("");
    }

    // Transitions
    lines.push("### Transitions");
    lines.push("");
    const entries = Object.entries(state.transitions);
    if (entries.length === 0) {
      lines.push("(none)");
    } else {
      for (const [label, target] of entries) {
        lines.push(`- ${label} \u2192 ${target}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
