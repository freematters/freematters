# Implementation Plan: Embedded E2E Verification for freefsm

## Checklist
- [x] Step 1: MessageBus
- [x] Step 2: EmbeddedRun — adapt `run()` to embedded mode
- [x] Step 3: Verifier MCP tools + end-to-end wiring
- [x] Step 4: DualStreamLogger
- [ ] Step 5: Replace `freefsm e2e verify` command
- [ ] Step 6: Integration test with real FSM workflow

---

## Step 1: MessageBus

**Objective**: Build the core communication primitive between the embedded agent and verifier.

**Test Requirements**:
- `enqueueOutput` then `waitForEvent` returns `{ type: "output", text }` in FIFO order
- `enqueueInputRequest` blocks until `resolveInput` is called, then returns the input text
- `waitForEvent` returns `{ type: "input_request", prompt, output }` when input is requested
- `waitForEvent` returns `{ type: "exited", code, output }` after `markExited`
- `waitForEvent` rejects/returns timeout status when timeout expires with no events
- Multiple `enqueueOutput` calls accumulate in `output` field of `input_request` and `exited` events
- `resolveInput` errors when no input request is pending

**Implementation Guidance**: Create `src/e2e/message-bus.ts` implementing the `MessageBus` class and `BusEvent` types from design.md §4.1 and §5.1. Use Node.js Promises for blocking — `enqueueInputRequest` returns a Promise that `resolveInput` fulfills. Use an internal event queue with a pending-waiter pattern for `waitForEvent`.

**Integration Notes**: Standalone module, no dependencies on existing code.

**Demo**: Run unit tests — all message bus behaviors verified.

---

## Step 2: EmbeddedRun — adapt `run()` to embedded mode

**Objective**: Make `freefsm run` launchable in embedded mode, using the MessageBus instead of stdin/stdout.

**Test Requirements**:
- `EmbeddedRun.start()` launches an Agent SDK session that runs in the background
- The embedded `request_input` tool writes to the bus (not stdin) and blocks until input is provided
- Agent `result` messages go to the bus (not stdout)
- `EmbeddedRun` populates `runId` and `storeRoot` after start
- The embedded session exits cleanly and `markExited` is called on the bus

**Implementation Guidance**: Create `src/e2e/embedded-run.ts`. Refactor the `request_input` tool creation in `src/commands/run.ts` to accept an optional `MessageBus` parameter — when provided, use `bus.enqueueInputRequest(prompt)` instead of readline. Similarly, route `result` output through `bus.enqueueOutput()`. `EmbeddedRun` wraps this: creates a `MessageBus`, a `Store`, calls the adapted run logic as an async task.

Keep changes to `run.ts` minimal — extract the MCP server creation and agent loop into a shared function that both the CLI path and embedded path can call with different I/O backends.

**Integration Notes**: Builds on Step 1 (MessageBus). The CLI `freefsm run` command must continue to work unchanged (stdin/stdout path).

**Demo**: Write a small script/test that creates an `EmbeddedRun` with a trivial 2-state FSM, calls `bus.waitForEvent()`, gets an `input_request`, calls `bus.resolveInput()`, and observes the run complete.

---

## Step 3: Verifier MCP tools + end-to-end wiring

**Objective**: Build the verifier's MCP tools and wire up the full outer-agent → inner-agent loop. This is the core E2E flow.

**Test Requirements**:
- `start_embedded_run` launches embedded run, returns `{ run_id, store_root }`
- `wait` returns `{ status: "awaiting_input", prompt, output }` when embedded agent calls `request_input`
- `wait` returns `{ status: "output", text }` for non-input assistant output
- `wait` returns `{ status: "exited", code, output }` when run completes
- `wait` returns `{ status: "timeout" }` after timeout
- `send_input` resolves pending input request
- `send_input` errors when no request is pending

**Implementation Guidance**: Create `src/e2e/verifier-tools.ts` with the three MCP tools from design.md §4.3. Create the verifier MCP server using `createSdkMcpServer`. Wire up: `start_embedded_run` creates an `EmbeddedRun` and stashes the bus; `wait` calls `bus.waitForEvent()`; `send_input` calls `bus.resolveInput()`.

**Integration Notes**: Builds on Steps 1-2. After this step, the full interaction loop works programmatically — a test can simulate what the verifier agent will do.

**Demo**: Integration test: create a verifier MCP server, call `start_embedded_run` with a 2-state interactive FSM, call `wait` (get input request), call `send_input`, call `wait` (get exit), verify store files exist.

---

## Step 4: DualStreamLogger

**Objective**: Add visually distinguishable logging for the three streams.

**Test Requirements**:
- `logEmbedded` outputs with `[embedded]` prefix, cyan color, indented
- `logVerifier` outputs with `[verifier]` prefix, green color, top level
- `logInput` outputs with `[input]` prefix, magenta color, top level
- All output goes to stderr

**Implementation Guidance**: Create `src/e2e/dual-stream-logger.ts`. Use the existing `colors` utilities from `agent-log.ts`. Wire the logger into the verifier tools: `wait` logs embedded output and input requests; `send_input` logs the input being sent.

**Integration Notes**: Builds on Step 3. Adds logging to existing tools without changing their behavior.

**Demo**: Run the integration test from Step 3, observe color-coded output on stderr.

---

## Step 5: Replace `freefsm e2e verify` command

**Objective**: Replace the existing verify command with the new embedded approach.

**Test Requirements**:
- `freefsm e2e verify <plan.md> --test-dir <dir>` launches verifier agent with embedded run
- Test report is written to `<dir>/test-report.md`
- Transcript is written to `<dir>/transcript.jsonl`
- CLI argument validation still works (missing plan, missing test-dir)
- `--model` flag works for both verifier and embedded agent
- `--json` flag outputs JSON summary

**Implementation Guidance**: Rewrite `src/e2e/verify-runner.ts` to use the new components. The verifier agent session setup stays similar (Agent SDK + system prompt + test plan context), but replaces the old verifier FSM + MCP tools with the new verifier MCP tools from Step 3. Update `src/commands/e2e/verify.ts` to call the new runner. Remove the old `verifier.fsm.yaml` workflow (no longer needed — the verifier agent drives itself from the test plan).

Update the verifier system prompt to explain the new tools and interaction model: start the embedded run, observe via `wait`, provide input via `send_input`, read store files at end, write report.

**Integration Notes**: Builds on Steps 1-4. Existing CLI tests for argument validation should still pass. The `freefsm e2e gen` command is unaffected.

**Demo**: `freefsm e2e verify e2e/run-stops-for-user-input.md --test-dir ./out` produces a test report.

---

## Step 6: Integration test with real FSM workflow

**Objective**: Validate the full system with a real interactive FSM workflow. Clean up unused code.

**Test Requirements**:
- End-to-end test: verify a simple interactive workflow, assert report verdicts
- Dogfood test: verify one of freefsm's own workflows (e.g., a simplified PDD first-state test)

**Implementation Guidance**: Write a test FSM (`test-fixtures/interactive.fsm.yaml`) with 3 states requiring 2 rounds of user input. Write a matching test plan. Run `freefsm e2e verify` and assert the report. Remove dead code: old `verifier.fsm.yaml`, unused imports in verify-runner, any unused helper functions from the old implementation.

**Integration Notes**: Final step. Validates the whole system works end-to-end. Clean up ensures no dead code remains.

**Demo**: Run `npm test` — all tests pass including the new integration tests. Run verify against the test fixture FSM and observe correct report with pass verdicts.
