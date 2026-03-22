import { dump, load as yamlLoad } from "js-yaml";
import type { Fsm } from "./fsm.js";
import { fsmToMermaid } from "./output.js";

export interface SerializeMarkdownOptions {
  /** Title for the h1 heading. Defaults to "Workflow". */
  title?: string;
}

/**
 * Serialize an Fsm object into markdown workflow format.
 * Generates frontmatter, state machine mermaid diagram, and state sections.
 */
export function serializeMarkdown(fsm: Fsm, opts?: SerializeMarkdownOptions): string {
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
  lines.push(`# ${opts?.title ?? "Workflow"}`);
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

  // 5. State sections (order: Transitions → Instructions → Todos)
  for (const [name, state] of Object.entries(fsm.states)) {
    lines.push(`## State: ${name}`);
    lines.push("");

    // Transitions (first — gives quick overview of state's exits)
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

    // Todos (last)
    if (state.todos && state.todos.length > 0) {
      lines.push("### Todos");
      lines.push("");
      for (const todo of state.todos) {
        lines.push(`- ${todo}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// --- Raw state type for unresolved YAML ---

interface RawState {
  prompt?: string;
  todos?: string[];
  append_todos?: string[];
  transitions?: Record<string, string>;
  guide?: string;
  from?: string;
  workflow?: string;
}

/**
 * Convert raw YAML workflow content to markdown, preserving `from:`, `workflow:`,
 * `extends_guide`, and `append_todos` directives as `<freeflow>` tags.
 * Unlike `serializeMarkdown()`, this does NOT go through `loadFsm()` resolution.
 */
export function serializeRawYamlToMarkdown(
  yamlContent: string,
  opts?: SerializeMarkdownOptions,
): string {
  const doc = yamlLoad(yamlContent) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") {
    throw new Error("YAML must be a mapping");
  }

  const lines: string[] = [];

  // 1. Frontmatter (extends_guide goes in body, not frontmatter)
  const frontmatter: Record<string, unknown> = {};
  if (doc.version !== undefined) frontmatter.version = doc.version;
  if (doc.initial !== undefined) frontmatter.initial = doc.initial;
  if (doc.allowed_tools !== undefined) frontmatter.allowed_tools = doc.allowed_tools;
  lines.push("---");
  lines.push(dump(frontmatter, { lineWidth: -1 }).trimEnd());
  lines.push("---");
  lines.push("");

  // 2. Title
  lines.push(`# ${opts?.title ?? "Workflow"}`);
  lines.push("");

  // 3. State Machine mermaid (from raw transitions, skip workflow: states)
  const rawStates = (doc.states ?? {}) as Record<string, RawState>;
  const initial = doc.initial as string;
  const mermaidStates: Record<string, { transitions: Record<string, string> }> = {};
  for (const [name, st] of Object.entries(rawStates)) {
    mermaidStates[name] = { transitions: st?.transitions ?? {} };
  }
  lines.push("## State Machine");
  lines.push("");
  lines.push("```mermaid");
  lines.push(fsmToMermaid(mermaidStates, initial));
  lines.push("```");
  lines.push("");

  // 4. Guide
  if (typeof doc.guide === "string" && doc.guide.length > 0) {
    lines.push("## Guide");
    lines.push("");
    if (doc.extends_guide) {
      lines.push(
        `<freeflow extends-guide="${doc.extends_guide}">*Extends guide from: ${doc.extends_guide}*</freeflow>`,
      );
      lines.push("");
    }
    lines.push(doc.guide.trimEnd());
    lines.push("");
  } else if (doc.extends_guide) {
    lines.push("## Guide");
    lines.push("");
    lines.push(
      `<freeflow extends-guide="${doc.extends_guide}">*Extends guide from: ${doc.extends_guide}*</freeflow>`,
    );
    lines.push("");
  }

  // 5. States
  for (const [name, rawState] of Object.entries(rawStates)) {
    const state = rawState ?? ({} as RawState);
    lines.push(`## State: ${name}`);
    lines.push("");

    // from: directive → <freeflow from="...">readable text</freeflow>
    if (state.from) {
      lines.push(
        `<freeflow from="${state.from}">*Inherits from: ${state.from}*</freeflow>`,
      );
      lines.push("");
    }

    // workflow: directive → <freeflow workflow="...">readable text</freeflow>
    if (state.workflow) {
      lines.push(
        `<freeflow workflow="${state.workflow}">*Run workflow: ${state.workflow}*</freeflow>`,
      );
      lines.push("");
    }

    // Transitions (first)
    lines.push("### Transitions");
    lines.push("");
    const transitions = state.transitions ?? {};
    const entries = Object.entries(transitions);
    if (entries.length === 0) {
      lines.push("(none)");
    } else {
      for (const [label, target] of entries) {
        lines.push(`- ${label} \u2192 ${target}`);
      }
    }
    lines.push("");

    // Instructions (prompt)
    if (state.prompt) {
      lines.push("### Instructions");
      lines.push("");
      if (state.guide) {
        lines.push(state.guide.trimEnd());
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      lines.push(state.prompt.trimEnd());
      lines.push("");
    }

    // Todos
    if (state.todos && state.todos.length > 0) {
      lines.push("### Todos");
      lines.push("");
      for (const todo of state.todos) {
        lines.push(`- ${todo}`);
      }
      lines.push("");
    }

    // append_todos → <freeflow append-todos>
    if (state.append_todos && state.append_todos.length > 0) {
      lines.push("<freeflow append-todos>");
      for (const todo of state.append_todos) {
        lines.push(`- ${todo}`);
      }
      lines.push("</freeflow>");
      lines.push("");
    }
  }

  return lines.join("\n");
}
