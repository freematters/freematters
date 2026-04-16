import { existsSync, readFileSync } from "node:fs";
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
  source_path?: string;
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

// --- Legacy-syntax hard-error guards ---

/**
 * Fail loudly if the document uses the retired `from:` or `extends_guide:`
 * composability fields. Runs early in the loader, before any resolution, and
 * is version-agnostic — these fields now error at any declared `version:`,
 * because we no longer ship loader code that can interpret them.
 */
function assertNoLegacyComposability(doc: Record<string, unknown>): void {
  if (doc.extends_guide !== undefined) {
    fail(`"extends_guide" is no longer supported; use top-level "extends" instead`);
  }

  const rawStates = doc.states;
  if (
    rawStates === null ||
    rawStates === undefined ||
    typeof rawStates !== "object" ||
    Array.isArray(rawStates)
  ) {
    return; // let downstream validation produce the right error
  }

  for (const [name, rawState] of Object.entries(rawStates as Record<string, unknown>)) {
    if (
      rawState === null ||
      rawState === undefined ||
      typeof rawState !== "object" ||
      Array.isArray(rawState)
    ) {
      continue;
    }
    if ((rawState as Record<string, unknown>).from !== undefined) {
      fail(
        `"from" is no longer supported; use top-level "extends" instead (state: ${name})`,
      );
    }
  }
}

// --- resolveExtends (v1.4 top-level inheritance) ---

const SUPER_RE = /\{\{\s*super\s*\}\}/g;
const SUPER_DETECT_RE = /\{\{\s*super\s*\}\}/;

/**
 * Returns true if `value` contains a `{{ super }}` placeholder.
 * Uses a non-global regex so it can be called repeatedly without state.
 */
function hasSuperPlaceholder(value: string): boolean {
  return SUPER_DETECT_RE.test(value);
}

/**
 * Substitute `{{ super }}` placeholder in `childValue` with `parentValue`.
 * If `parentValue` is undefined, placeholder expands to the empty string.
 */
function substituteSuper(childValue: string, parentValue: string | undefined): string {
  return childValue.replace(SUPER_RE, parentValue ?? "");
}

/**
 * Resolve top-level `extends:` by loading the parent workflow and merging
 * its guide / initial / states into the child document. Mutates `doc` in place.
 */
function resolveExtends(
  doc: Record<string, unknown>,
  currentPath: string,
  visited: Set<string>,
): void {
  if (doc.extends === undefined) return;

  if (typeof doc.extends !== "string" || doc.extends.length === 0) {
    fail(`"extends" must be a non-empty string`);
  }

  if (doc.version !== 1.4) {
    fail(`"extends" requires version 1.4`);
  }

  const ref = doc.extends;
  const currentDir = dirname(currentPath);

  // Resolve parent path, aggregating every attempted lookup.
  const attempts: string[] = [];
  let parentPath: string | undefined;

  if (ref.startsWith(".") || ref.startsWith("/")) {
    // Path-style: resolve relative to current file's dir (or absolute).
    const absRef = ref.startsWith("/") ? ref : resolve(currentDir, ref);
    attempts.push(absRef);
    if (existsSync(absRef)) {
      parentPath = absRef;
    } else {
      // Also try via resolveWorkflow (handles directory-style entries) for a
      // clearer diagnostic — wrap its failure into the aggregate.
      try {
        parentPath = resolveWorkflow(absRef);
      } catch {
        // swallow — aggregated below
      }
    }
  } else {
    // Name-style: try as relative path first, then via workflow registry.
    const relAttempt = resolve(currentDir, ref);
    attempts.push(relAttempt);
    if (existsSync(relAttempt)) {
      parentPath = relAttempt;
    } else {
      try {
        parentPath = resolveWorkflow(ref);
      } catch (e) {
        // Registry failure message contains searched directories; include it.
        const msg = e instanceof Error ? e.message : String(e);
        attempts.push(`workflow name "${ref}" via registry:\n${msg}`);
      }
    }
  }

  if (parentPath === undefined) {
    const attemptList = attempts.map((a) => `  - ${a}`).join("\n");
    fail(`extends: unable to resolve "${ref}":\n${attemptList}`);
  }

  // Cycle detection — parent already in the visited chain means a loop.
  if (visited.has(parentPath)) {
    const chain = [...visited, parentPath].join(" → ");
    fail(`circular reference detected: ${chain}`);
  }

  // Recursively load parent (fully resolved: parent's own `extends:` and
  // `workflow:` already applied before we see it).
  const parentFsm = loadFsmInternal(parentPath, new Set([...visited]));

  // Merge guide.
  if (doc.guide === undefined) {
    if (parentFsm.guide !== undefined) {
      doc.guide = parentFsm.guide;
    }
  } else if (typeof doc.guide === "string") {
    if (hasSuperPlaceholder(doc.guide)) {
      doc.guide = substituteSuper(doc.guide, parentFsm.guide);
    }
    // else: no placeholder — override as-is.
  }

  // Merge initial.
  if (doc.initial === undefined) {
    doc.initial = parentFsm.initial;
  }

  // Merge states. Start from a deep copy of parent states and overlay child.
  const mergedStates: Record<string, Record<string, unknown>> = {};
  for (const [parentName, parentState] of Object.entries(parentFsm.states)) {
    const copy: Record<string, unknown> = {
      prompt: parentState.prompt,
      transitions: { ...parentState.transitions },
    };
    if (parentState.todos !== undefined) {
      copy.todos = [...parentState.todos];
    }
    if (parentState.guide !== undefined) {
      copy.guide = parentState.guide;
    }
    if (parentState.subagent !== undefined) {
      copy.subagent = parentState.subagent;
    }
    if (parentState.source_path !== undefined) {
      copy.source_path = parentState.source_path;
    }
    mergedStates[parentName] = copy;
  }

  const rawChildStates =
    doc.states !== null &&
    doc.states !== undefined &&
    typeof doc.states === "object" &&
    !Array.isArray(doc.states)
      ? (doc.states as Record<string, unknown>)
      : {};

  for (const [childName, rawChildState] of Object.entries(rawChildStates)) {
    if (
      rawChildState === null ||
      rawChildState === undefined ||
      typeof rawChildState !== "object" ||
      Array.isArray(rawChildState)
    ) {
      continue; // defer to downstream validation
    }
    const childState = rawChildState as Record<string, unknown>;
    const parentState = mergedStates[childName];

    if (parentState === undefined) {
      // New state — keep as-is, but substitute {{ super }} in prompt/guide with empty.
      const newState: Record<string, unknown> = { ...childState };
      if (typeof newState.prompt === "string") {
        newState.prompt = substituteSuper(newState.prompt, undefined);
      }
      if (typeof newState.guide === "string") {
        newState.guide = substituteSuper(newState.guide, undefined);
      }
      mergedStates[childName] = newState;
      continue;
    }

    // Existing state — overlay per-field.
    // prompt
    if (childState.prompt === undefined) {
      // inherit parent's (already in parentState)
    } else if (typeof childState.prompt === "string") {
      if (hasSuperPlaceholder(childState.prompt)) {
        parentState.prompt = substituteSuper(
          childState.prompt,
          typeof parentState.prompt === "string" ? parentState.prompt : undefined,
        );
      } else {
        parentState.prompt = childState.prompt;
      }
    } else {
      parentState.prompt = childState.prompt;
    }

    // transitions — {...parent, ...child}
    if (childState.transitions !== undefined) {
      if (
        childState.transitions !== null &&
        typeof childState.transitions === "object" &&
        !Array.isArray(childState.transitions)
      ) {
        parentState.transitions = {
          ...(parentState.transitions as Record<string, unknown>),
          ...(childState.transitions as Record<string, unknown>),
        };
      } else {
        parentState.transitions = childState.transitions;
      }
    }

    // todos — override where declared
    if (childState.todos !== undefined) {
      parentState.todos = childState.todos;
    }

    // subagent — override where declared
    if (childState.subagent !== undefined) {
      parentState.subagent = childState.subagent;
    }

    // per-state guide — override where declared
    if (childState.guide !== undefined) {
      parentState.guide = childState.guide;
    }

    // source_path — override where declared
    if (childState.source_path !== undefined) {
      parentState.source_path = childState.source_path;
    }
  }

  doc.states = mergedStates;
  doc.extends = undefined;
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
    if (doc.version !== 1.2 && doc.version !== 1.3 && doc.version !== 1.4) {
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

      // Apply child guide only to the expanded child initial state
      if (childFsm.guide && childStateName === childFsm.initial) {
        expandedState.guide = childFsm.guide;
      }

      // Preserve source_path from child state for variable substitution
      if (childState.source_path) {
        expandedState.source_path = childState.source_path;
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
  const doc = absPath.endsWith(".md") ? parseMarkdownWorkflow(raw) : yamlLoad(raw);

  if (
    doc === null ||
    doc === undefined ||
    typeof doc !== "object" ||
    Array.isArray(doc)
  ) {
    fail("document must be a YAML or Markdown mapping");
  }

  const obj = doc as Record<string, unknown>;

  // Validate version before resolving composability features so that invalid
  // versions produce the correct error instead of a misleading feature-gate message.
  if (
    obj.version !== 1 &&
    obj.version !== 1.1 &&
    obj.version !== 1.2 &&
    obj.version !== 1.3 &&
    obj.version !== 1.4
  ) {
    fail(
      `"version" must be 1, 1.1, 1.2, 1.3, or 1.4, got ${JSON.stringify(obj.version)}`,
    );
  }

  // Fail fast on retired composability syntax (`from:`, `extends_guide:`) so
  // stale workflows get pointed at `extends:` instead of silently mis-loading.
  assertNoLegacyComposability(obj);

  // Resolve top-level `extends:` inheritance before any other composition
  // so downstream passes see the merged state set.
  resolveExtends(obj, absPath, visited);

  // Resolve workflow: states before field validation.
  resolveWorkflowStates(obj, absPath, visited);

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
    if (typeof s.source_path === "string") {
      states[name].source_path = s.source_path;
    } else {
      states[name].source_path = absPath;
    }
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
      if (obj.version !== 1.3 && obj.version !== 1.4) {
        fail(`state "${name}": "subagent" requires version 1.3 or higher`);
      }
      states[name].subagent = s.subagent;
    }
  }

  // Validate all transition targets exist in states. Collect every offender
  // into one aggregated error so migrations can see the full picture at once.
  const offenders: string[] = [];
  for (const [name, state] of Object.entries(states)) {
    for (const [label, target] of Object.entries(state.transitions)) {
      if (!(target in states)) {
        offenders.push(`state "${name}" label "${label}" → "${target}"`);
      }
    }
  }
  if (offenders.length > 0) {
    fail(`invalid transition targets in merged workflow: ${offenders.join("; ")}`);
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
