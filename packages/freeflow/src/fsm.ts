import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { load as yamlLoad } from "js-yaml";
import { parseMarkdownWorkflow } from "./markdown-parser.js";
import { resolveWorkflow } from "./resolve-workflow.js";

// --- Types ---

export interface FsmState {
  prompt: string;
  todos?: string[];
  transitions: Record<string, string>;
  guide?: string;
  subagent?: boolean;
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

const STATE_NAME_RE = /^[A-Za-z_-][A-Za-z0-9_-]*(\/[A-Za-z_-][A-Za-z0-9_-]*)*$/;

function fail(message: string): never {
  throw new FsmError("SCHEMA_INVALID", message);
}

// --- Ref Resolution ---

/**
 * Parse a `from` reference string into workflow name and state name.
 * Format: "workflow-name#state-name"
 */
function parseFromRef(
  stateName: string,
  from: string,
): { workflowRef: string; stateRef: string } {
  const hashIdx = from.indexOf("#");
  if (hashIdx === -1 || hashIdx === 0 || hashIdx === from.length - 1) {
    fail(
      `state "${stateName}": "from" must be in format "workflow#state", got "${from}"`,
    );
  }
  return {
    workflowRef: from.slice(0, hashIdx),
    stateRef: from.slice(hashIdx + 1),
  };
}

/**
 * Resolve all `from:` references in a raw workflow document.
 * Mutates the doc in place — replaces `from:` states with merged content.
 */
function resolveRefs(
  doc: Record<string, unknown>,
  currentPath: string,
  visited: Set<string>,
): void {
  const rawStates = doc.states;
  if (
    rawStates === null ||
    rawStates === undefined ||
    typeof rawStates !== "object" ||
    Array.isArray(rawStates)
  ) {
    return; // let downstream validation handle this
  }

  const states = rawStates as Record<string, unknown>;
  const currentDir = dirname(currentPath);

  for (const [name, rawState] of Object.entries(states)) {
    if (
      rawState === null ||
      rawState === undefined ||
      typeof rawState !== "object" ||
      Array.isArray(rawState)
    ) {
      continue; // let downstream validation handle this
    }

    const state = rawState as Record<string, unknown>;
    if (state.from === undefined) continue;

    if (typeof state.from !== "string" || state.from.length === 0) {
      fail(`state "${name}": "from" must be a non-empty string`);
    }

    if (doc.version !== 1.1 && doc.version !== 1.2 && doc.version !== 1.3) {
      fail(`state "${name}": "from" requires version 1.1 or higher`);
    }

    const { workflowRef, stateRef } = parseFromRef(name, state.from);

    // Resolve the workflow path, handling relative paths from the current file's directory
    const resolvedRef = workflowRef.startsWith(".")
      ? resolve(currentDir, workflowRef)
      : workflowRef;
    const basePath = resolveWorkflow(resolvedRef);

    // Cycle detection
    if (visited.has(basePath)) {
      const chain = [...visited, basePath].join(" → ");
      fail(`circular reference detected: ${chain}`);
    }

    // Recursively load base workflow
    const baseFsm = loadFsmInternal(basePath, new Set([...visited]));

    // Extract the target state from base
    const baseState = baseFsm.states[stateRef];
    if (!baseState) {
      fail(
        `state "${name}": referenced state "${stateRef}" not found in workflow "${workflowRef}"`,
      );
    }

    // Merge prompt
    if (state.prompt === undefined) {
      state.prompt = baseState.prompt;
    } else if (typeof state.prompt === "string" && state.prompt.includes("{{base}}")) {
      state.prompt = state.prompt.replace("{{base}}", baseState.prompt);
    }
    // else: local prompt fully replaces base (no action needed)

    // Merge transitions
    if (state.transitions === undefined) {
      state.transitions = { ...baseState.transitions };
    } else if (
      typeof state.transitions === "object" &&
      state.transitions !== null &&
      !Array.isArray(state.transitions)
    ) {
      state.transitions = {
        ...baseState.transitions,
        ...(state.transitions as Record<string, unknown>),
      };
    }

    // Merge todos: child overrides base; append_todos appends to inherited
    if (state.todos === undefined) {
      if (baseState.todos !== undefined) {
        state.todos = [...baseState.todos];
      }
    }
    // If child defines todos explicitly (even empty), it replaces base todos entirely

    // append_todos: append items after resolved todos (base or overridden)
    if (state.append_todos !== undefined && Array.isArray(state.append_todos)) {
      const base = Array.isArray(state.todos) ? state.todos : [];
      state.todos = [...base, ...(state.append_todos as unknown[])];
      state.append_todos = undefined;
    }

    // Merge subagent: inherit from base if not overridden locally
    if (state.subagent === undefined && baseState.subagent !== undefined) {
      state.subagent = baseState.subagent;
    }

    // Remove from field after merge
    state.from = undefined;
  }
}

/**
 * Resolve `extends_guide` field: load base workflow's guide and merge with local guide.
 * Mutates doc in place. Deletes `extends_guide` after processing.
 */
function resolveExtendsGuide(
  doc: Record<string, unknown>,
  currentPath: string,
  visited: Set<string>,
): void {
  if (doc.extends_guide === undefined) return;

  if (typeof doc.extends_guide !== "string" || doc.extends_guide.length === 0) {
    fail(`"extends_guide" must be a non-empty string`);
  }

  if (doc.version !== 1.1 && doc.version !== 1.2 && doc.version !== 1.3) {
    fail(`"extends_guide" requires version 1.1 or higher`);
  }

  const workflowRef = doc.extends_guide as string;
  const currentDir = dirname(currentPath);

  // Resolve the base workflow path
  const resolvedRef = workflowRef.startsWith(".")
    ? resolve(currentDir, workflowRef)
    : workflowRef;
  const basePath = resolveWorkflow(resolvedRef);

  // Load base workflow (reuse visited set for cycle detection)
  const baseFsm = loadFsmInternal(basePath, new Set([...visited]));

  // Base must have a guide
  if (!baseFsm.guide) {
    fail(`extends_guide: workflow "${workflowRef}" has no guide`);
  }

  const baseGuide = baseFsm.guide;

  // Merge guide
  if (doc.guide === undefined) {
    // No local guide → inherit base guide
    doc.guide = baseGuide;
  } else if (typeof doc.guide === "string" && doc.guide.includes("{{base}}")) {
    // Local guide has {{base}} → insert base guide at placeholder
    doc.guide = doc.guide.replace("{{base}}", baseGuide);
  }
  // else: local guide without {{base}} → fully replace (no action needed)

  // Remove extends_guide field before validation
  doc.extends_guide = undefined;
}

// --- Workflow Composition ---

/**
 * Resolve all `workflow:` states by expanding child workflows inline.
 * Mutates the doc in place — replaces workflow states with namespaced child states.
 */
function resolveWorkflowStates(
  doc: Record<string, unknown>,
  currentPath: string,
  visited: Set<string>,
): void {
  const rawStates = doc.states;
  if (
    rawStates === null ||
    rawStates === undefined ||
    typeof rawStates !== "object" ||
    Array.isArray(rawStates)
  ) {
    return;
  }

  const states = rawStates as Record<string, unknown>;
  const currentDir = dirname(currentPath);

  // Collect workflow state names to expand (iterate a snapshot of keys)
  const workflowStateNames: string[] = [];
  for (const [name, rawState] of Object.entries(states)) {
    if (
      rawState !== null &&
      rawState !== undefined &&
      typeof rawState === "object" &&
      !Array.isArray(rawState) &&
      (rawState as Record<string, unknown>).workflow !== undefined
    ) {
      workflowStateNames.push(name);
    }
  }

  if (workflowStateNames.length === 0) return;

  // Track which workflow states map to their child initial states (for transition rewriting)
  const workflowEntryPoints: Record<string, string> = {};

  for (const stateName of workflowStateNames) {
    const state = states[stateName] as Record<string, unknown>;

    // Pre-validation
    if (state.from !== undefined) {
      fail(`state "${stateName}": "workflow" and "from" are mutually exclusive`);
    }
    if (state.prompt !== undefined) {
      fail(`state "${stateName}": "workflow" states cannot have "prompt"`);
    }
    if (state.todos !== undefined) {
      fail(`state "${stateName}": "workflow" states cannot have "todos"`);
    }
    if (state.append_todos !== undefined) {
      fail(`state "${stateName}": "workflow" states cannot have "append_todos"`);
    }
    if (state.transitions === undefined || state.transitions === null) {
      fail(`state "${stateName}": "workflow" states must have "transitions"`);
    }
    if (doc.version !== 1.2 && doc.version !== 1.3) {
      fail(`state "${stateName}": "workflow" requires version 1.2 or higher`);
    }

    const workflowRef = state.workflow as string;

    // Resolve the workflow path
    const resolvedRef = workflowRef.startsWith(".")
      ? resolve(currentDir, workflowRef)
      : workflowRef;
    const childPath = resolveWorkflow(resolvedRef);

    // Cycle detection
    if (visited.has(childPath)) {
      const chain = [...visited, childPath].join(" \u2192 ");
      fail(`circular reference detected: ${chain}`);
    }

    // Load child FSM (recursively expands nested workflow: states)
    const childFsm = loadFsmInternal(childPath, new Set([...visited]));

    // Check for namespace collisions
    for (const childStateName of Object.keys(childFsm.states)) {
      const expandedName = `${stateName}/${childStateName}`;
      if (expandedName in states) {
        fail(`state "${expandedName}" conflicts with existing state name`);
      }
    }

    // Collect parent transitions (these become the child done state's exits)
    const parentTransitions = state.transitions as Record<string, unknown>;

    // Expand child states into parent
    for (const [childStateName, childState] of Object.entries(childFsm.states)) {
      const expandedName = `${stateName}/${childStateName}`;

      // Build the expanded state object
      const expandedState: Record<string, unknown> = {
        prompt: childState.prompt,
      };

      if (childState.todos !== undefined) {
        expandedState.todos = [...childState.todos];
      }

      if (childStateName === "done") {
        // Done state: replace transitions with parent's declared transitions
        expandedState.transitions = { ...parentTransitions };
      } else {
        // Non-done state: prefix all transition targets
        const rewrittenTransitions: Record<string, string> = {};
        for (const [label, target] of Object.entries(childState.transitions)) {
          rewrittenTransitions[label] = `${stateName}/${target}`;
        }
        expandedState.transitions = rewrittenTransitions;
      }

      // Apply child guide as per-state guide override
      if (childFsm.guide) {
        expandedState.guide = childFsm.guide;
      }

      states[expandedName] = expandedState;
    }

    // Track the entry point for this workflow state
    workflowEntryPoints[stateName] = `${stateName}/${childFsm.initial}`;

    // Update initial if it pointed to this workflow state
    if (doc.initial === stateName) {
      doc.initial = workflowEntryPoints[stateName];
    }

    // Remove the original workflow state
    delete states[stateName];
  }

  // Post-pass: rewrite any transition targets that point to removed workflow states
  // (e.g., one workflow state's done transitions target another workflow state)
  for (const rawState of Object.values(states)) {
    if (
      rawState === null ||
      rawState === undefined ||
      typeof rawState !== "object" ||
      Array.isArray(rawState)
    ) {
      continue;
    }
    const st = rawState as Record<string, unknown>;
    if (
      st.transitions === undefined ||
      st.transitions === null ||
      typeof st.transitions !== "object" ||
      Array.isArray(st.transitions)
    ) {
      continue;
    }
    const transitions = st.transitions as Record<string, string>;
    for (const [label, target] of Object.entries(transitions)) {
      if (target in workflowEntryPoints) {
        transitions[label] = workflowEntryPoints[target];
      }
    }
  }
}

// --- Loader ---

export function loadFsm(path: string): Fsm {
  return loadFsmInternal(path, new Set());
}

function loadFsmInternal(path: string, visited: Set<string>): Fsm {
  const absPath = resolve(path);
  visited.add(absPath);

  const raw = readFileSync(absPath, "utf-8");
  const doc = absPath.endsWith(".workflow.md")
    ? parseMarkdownWorkflow(raw)
    : yamlLoad(raw);

  if (
    doc === null ||
    doc === undefined ||
    typeof doc !== "object" ||
    Array.isArray(doc)
  ) {
    fail("document must be a YAML or Markdown mapping");
  }

  const obj = doc as Record<string, unknown>;

  // Resolve workflow: states, from: refs, and extends_guide before validation
  resolveWorkflowStates(obj, absPath, visited);
  resolveRefs(obj, absPath, visited);
  resolveExtendsGuide(obj, absPath, visited);

  // Top-level required fields
  if (
    obj.version !== 1 &&
    obj.version !== 1.1 &&
    obj.version !== 1.2 &&
    obj.version !== 1.3
  ) {
    fail(`"version" must be 1, 1.1, 1.2, or 1.3, got ${JSON.stringify(obj.version)}`);
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

    // Empty transitions only allowed for "done" (including namespaced done like "parent/done")
    const transitionCount = Object.keys(transitions).length;
    if (name === "done" || name.endsWith("/done")) {
      // done can have empty transitions (ok either way)
    } else if (transitionCount === 0) {
      fail(`state "${name}": non-done states must have at least one transition`);
    }

    states[name] = { prompt: s.prompt as string, transitions };
    if (todos !== undefined) {
      states[name].todos = todos;
    }
    if (typeof s.guide === "string" && s.guide.length > 0) {
      states[name].guide = s.guide;
    }
    if (s.subagent !== undefined && s.subagent !== null) {
      if (typeof s.subagent !== "boolean") {
        fail(`state "${name}": "subagent" must be a boolean`);
      }
      if (obj.version !== 1.3) {
        fail(`state "${name}": "subagent" requires version 1.3 or higher`);
      }
      states[name].subagent = s.subagent;
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
    version: obj.version as number,
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
