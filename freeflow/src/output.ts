import { CliError } from "./errors.js";
import type { FsmState } from "./fsm.js";
import { FsmError } from "./fsm.js";

// --- State Card (human-readable) ---

export interface StateCard {
  state: string;
  prompt: string;
  todos: string[] | null;
  transitions: Record<string, string>;
}

export function stateCardFromFsm(stateName: string, fsmState: FsmState): StateCard {
  return {
    state: stateName,
    prompt: fsmState.prompt,
    todos: fsmState.todos ?? null,
    transitions: fsmState.transitions,
  };
}

const TODO_HEADER =
  "You MUST create a task for each of these items and complete them in order:";

export function formatStateCard(card: StateCard): string {
  const lines: string[] = [];
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
    lines.push("");
    lines.push(
      "IMPORTANT: Execute this state's instructions NOW. " +
        "Do NOT stop or wait for user input between states. " +
        "Only terminal states (no transitions) end the workflow.",
    );
  }

  return lines.join("\n");
}

// --- Reminder (PostToolUse hook) ---

const REMINDER_PROMPT_MAX = 200;

export function formatReminder(card: StateCard): string {
  const lines: string[] = [];
  lines.push(`[FSM Reminder] State: ${card.state}`);
  lines.push("");

  let prompt = card.prompt.trim();
  if (prompt.length > REMINDER_PROMPT_MAX) {
    prompt = `${prompt.slice(0, REMINDER_PROMPT_MAX)}...`;
  }
  lines.push(prompt);

  if (card.todos && card.todos.length > 0) {
    lines.push("");
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

// --- Duration Formatting ---

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

// --- Graph Visualization (Mermaid) ---

export function fsmToMermaid(
  states: Record<string, { transitions: Record<string, string> }>,
  initial: string,
): string {
  const lines: string[] = [];
  lines.push("stateDiagram-v2");
  lines.push(`  [*] --> ${initial}`);

  for (const [name, state] of Object.entries(states)) {
    for (const [label, target] of Object.entries(state.transitions)) {
      lines.push(`  ${name} --> ${target}: ${label}`);
    }
    if (Object.keys(state.transitions).length === 0) {
      lines.push(`  ${name} --> [*]`);
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
