# Review Round 1: `freefsm run`

**Verdict: FAIL** (1 major issue)

## Major

1. **Error handling diverges from codebase pattern** (`run.ts:288-293`) — `handleError()` is called for `CliError` then `err` is unconditionally re-thrown. `FsmError` (e.g., invalid YAML) is not caught at all, producing a raw stack trace instead of the standard formatted output. Every other command uses `handleError(err, args.json)` which handles both `CliError` and `FsmError`. Fix: use the same `handleError(err, args.json)` catch-all pattern without re-throwing. *(Sources: B-R1, C-#3, A-#1)*

## Medium

2. **`fsm_goto` missing `run_status` check** — The MCP handler doesn't check `run_status === "active"` before transitioning. An agent could transition out of a terminal state, corrupting the event log. The existing CLI `goto` command checks for `RUN_NOT_ACTIVE`. *(Source: C-#5)*

3. **`request_input` readline reuse risk** — Each call creates a new `createInterface({ input: process.stdin })`. Multiple calls may cause missed lines or event listener leaks. *(Sources: A-#2, C-#1)*

4. **Test boilerplate duplication** — SDK mock setup (~30 lines) is copy-pasted across 4 test files. A shared helper would improve maintainability. *(Source: B-O2)*

5. **`--json` flag accepted but unused** — `RunArgs.json` is wired in CLI but never used for output. Either implement or remove. *(Source: B-O3)*

6. **Terminal state detection inconsistency** — `run.ts` uses `Object.keys(transitions).length === 0` while `goto.ts` uses `args.target === "done"`. Same result today but semantically different. *(Source: B-O1)*

## Minor

7. `fsmName` extraction is fragile — splits guide on `.` or `\n`, may produce a full sentence *(A-#3)*
8. Only `result` message type printed — no intermediate agent output *(A-#4)*
9. Test description mismatch for allowedTools test *(A-#5)*
10. No timeout on `request_input` *(C-#2)*
11. `fsm_current` reads snapshot outside lock *(C-#4)*
12. No explicit Agent SDK session cleanup on error *(C-#7)*
13. Hardcoded `mcp__freefsm__` prefix convention *(C-#8)*

**Counts**: 1 major, 5 medium, 7 minor
