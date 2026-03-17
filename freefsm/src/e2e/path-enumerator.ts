import type { Fsm } from "../fsm.js";

export interface FsmPath {
  /** Human-readable name for this path */
  name: string;
  /** Ordered list of state names visited */
  states: string[];
  /** Transition labels taken (length = states.length - 1) */
  transitions: string[];
}

/**
 * Enumerate all distinct acyclic paths from the initial state to terminal states
 * (states with no transitions) using DFS. Cycles are broken by not revisiting states.
 */
export function enumeratePaths(fsm: Fsm): FsmPath[] {
  const paths: FsmPath[] = [];

  function dfs(
    currentState: string,
    visitedStates: string[],
    transitionLabels: string[],
    visited: Set<string>,
  ): void {
    const state = fsm.states[currentState];
    const transitionEntries = Object.entries(state.transitions);

    // Terminal state (no transitions) — record this path
    if (transitionEntries.length === 0) {
      paths.push({
        name: visitedStates.join(" -> "),
        states: [...visitedStates],
        transitions: [...transitionLabels],
      });
      return;
    }

    for (const [label, target] of transitionEntries) {
      if (visited.has(target)) {
        // Skip cycles — but still record the path up to here if it's a dead end
        continue;
      }

      visited.add(target);
      visitedStates.push(target);
      transitionLabels.push(label);

      dfs(target, visitedStates, transitionLabels, visited);

      visitedStates.pop();
      transitionLabels.pop();
      visited.delete(target);
    }
  }

  const visited = new Set<string>([fsm.initial]);
  dfs(fsm.initial, [fsm.initial], [], visited);

  return paths;
}
