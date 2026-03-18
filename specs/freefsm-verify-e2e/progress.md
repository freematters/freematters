# Progress — freefsm-verify-e2e

Append-only log of completed implementation steps.

## Step 1: MessageBus
- **Files changed**: `freefsm/src/e2e/message-bus.ts` (new), `freefsm/src/__tests__/e2e/message-bus.test.ts` (new)
- **What was built**: `MessageBus` class with `BusEvent` types — the core communication primitive between embedded agent and verifier. Supports output enqueueing, input request/resolve with Promise-based blocking, event waiting with timeout, exit signaling, and accumulated output tracking.
- **Tests**: 12 tests added, all passing. Covers FIFO output ordering, blocking input request/resolve, input_request and exited events via waitForEvent, timeout rejection, multiple output accumulation in both input_request and exited events, and resolveInput error when no request pending.
- **Notes**: Implementation and initial tests (11) already existed from a prior pass. Added 1 new test (accumulated output in exited events) and tightened an existing assertion from `toContain` to exact `toBe("A\nB")` equality. No spec deviations. Pre-existing test failures in `mcp-tools.test.ts` (6 failures) and `run.test.ts` (2 failures) are unrelated to this change — they stem from other dirty working tree modifications.
