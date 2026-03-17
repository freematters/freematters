
# Implementation Plan: FreeFSM E2E Testing Framework

## Checklist
- [x] Step 1: CLI scaffolding and test plan parser
- [x] Step 2: TranscriptLogger and `freefsm e2e verify` core loop
- [x] Step 3: ReportGenerator and `test-report.md` output
- [x] Step 4: `verifier.fsm.yaml` workflow
- [x] Step 5: `freefsm e2e gen` command
- [x] Step 6: Dogfood — self-test freefsm with the e2e framework

---

## Step 1: CLI scaffolding and test plan parser

**Objective**: Register `freefsm e2e verify` and `freefsm e2e gen` as CLI subcommands. Implement the test plan markdown parser that extracts `## Setup`, `## Steps`, `## Expected Outcomes`, `## Cleanup` sections into a typed data structure.

**Test Requirements**:
- Parse a valid test plan markdown → returns all 4 sections with step details
- Parse a plan missing `## Expected Outcomes` → returns validation error
- `freefsm e2e verify` with no args → exits with `ARGS_INVALID`
- `freefsm e2e verify plan.md --test-dir ./out` → creates output directory

**Implementation Guidance**:
- Add `e2e` command group to `src/cli.ts` using Commander's `.command()` chaining (see existing `start`, `goto` patterns)
- New files: `src/commands/e2e/verify.ts`, `src/commands/e2e/gen.ts`, `src/e2e/parser.ts`
- Parser: use simple line-by-line markdown parsing (no library needed) — split on `## ` headings
- Data model: `TestPlan { name, setup: string[], steps: TestStep[], expectedOutcomes: string[], cleanup: string[] }`
- `TestStep { name: string, action: string, expected: string }`
- Validate `--test-dir` is writable; create if not exists

**Integration Notes**: First step — establishes the CLI surface and data model used by all subsequent steps.

**Demo**: `freefsm e2e verify test-plan.md --test-dir ./out` parses the plan and prints the parsed structure (JSON mode). Exits with error on invalid plans.

---

## Step 2: TranscriptLogger and `freefsm e2e verify` core loop

**Objective**: Implement the transcript logging middleware and the core verification loop that launches a Claude agent, feeds it the test plan, and captures all interactions.

**Test Requirements**:
- TranscriptLogger writes timestamped entries to `transcript.jsonl`
- TranscriptLogger writes API request/response pairs to `api.jsonl`
- Verify command launches agent with test plan as system prompt context
- Agent receives MCP tools for shell execution

**Implementation Guidance**:
- New file: `src/e2e/transcript-logger.ts`
- TranscriptLogger wraps Agent SDK message stream (see `src/commands/run.ts` for the existing streaming pattern)
- Each agent message/tool_use/tool_result → append to `transcript.jsonl` with `{ ts, type, step, content, evidence }`
- Raw API pairs → append to `api.jsonl`
- Core verify loop in `src/commands/e2e/verify.ts`:
  1. Parse test plan (Step 1's parser)
  2. Build system prompt with test plan content + instructions to execute steps and judge outcomes
  3. Initialize Agent SDK session (reuse patterns from `run.ts`)
  4. Stream messages through TranscriptLogger
  5. Agent executes autonomously
- Reference design §4.2 and §4.3 for interface details

**Integration Notes**: Builds on Step 1's parser. The agent runs but doesn't produce a formatted report yet (Step 3).

**Demo**: `freefsm e2e verify plan.md --test-dir ./out` executes a simple 2-step test plan. `./out/transcript.jsonl` and `./out/api.jsonl` contain captured interactions.

---

## Step 3: ReportGenerator and `test-report.md` output

**Objective**: Generate a human-readable `test-report.md` from the transcript, including per-step verdicts, evidence, and an overall pass/fail.

**Test Requirements**:
- Given a transcript with 2 PASS steps → report shows overall PASS, both steps green
- Given a transcript with 1 FAIL step → report shows overall FAIL, failure details with evidence
- Report includes timing information per step
- JSON output mode returns `{ verdict, steps_passed, steps_failed }`

**Implementation Guidance**:
- New file: `src/e2e/report-generator.ts`
- Parse `transcript.jsonl` entries, group by step number
- Extract judgment entries (type: "judgment") for per-step verdicts
- Format as markdown table (see design §5 for report structure)
- For failures: include expected, observed, evidence, reproduction steps
- Add JSON envelope support (design §7, AC5)
- Agent's final message should include structured verdicts — parse them from the transcript

**Integration Notes**: Called at the end of the verify loop (Step 2). Completes the full `freefsm e2e verify` pipeline.

**Demo**: `freefsm e2e verify plan.md --test-dir ./out` produces `./out/test-report.md` with per-step results and an overall verdict.

---

## Step 4: `verifier.fsm.yaml` workflow

**Objective**: Create the FSM workflow that structures the verification agent's execution through setup → execute → evaluate → report → done states.

**Test Requirements**:
- `verifier.fsm.yaml` passes schema validation (`freefsm start` succeeds)
- All state transitions are valid (setup → execute-steps → evaluate → report → done)
- State prompts reference test plan sections correctly

**Implementation Guidance**:
- New file: `workflows/verifier.fsm.yaml`
- States per design §4.5: `setup`, `execute-steps`, `evaluate`, `report`, `done`
- Each state prompt instructs the agent on what to do with the test plan
- `setup` prompt: read test plan, verify prerequisites, run setup steps
- `execute-steps` prompt: execute each step sequentially, log evidence, judge each step
- `evaluate` prompt: compare all observations against expected outcomes, determine overall verdict
- `report` prompt: write `test-report.md` to `--test-dir`
- Modify `verify.ts` to use `freefsm run` internally with this workflow instead of raw Agent SDK

**Integration Notes**: Replaces the ad-hoc agent loop from Step 2 with a structured FSM-driven execution. This is the key "dogfooding" integration.

**Demo**: `freefsm e2e verify plan.md --test-dir ./out` now runs through the FSM states visibly. State transitions appear in transcript.

---

## Step 5: `freefsm e2e gen` command

**Objective**: Generate structured markdown test plans from a workflow YAML or free-text prompt.

**Test Requirements**:
- Given a simple 3-state FSM YAML → generates a test plan covering the happy path
- Given a free-text prompt → generates a test plan with all required sections
- Output file is valid (passes the test plan parser from Step 1)

**Implementation Guidance**:
- Implement `src/commands/e2e/gen.ts`
- Two modes:
  - **YAML mode**: Parse FSM, enumerate reachable paths (BFS/DFS on transitions), generate steps for each path
  - **Prompt mode**: Use Claude agent to generate the test plan from the description
- For YAML mode: build a path enumeration utility in `src/e2e/path-enumerator.ts`
- Output: write to `--output <file>` or stdout
- Validate generated plan passes the parser before outputting

**Integration Notes**: Uses the parser from Step 1 for validation. Can optionally use `gen.fsm.yaml` workflow per design §4.6.

**Demo**: `freefsm e2e gen workflows/pdd.fsm.yaml --output pdd-test.md` produces a test plan. `freefsm e2e verify pdd-test.md --test-dir ./out` can execute it.

---

## Step 6: Dogfood — self-test freefsm with the e2e framework

**Objective**: Write and run e2e tests for freefsm's own workflows using the new framework, proving it works end-to-end.

**Test Requirements**:
- A test plan for a simple 2-state workflow passes verification
- A test plan with an intentionally broken step produces a FAIL report
- `test-report.md` contains enough detail for a follow-up agent to debug

**Implementation Guidance**:
- Create `e2e/` directory with test plans:
  - `e2e/simple-workflow.md` — tests basic start → goto → done lifecycle
  - `e2e/error-handling.md` — tests invalid transitions, missing states
- Run `freefsm e2e verify` against each plan
- Validate reports manually, then add as CI integration test
- Add `npm run test:e2e` script to `package.json`

**Integration Notes**: Final validation of the entire framework. All previous steps must work together.

**Demo**: `npm run test:e2e` runs all e2e test plans and produces reports in `e2e/results/`.
