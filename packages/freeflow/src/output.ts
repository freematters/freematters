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
  if (fsmState.subagent) {
    card.subagent = fsmState.subagent;
  }
  return card;
}

const TODO_HEADER =
  "You MUST create a task for each of these items and complete them in order:";

export function formatStateCard(card: StateCard, fsmGuide?: string): string {
  const lines: string[] = [];

  // State-level guide takes precedence over FSM-level guide
  const guide = card.guide ?? fsmGuide;
  if (guide) {
    lines.push(guide);
    lines.push("");
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
    lines.push("");
    lines.push(
      "IMPORTANT: Execute this state's instructions NOW. " +
        "Do NOT stop or wait for user input between states. " +
        "Only terminal states (no transitions) end the workflow.",
    );
  }

  return lines.join("\n");
}

// --- Subagent Dispatch ---

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
  lines.push("Run `fflow current` to review full instructions.");

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
