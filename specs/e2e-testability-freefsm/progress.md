# Progress: FreeFSM E2E Testing Framework

## Status
Started implementation on 2026-03-17.
Branch: `issue-41-e2e-testability-freefsm`
Issue: freematters/freematters#41

## Step 1: CLI scaffolding and test plan parser
- **Files changed**: `src/e2e/parser.ts` (new), `src/commands/e2e/verify.ts` (new), `src/commands/e2e/gen.ts` (new stub), `src/cli.ts` (added e2e command group), `src/__tests__/e2e/parser.test.ts` (new), `src/__tests__/e2e/cli.test.ts` (new)
- **What was built**: Test plan markdown parser that extracts `## Setup`, `## Steps`, `## Expected Outcomes`, `## Cleanup` sections into typed `TestPlan` structure. Registered `freefsm e2e verify` and `freefsm e2e gen` as CLI subcommands with proper arg validation, `--test-dir` creation, JSON envelope output, and error handling.
- **Tests**: 10 tests added (5 parser unit tests + 5 CLI integration tests), all passing. Full suite: 137 tests, 0 failures.
- **Notes**: `freefsm e2e gen` is a stub (exits with "not yet implemented") — will be implemented in Step 5. Cleanup section is optional in test plans (not required by spec). Parser handles the step format `1. **Name**: Action` with `- Expected:` sub-items.

## Step 2: TranscriptLogger and `freefsm e2e verify` core loop
- **Files changed**: `src/e2e/transcript-logger.ts` (new), `src/e2e/verify-runner.ts` (new), `src/commands/e2e/verify.ts` (updated to async + agent execution), `src/cli.ts` (async verify action + `--parse-only` flag), `src/__tests__/e2e/transcript-logger.test.ts` (new), `src/__tests__/e2e/verify-core.test.ts` (new), `src/__tests__/e2e/cli.test.ts` (updated for `--parse-only`)
- **What was built**: TranscriptLogger class that writes timestamped entries to `transcript.jsonl` and raw API request/response pairs to `api.jsonl`. Core verification loop (`verifyCore`) that builds a system prompt from the parsed test plan, initializes an Agent SDK session with `bypassPermissions`, and streams all messages through the TranscriptLogger. The `processMessage` method handles `assistant` and `result` SDK message types. Added `--parse-only` flag to verify command to allow plan validation without agent execution.
- **Tests**: 15 tests added (7 TranscriptLogger unit tests + 8 verify-core unit tests with mocked Agent SDK), all passing. Full suite: 152 tests, 0 failures.
- **Notes**: Agent SDK is mocked in unit tests via `vi.mock`. The `--parse-only` flag was added to keep existing CLI integration tests working (they test arg validation, not agent execution). Manual demo confirmed that `transcript.jsonl` and `api.jsonl` are created and populated when the Agent SDK is available. The agent autonomously executes setup/steps from the system prompt.

## Step 3: ReportGenerator and `test-report.md` output
- **Files changed**: `src/e2e/report-generator.ts` (new), `src/__tests__/e2e/report-generator.test.ts` (new), `src/e2e/verify-runner.ts` (updated — generates report after agent session, returns `VerifyCoreResult`), `src/commands/e2e/verify.ts` (updated — prints verdict summary in human/JSON mode), `src/__tests__/e2e/verify-core.test.ts` (added integration test for report generation)
- **What was built**: ReportGenerator that reads `transcript.jsonl`, groups entries by step, extracts judgment entries for per-step verdicts, and generates a markdown report (`test-report.md`) with overall PASS/FAIL verdict, results table with timing, and failure details with evidence. Also supports JSON output mode returning `{ verdict, steps_passed, steps_failed }`. Integrated into the verify flow so `verifyCore` writes `test-report.md` after the agent session completes and returns a structured result that `verify.ts` uses for CLI output.
- **Tests**: 9 tests added (8 report-generator unit tests + 1 verify-core integration test), all passing. Full suite: 161 tests, 0 failures.
- **Notes**: Steps without a judgment entry default to FAIL with "inconclusive" verdict (per design spec: "Agent judgment unclear → Default to FAIL with inconclusive verdict"). Verdict is determined by checking if the judgment content starts with "PASS". Duration is computed from first-to-last transcript entry timestamps per step. The `verifyCore` function now returns `VerifyCoreResult` (was `void`).

## Step 4: `verifier.fsm.yaml` workflow
- **Files changed**: `workflows/verifier.fsm.yaml` (new), `src/e2e/verify-runner.ts` (rewritten to use FSM-driven execution), `src/__tests__/e2e/verifier-workflow.test.ts` (new), `src/__tests__/e2e/verify-core.test.ts` (updated — adapted test for new FSM system prompt)
- **What was built**: Created the `verifier.fsm.yaml` workflow with 5 states (setup, execute-steps, evaluate, report, done) that structures the verification agent through a linear FSM flow. Rewrote `verifyCore` to load the verifier workflow, initialize an FSM Store and run, create an FSM MCP server with `fsm_goto` and `fsm_current` tools, and launch the Agent SDK session with FSM-driven state management instead of raw Agent SDK calls. The test plan context is passed as part of the initial message alongside the setup state card.
- **Tests**: 16 tests added (11 schema validation + 5 FSM integration), all passing. Full suite: 177 tests, 0 failures.
- **Notes**: The `buildVerifySystemPrompt` function is kept for backward compatibility but is no longer used by `verifyCore` — the system prompt now comes from the FSM `run-system.md` template. One existing test in `verify-core.test.ts` was updated to match the new behavior (test plan info moved from system prompt to initial message). The verifier MCP server does not include `request_input` tool since verification runs non-interactively.
