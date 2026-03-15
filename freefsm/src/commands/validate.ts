import { existsSync } from "node:fs";
import { CliError } from "../errors.js";
import { type Fsm, FsmError, loadFsm } from "../fsm.js";
import { handleError, jsonSuccess, printJson } from "../output.js";

export interface ValidateArgs {
  fsmPath: string;
  json: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: FsmStats;
}

interface FsmStats {
  total_states: number;
  total_transitions: number;
  terminal_states: string[];
  unreachable_states: string[];
  max_depth: number;
  has_cycles: boolean;
}

function findUnreachableStates(fsm: Fsm): string[] {
  const reachable = new Set<string>();
  const queue: string[] = [fsm.initial];
  reachable.add(fsm.initial);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const state = fsm.states[current];
    if (!state) continue;

    for (const target of Object.values(state.transitions)) {
      if (!reachable.has(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }

  return Object.keys(fsm.states).filter((name) => !reachable.has(name));
}

function detectCycles(fsm: Fsm): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(state: string): boolean {
    if (inStack.has(state)) return true;
    if (visited.has(state)) return false;

    visited.add(state);
    inStack.add(state);

    const fsmState = fsm.states[state];
    if (fsmState) {
      for (const target of Object.values(fsmState.transitions)) {
        if (dfs(target)) return true;
      }
    }

    inStack.delete(state);
    return false;
  }

  for (const state of Object.keys(fsm.states)) {
    if (dfs(state)) return true;
  }
  return false;
}

function computeMaxDepth(fsm: Fsm): number {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  function depth(state: string): number {
    const cached = memo.get(state);
    if (cached !== undefined) return cached;
    if (visiting.has(state)) return 0;

    visiting.add(state);
    const fsmState = fsm.states[state];
    if (!fsmState || Object.keys(fsmState.transitions).length === 0) {
      memo.set(state, 0);
      visiting.delete(state);
      return 0;
    }

    let maxChild = 0;
    for (const target of Object.values(fsmState.transitions)) {
      maxChild = Math.max(maxChild, depth(target));
    }

    const result = maxChild + 1;
    memo.set(state, result);
    visiting.delete(state);
    return result;
  }

  return depth(fsm.initial);
}

function findTerminalStates(fsm: Fsm): string[] {
  return Object.entries(fsm.states)
    .filter(([_, state]) => Object.keys(state.transitions).length === 0)
    .map(([name]) => name);
}

function analyzeWarnings(fsm: Fsm): string[] {
  const warnings: string[] = [];

  const unreachable = findUnreachableStates(fsm);
  if (unreachable.length > 0) {
    warnings.push(`Unreachable states: ${unreachable.join(", ")}`);
  }

  const hasCycles = detectCycles(fsm);
  if (hasCycles) {
    warnings.push("Workflow contains cycles — ensure the agent can break out");
  }

  const terminals = findTerminalStates(fsm);
  if (terminals.length > 1) {
    warnings.push(`Multiple terminal states: ${terminals.join(", ")}`);
  }

  for (const [name, state] of Object.entries(fsm.states)) {
    if (state.prompt.length > 2000) {
      warnings.push(
        `State "${name}" has a very long prompt (${state.prompt.length} chars)`,
      );
    }
    if (state.todos && state.todos.length > 10) {
      warnings.push(
        `State "${name}" has ${state.todos.length} todos — consider splitting`,
      );
    }
  }

  return warnings;
}

function collectStats(fsm: Fsm): FsmStats {
  let totalTransitions = 0;
  for (const state of Object.values(fsm.states)) {
    totalTransitions += Object.keys(state.transitions).length;
  }

  return {
    total_states: Object.keys(fsm.states).length,
    total_transitions: totalTransitions,
    terminal_states: findTerminalStates(fsm),
    unreachable_states: findUnreachableStates(fsm),
    max_depth: computeMaxDepth(fsm),
    has_cycles: detectCycles(fsm),
  };
}

function formatReport(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.valid) {
    lines.push("Validation: PASSED");
  } else {
    lines.push("Validation: FAILED");
  }

  if (result.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const e of result.errors) {
      lines.push(`  - ${e}`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of result.warnings) {
      lines.push(`  - ${w}`);
    }
  }

  lines.push("");
  lines.push("Stats:");
  lines.push(`  States: ${result.stats.total_states}`);
  lines.push(`  Transitions: ${result.stats.total_transitions}`);
  lines.push(`  Max depth: ${result.stats.max_depth}`);
  lines.push(`  Has cycles: ${result.stats.has_cycles}`);
  lines.push(`  Terminal states: ${result.stats.terminal_states.join(", ")}`);

  if (result.stats.unreachable_states.length > 0) {
    lines.push(`  Unreachable: ${result.stats.unreachable_states.join(", ")}`);
  }

  return lines.join("\n");
}

export function validate(args: ValidateArgs): void {
  try {
    if (!existsSync(args.fsmPath)) {
      throw new CliError("ARGS_INVALID", `file not found: ${args.fsmPath}`);
    }

    let fsm: Fsm;
    const errors: string[] = [];

    try {
      fsm = loadFsm(args.fsmPath);
    } catch (err: unknown) {
      if (err instanceof FsmError) {
        errors.push(err.message);
        const result: ValidationResult = {
          valid: false,
          errors,
          warnings: [],
          stats: {
            total_states: 0,
            total_transitions: 0,
            terminal_states: [],
            unreachable_states: [],
            max_depth: 0,
            has_cycles: false,
          },
        };

        if (args.json) {
          printJson(jsonSuccess("Validation failed", { ...result }));
        } else {
          process.stdout.write(`${formatReport(result)}\n`);
        }
        process.exit(2);
      }
      throw err;
    }

    const warnings = analyzeWarnings(fsm);
    const stats = collectStats(fsm);

    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings,
      stats,
    };

    if (args.json) {
      printJson(jsonSuccess("Validation passed", { ...result }));
    } else {
      process.stdout.write(`${formatReport(result)}\n`);
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
