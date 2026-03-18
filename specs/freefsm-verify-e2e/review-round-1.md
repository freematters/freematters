# Review Round 1

## 🔴 Major (must fix)

1. **`model` option silently ignored** — `EmbeddedRunOptions.model` accepted but never forwarded to `runCore()`. `RunCoreOptions` lacks `model` field. Dead parameter.
   - Files: `embedded-run.ts:51-57`, `run.ts` (RunCoreOptions interface)

2. **Swallowed error in `EmbeddedRun.catch`** — `runCore` errors discarded; verifier only sees exit code 1 with no diagnostic info.
   - File: `embedded-run.ts:62-64`

## 🟠 Medium (should fix)

3. **Second `start_embedded_run` silently overwrites first** — No guard against starting multiple runs.
   - File: `verifier-tools.ts:31,52-54`

4. **Stale AGENTS.md references** — Still lists `verifier.fsm.yaml` as key file.
   - File: `freefsm/CLAUDE.md` (symlinked from AGENTS.md)

5. **Duplicate `generateRunId`** — Same function in `run.ts:36-38` and `embedded-run.ts:21-23`.

6. **Removed retry logic from verifier `query()`** — Old had 3 retries with backoff; new has none for the outer agent.
   - File: `verify-runner.ts`

## 🟡 Minor (do not fix)

7. Multiple concurrent waiters leak timers in MessageBus
8. `consumeAccumulated` uses value-based indexOf
9. Misleading `async` on `start()`
10. Duplicate test helpers across test files
11. `dangerouslyBypassPermissions` removed without migration note
