import { homedir } from "node:os";
import { loadFsm } from "../fsm.js";
import { formatReminder, stateCardFromFsm } from "../output.js";
import { Store } from "../store.js";

export interface HookInput {
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: unknown;
}

const START_RE = /freefsm\s+start\b/;
const FINISH_RE = /freefsm\s+finish\b/;
const GOTO_DONE_RE = /freefsm\s+goto\s+done\b/;
const RUN_ID_FLAG_RE = /--run-id\s+(\S+)/;

/**
 * Core hook logic. Returns reminder text or null.
 * Pure function (no stdin/stdout) for testability.
 */
export function handlePostToolUse(input: HookInput, root: string): string | null {
  const store = new Store(root);
  const sessionId = input.session_id;

  // 1. Auto-detect freefsm commands
  if (input.tool_name === "Bash") {
    const cmd =
      typeof input.tool_input?.command === "string" ? input.tool_input.command : "";

    if (START_RE.test(cmd)) {
      const runId = extractRunId(cmd, input.tool_response);
      if (runId) {
        store.bindSession(sessionId, runId);
        store.writeCounter(sessionId, 0);
        if (store.runExists(runId)) {
          store.updateMeta(runId, { session_id: sessionId });
        }
      }
    } else if (FINISH_RE.test(cmd) || GOTO_DONE_RE.test(cmd)) {
      store.unbindSession(sessionId);
      return null;
    }
  }

  // 2. Check session binding
  const runId = store.readSession(sessionId);
  if (!runId) return null;

  // 3. Increment counter
  const counter = store.readCounter(sessionId) + 1;
  store.writeCounter(sessionId, counter);
  if (counter % 5 !== 0) return null;

  // 4. Build reminder
  try {
    const snapshot = store.readSnapshot(runId);
    if (!snapshot || snapshot.run_status !== "active") {
      store.unbindSession(sessionId);
      return null;
    }

    const meta = store.readMeta(runId);
    const fsm = loadFsm(meta.fsm_path);
    const fsmState = fsm.states[snapshot.state];
    if (!fsmState) return null;

    const card = stateCardFromFsm(snapshot.state, fsmState);
    return formatReminder(card);
  } catch {
    // If anything fails reading state, silently skip
    return null;
  }
}

function extractRunId(cmd: string, toolResponse: unknown): string | null {
  // Try --run-id flag from command
  const match = RUN_ID_FLAG_RE.exec(cmd);
  if (match) return match[1];

  // Try parsing from tool_response (stdout text)
  if (typeof toolResponse === "string") {
    const runIdMatch = /run_id:\s*(\S+)/.exec(toolResponse);
    if (runIdMatch) return runIdMatch[1];
  }

  return null;
}

/**
 * CLI entry point: reads stdin, calls handlePostToolUse, writes stdout.
 */
export function main(): void {
  let raw = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    raw += chunk;
  });
  process.stdin.on("end", () => {
    try {
      const input = JSON.parse(raw) as HookInput;

      const root = process.env.FREEFSM_ROOT ?? `${homedir()}/.freefsm`;

      const reminder = handlePostToolUse(input, root);

      if (reminder) {
        const output = {
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: reminder,
          },
        };
        process.stdout.write(JSON.stringify(output));
      }
    } catch {
      // Silent failure — hooks should not break the agent
    }
    process.exit(0);
  });
}
