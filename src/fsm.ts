import { readFileSync } from "node:fs";
import { load as yamlLoad } from "js-yaml";

// --- Types ---

export interface FsmState {
  prompt: string;
  todos?: string[];
  transitions: Record<string, string>;
}

export interface Fsm {
  version: number;
  guide?: string;
  initial: string;
  states: Record<string, FsmState>;
  allowed_tools?: string[];
}

export class FsmError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FsmError";
    this.code = code;
  }
}

// --- Helpers ---

const STATE_NAME_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

function fail(message: string): never {
  throw new FsmError("SCHEMA_INVALID", message);
}

// --- Loader ---

export function loadFsm(path: string): Fsm {
  const raw = readFileSync(path, "utf-8");
  const doc = yamlLoad(raw);

  if (
    doc === null ||
    doc === undefined ||
    typeof doc !== "object" ||
    Array.isArray(doc)
  ) {
    fail("YAML must be a mapping");
  }

  const obj = doc as Record<string, unknown>;

  // Top-level required fields
  if (obj.version !== 1) {
    fail(`"version" must be 1, got ${JSON.stringify(obj.version)}`);
  }

  if (
    obj.guide !== undefined &&
    (typeof obj.guide !== "string" || obj.guide.length === 0)
  ) {
    fail(`"guide" must be a non-empty string if provided`);
  }

  // allowed_tools: optional string[]
  if (obj.allowed_tools !== undefined && obj.allowed_tools !== null) {
    if (!Array.isArray(obj.allowed_tools)) {
      fail(`"allowed_tools" must be an array of strings`);
    }
    for (const item of obj.allowed_tools) {
      if (typeof item !== "string" || item.length === 0) {
        fail(`"allowed_tools" items must be non-empty strings`);
      }
    }
  }

  if (typeof obj.initial !== "string" || obj.initial.length === 0) {
    fail(`"initial" must be a non-empty string`);
  }

  if (
    obj.states === null ||
    obj.states === undefined ||
    typeof obj.states !== "object" ||
    Array.isArray(obj.states)
  ) {
    fail(`"states" must be an object`);
  }

  const rawStates = obj.states as Record<string, unknown>;
  const stateNames = Object.keys(rawStates);

  if (stateNames.length === 0) {
    fail(`"states" must be non-empty`);
  }

  // Validate state names
  for (const name of stateNames) {
    if (!STATE_NAME_RE.test(name)) {
      fail(`state name "${name}" is invalid (must match [A-Za-z_-][A-Za-z0-9_-]*)`);
    }
  }

  // "initial" must exist in states
  if (!((obj.initial as string) in rawStates)) {
    fail(`"initial" state "${obj.initial}" does not exist in "states"`);
  }

  // "done" must exist
  if (!("done" in rawStates)) {
    fail(`terminal state "done" must exist in "states"`);
  }

  // Validate each state
  const states: Record<string, FsmState> = {};

  for (const [name, raw] of Object.entries(rawStates)) {
    if (
      raw === null ||
      raw === undefined ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      fail(`state "${name}" must be an object`);
    }

    const s = raw as Record<string, unknown>;

    // prompt: required string
    if (typeof s.prompt !== "string" || s.prompt.length === 0) {
      fail(`state "${name}": "prompt" must be a non-empty string`);
    }

    // todos: optional string[]
    let todos: string[] | undefined;
    if (s.todos !== undefined && s.todos !== null) {
      if (!Array.isArray(s.todos)) {
        fail(`state "${name}": "todos" must be an array`);
      }
      const seen = new Set<string>();
      for (const item of s.todos) {
        if (typeof item !== "string" || item.length === 0) {
          fail(`state "${name}": todo items must be non-empty strings`);
        }
        if (seen.has(item)) {
          fail(`state "${name}": duplicate todo item "${item}"`);
        }
        seen.add(item);
      }
      todos = s.todos as string[];
    }

    // transitions: optional object (defaults to {} for terminal states)
    if (s.transitions === null || s.transitions === undefined) {
      s.transitions = {};
    }
    if (typeof s.transitions !== "object" || Array.isArray(s.transitions)) {
      fail(`state "${name}": "transitions" must be an object`);
    }

    const rawTransitions = s.transitions as Record<string, unknown>;

    // Validate transition labels and build transitions map
    const transitions: Record<string, string> = {};
    for (const [label, target] of Object.entries(rawTransitions)) {
      if (label.length === 0) {
        fail(`state "${name}": transition labels must be non-empty strings`);
      }
      if (typeof target !== "string" || target.length === 0) {
        fail(
          `state "${name}": transition target for "${label}" must be a non-empty string`,
        );
      }
      transitions[label] = target;
    }

    // Empty transitions only allowed for "done"
    const transitionCount = Object.keys(transitions).length;
    if (name === "done") {
      // done can have empty transitions (ok either way)
    } else if (transitionCount === 0) {
      fail(`state "${name}": non-done states must have at least one transition`);
    }

    states[name] = { prompt: s.prompt as string, transitions };
    if (todos !== undefined) {
      states[name].todos = todos;
    }
  }

  // Validate all transition targets exist in states
  for (const [name, state] of Object.entries(states)) {
    for (const [label, target] of Object.entries(state.transitions)) {
      if (!(target in states)) {
        fail(
          `state "${name}": transition "${label}" targets unknown state "${target}"`,
        );
      }
    }
  }

  const fsm: Fsm = {
    version: 1,
    initial: obj.initial as string,
    states,
  };
  if (typeof obj.guide === "string") {
    fsm.guide = obj.guide;
  }
  if (Array.isArray(obj.allowed_tools)) {
    fsm.allowed_tools = obj.allowed_tools as string[];
  }
  return fsm;
}
