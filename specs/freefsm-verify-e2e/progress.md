# Progress — freefsm-verify-e2e

Append-only log of completed implementation steps.

## Step 1: MessageBus
- **Files changed**: `freefsm/src/e2e/message-bus.ts` (new), `freefsm/src/__tests__/e2e/message-bus.test.ts` (new)
- **What was built**: `MessageBus` class with `BusEvent` types — the core communication primitive between embedded agent and verifier. Supports output enqueueing, input request/resolve with Promise-based blocking, event waiting with timeout, exit signaling, and accumulated output tracking.
- **Tests**: 12 tests added, all passing. Covers FIFO output ordering, blocking input request/resolve, input_request and exited events via waitForEvent, timeout rejection, multiple output accumulation in both input_request and exited events, and resolveInput error when no request pending.
- **Notes**: Implementation and initial tests (11) already existed from a prior pass. Added 1 new test (accumulated output in exited events) and tightened an existing assertion from `toContain` to exact `toBe("A\nB")` equality. No spec deviations. Pre-existing test failures in `mcp-tools.test.ts` (6 failures) and `run.test.ts` (2 failures) are unrelated to this change — they stem from other dirty working tree modifications.

## Step 2: EmbeddedRun
- **Files changed**: `freefsm/src/e2e/embedded-run.ts` (new), `freefsm/src/__tests__/e2e/embedded-run.test.ts` (new), `freefsm/src/commands/run.ts` (modified)
- **What was built**: `EmbeddedRun` class that wraps `freefsm run` for in-process embedded execution using a MessageBus. Refactored `run.ts` to extract a shared `runCore()` function with `RunCoreOptions` — when a `bus` is provided, `request_input` uses `bus.enqueueInputRequest()` instead of readline, and result output goes to `bus.enqueueOutput()` instead of stdout. The CLI `run()` function delegates to `runCore()` unchanged. `EmbeddedRun` pre-generates a `runId`, creates a `MessageBus`, and launches `runCore` as a background task that calls `bus.markExited()` on completion.
- **Tests**: 9 tests added, all passing. Covers: start launches SDK session, runId/storeRoot populated, custom runId, getBus returns MessageBus, markExited called on completion, result output routed to bus, request_input uses bus instead of readline, error exit code 1, store files created.
- **Notes**: No spec deviations. The runId is pre-generated in `EmbeddedRun` constructor (rather than delegating to `runCore`'s internal generation) so it's available immediately after construction without awaiting the background task. Pre-existing test failures (6 in mcp-tools.test.ts, 2 in run.test.ts) remain unchanged.
