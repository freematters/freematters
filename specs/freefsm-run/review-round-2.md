# Review Round 2: `freefsm run`

**Verdict: PASS** (no major issues, remaining medium items are acceptable trade-offs)

## Round 1 Fixes — Verified

- Error handling: correctly uses `handleError(err, args.json)` catch-all pattern
- `run_status` check: correctly guards against post-completion transitions

## Major

None.

## Medium (all acceptable/deferred)

1. **`goto.ts` terminal detection inconsistency** — pre-existing code uses `=== "done"` while `run.ts` correctly uses empty transitions. Not introduced by this diff.
2. **Duplicate `generateRunId`** — intentionally different format per spec (`<name>-<timestamp>` for run).
3. **`withLock` sync/async contract** — not a bug today; `store.commit` is synchronous.
4. **`request_input` readline reuse** — documented v1 limitation; sequential calls work correctly.

## Minor

1. `fsmName` extraction heuristic is fragile
2. `MCP_TOOL_NAMES` not derived from server name constant
3. Test mock boilerplate duplicated across files
4. `generateRunId` millisecond collision risk
5. `allowed_tools` MCP name deduplication not needed in practice

**Counts**: 0 major, 4 medium (all acceptable), 5 minor
