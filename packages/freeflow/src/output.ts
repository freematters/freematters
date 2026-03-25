import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { CliError } from "./errors.js";
import type { FsmState } from "./fsm.js";
import { FsmError } from "./fsm.js";

// --- State Card (human-readable) ---

export interface StateCard {
  state: string;
  prompt: string;
  todos: string[] | null;
  transitions: Record<string, string>;
  guide?: string;
  subagent?: boolean;
}

export function stateCardFromFsm(stateName: string, fsmState: FsmState): StateCard {
  const card: StateCard = {
    state: stateName,
    prompt: fsmState.prompt,
    todos: fsmState.todos ?? null,
    transitions: fsmState.transitions,
  };
  if (fsmState.guide) {
    card.guide = fsmState.guide;
  }
  if (fsmState.subagent !== undefined) {
    card.subagent = fsmState.subagent;
  }
  return card;
}

const TODO_HEADER =
  "You MUST create a task for each of these items and complete them in order:";

export interface StateCardOptions {
  includeGuide?: boolean; // default true
}

export function formatStateCard(
  card: StateCard,
  fsmGuide?: string,
  options?: StateCardOptions,
): string {
  const lines: string[] = [];
  const includeGuide = options?.includeGuide ?? true;

  // State-level guide takes precedence over FSM-level guide
  if (includeGuide) {
    const guide = card.guide ?? fsmGuide;
    if (guide) {
      lines.push(guide);
      lines.push("");
    }
  }

  lines.push(`You are in **${card.state}** state.`);
  lines.push("");
  lines.push("Your instructions:");
  lines.push(card.prompt);

  if (card.todos && card.todos.length > 0) {
    lines.push(TODO_HEADER);
    for (const t of card.todos) {
      lines.push(`  - ${t}`);
    }
    lines.push("");
  }

  const entries = Object.entries(card.transitions);
  if (entries.length === 0) {
    lines.push("This is a terminal state. The workflow is complete.");
  } else {
    lines.push("After finish, the allowed state transitions are:");
    for (const [label, target] of entries) {
      lines.push(`  ${label} → ${target}`);
    }
  }

  return lines.join("\n");
}

// --- Subagent Dispatch Card ---

export function formatSubagentDispatch(
  card: StateCard,
  runId: string,
  fsmGuide?: string,
): string {
  const lines: string[] = [];

  const guide = card.guide ?? fsmGuide;
  if (guide) {
    lines.push(guide);
    lines.push("");
  }

  lines.push(`You are in **${card.state}** state. This state uses subagent execution.`);
  lines.push("");
  lines.push("Spawn a subagent with the following instructions:");
  lines.push(`1. Run \`fflow current --run-id ${runId}\` to get your instructions`);
  lines.push("2. Execute the instructions fully");
  lines.push("3. When done, report back using this exact format:");
  lines.push("");
  lines.push("## Execution Summary");
  lines.push("<describe what was accomplished>");
  lines.push("");
  lines.push("## Proposed Transition");
  lines.push('label: "<transition label>"');
  lines.push("reason: <why this transition>");
  lines.push("");

  const entries = Object.entries(card.transitions);
  if (entries.length > 0) {
    lines.push("Valid transitions from this state:");
    for (const [label, target] of entries) {
      lines.push(`  ${label} → ${target}`);
    }
    lines.push("");
  }

  lines.push(
    "After the subagent reports back, validate the proposed transition label against the valid transitions above, then run:",
  );
  lines.push(`  fflow goto <target> --run-id ${runId} --on "<label>"`);

  return lines.join("\n");
}

// --- Lite Card (re-entered state) ---

export function formatLiteCard(card: StateCard): string {
  const lines: string[] = [];

  lines.push(
    `Re-entering **${card.state}** state. Instructions unchanged from previous visit.`,
  );
  lines.push("Run `fflow current` to review full instructions if you forget.");

  if (card.todos && card.todos.length > 0) {
    lines.push("");
    lines.push(TODO_HEADER);
    for (const t of card.todos) {
      lines.push(`  - ${t}`);
    }
  }

  const entries = Object.entries(card.transitions);
  if (entries.length === 0) {
    lines.push("");
    lines.push("This is a terminal state. The workflow is complete.");
  } else {
    lines.push("");
    lines.push("Transitions:");
    for (const [label, target] of entries) {
      lines.push(`  ${label} → ${target}`);
    }
    lines.push("");
    lines.push(
      "Keep driving the workflow — do NOT stop until you reach a terminal state.",
    );
  }

  return lines.join("\n");
}

// --- Reminder (PostToolUse hook) ---

export function formatReminder(card: StateCard, fsmGuide?: string): string {
  const lines: string[] = [];
  lines.push(`[FSM Reminder] State: ${card.state}`);
  lines.push("");

  // State-level guide takes precedence over FSM-level guide
  const guide = card.guide ?? fsmGuide;
  if (guide) {
    lines.push(guide);
    lines.push("");
  }

  if (card.todos && card.todos.length > 0) {
    lines.push(TODO_HEADER);
    for (const t of card.todos) {
      lines.push(`  - ${t}`);
    }
  }

  const entries = Object.entries(card.transitions);
  if (entries.length > 0) {
    lines.push("");
    lines.push("Transitions:");
    for (const [label, target] of entries) {
      lines.push(`  ${label} → ${target}`);
    }
    lines.push("");
    lines.push(
      "Keep driving the workflow — do NOT stop until you reach a terminal state.",
    );
  }

  return lines.join("\n");
}

// --- Markdown Rendering ---

function createMarked(): Marked {
  const ext = markedTerminal() as unknown as {
    renderer: Record<string, (...args: unknown[]) => string>;
    useNewRenderer: boolean;
  };

  // Workaround for marked-terminal@7.3.0: inline tokens (bold, italic, etc.)
  // inside list items are not rendered. The `text` renderer receives the raw
  // `text` property instead of recursing into `tokens`. Override it to call
  // parseInline when inline children exist.
  // Upstream issue: https://github.com/mikaelbr/marked-terminal/issues/236
  // Remove this workaround when the upstream fix is released.
  const origText = ext.renderer?.text;
  if (typeof origText !== "function") {
    // marked-terminal API changed — skip patch, fall back to default rendering
    return new Marked(ext as never);
  }
  ext.renderer.text = function (
    this: { parser: { parseInline: (tokens: unknown[]) => string } },
    token: unknown,
  ) {
    if (
      typeof token === "object" &&
      token !== null &&
      "tokens" in token &&
      Array.isArray((token as { tokens?: unknown[] }).tokens) &&
      (token as { tokens: unknown[] }).tokens.length > 0
    ) {
      return this.parser.parseInline((token as { tokens: unknown[] }).tokens);
    }
    return origText.call(this, token);
  };

  // Replace * bullet with - for unordered lists
  const origList = ext.renderer.list;
  if (typeof origList === "function") {
    ext.renderer.list = function (this: unknown, ...args: unknown[]) {
      const result = origList.call(this, ...args) as string;
      return result.replace(/^( *)(\* )/gm, "$1- ");
    };
  }

  return new Marked(ext as never);
}

const marked = createMarked();

export function renderMarkdown(text: string): string {
  return (marked.parse(text) as string).trimEnd();
}

// --- Duration Formatting ---

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// --- Graph Visualization (Mermaid) ---

/**
 * Sanitize a state name for mermaid stateDiagram-v2.
 * Mermaid doesn't allow hyphens or slashes in bare state IDs.
 * Replace them with underscores.
 */
function mermaidId(name: string): string {
  return name.replace(/[-/]/g, "_");
}

export function fsmToMermaid(
  states: Record<string, { transitions: Record<string, string> }>,
  initial: string,
): string {
  const lines: string[] = [];
  lines.push("stateDiagram-v2");

  // Declare state aliases for names that need sanitizing
  const declared = new Set<string>();
  for (const name of [...Object.keys(states), initial]) {
    const id = mermaidId(name);
    if (id !== name && !declared.has(id)) {
      lines.push(`  ${id}: ${name}`);
      declared.add(id);
    }
  }

  lines.push(`  [*] --> ${mermaidId(initial)}`);

  for (const [name, state] of Object.entries(states)) {
    for (const [label, target] of Object.entries(state.transitions)) {
      lines.push(`  ${mermaidId(name)} --> ${mermaidId(target)}: ${label}`);
    }
    if (Object.keys(state.transitions).length === 0) {
      lines.push(`  ${mermaidId(name)} --> [*]`);
    }
  }

  return lines.join("\n");
}

// --- JSON Envelope ---

export interface JsonEnvelope {
  ok: boolean;
  code: string | null;
  message: string;
  data: Record<string, unknown> | null;
}

export function jsonSuccess(
  message: string,
  data: Record<string, unknown>,
): JsonEnvelope {
  return { ok: true, code: null, message, data };
}

export function jsonError(
  code: string,
  message: string,
  data?: Record<string, unknown> | null,
): JsonEnvelope {
  return { ok: false, code, message, data: data ?? null };
}

// --- Output helpers ---

export function printJson(envelope: JsonEnvelope): void {
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function handleError(err: unknown, json: boolean): never {
  if (err instanceof CliError) {
    if (json) {
      printJson(jsonError(err.code, err.message, err.data));
    } else {
      process.stderr.write(`${err.formatHuman()}\n`);
    }
    process.exit(2);
  }
  if (err instanceof FsmError) {
    if (json) {
      printJson(jsonError(err.code, err.message));
    } else {
      process.stderr.write(`Error: ${err.message}\n`);
    }
    process.exit(2);
  }
  throw err;
}
