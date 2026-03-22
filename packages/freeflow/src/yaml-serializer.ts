import { dump } from "js-yaml";
import type { Fsm } from "./fsm.js";

/**
 * Serialize an Fsm object to a YAML string.
 *
 * Multi-line strings (prompts, guides) use YAML block scalar style (`|`).
 * Optional fields (guide, allowed_tools, todos, per-state guide) are omitted when absent.
 */
export function serializeYaml(fsm: Fsm): string {
  const doc: Record<string, unknown> = {
    version: fsm.version,
  };

  if (fsm.guide !== undefined) {
    doc.guide = fsm.guide;
  }

  doc.initial = fsm.initial;

  if (fsm.allowed_tools !== undefined) {
    doc.allowed_tools = fsm.allowed_tools;
  }

  const states: Record<string, Record<string, unknown>> = {};
  for (const [name, state] of Object.entries(fsm.states)) {
    const s: Record<string, unknown> = {
      prompt: state.prompt,
    };
    if (state.todos !== undefined) {
      s.todos = state.todos;
    }
    if (state.guide !== undefined) {
      s.guide = state.guide;
    }
    s.transitions = state.transitions;
    states[name] = s;
  }
  doc.states = states;

  return dump(doc, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
}
