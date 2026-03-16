# Progress: freefsm run — Agent SDK Workflow Executor

## Step 1: Add Dependencies
- **Files changed**: `freefsm/package.json`, `freefsm/package-lock.json`
- **What was built**: Added `@anthropic-ai/claude-agent-sdk@^0.2.76` and `zod@^4.3.6` as production dependencies to the freefsm package.
- **Tests**: 0 new tests added (dependency-only step); all 86 existing tests pass with no conflicts.
- **Notes**: Both packages resolved cleanly with 4 new packages total (zod is also a transitive dep of the agent SDK and was deduped). No code changes required.

## Step 2: Implement run Command with Minimal Agent Loop
- **Files changed**: `freefsm/src/commands/run.ts` (new), `freefsm/src/cli.ts` (modified), `freefsm/src/__tests__/run.test.ts` (new)
- **What was built**: Created the `run` command that loads an FSM YAML, initializes a run via Store (same event sourcing as `start`), builds a system prompt from the FSM `guide` field, calls `query()` from the Agent SDK with the initial state card as the prompt, and prints result messages to stdout. Run ID auto-generates in `<name>-<timestamp>` format when omitted. Command registered in CLI as `freefsm run <path> [--run-id <id>]`.
- **Tests**: 7 tests added, all 93 tests passing (86 existing + 7 new)
- **Notes**: No MCP tools yet (Step 3). The agent can talk and use built-in Claude Code tools but cannot transition the FSM autonomously. Demo verified: `freefsm run workflows/pdd.fsm.yaml` launched an agent session that received the state card and responded.

## Step 3: Add FSM MCP Tools
- **Files changed**: `freefsm/src/commands/run.ts` (modified), `freefsm/src/__tests__/mcp-tools.test.ts` (new), `freefsm/src/__tests__/run.test.ts` (modified — updated mock)
- **What was built**: Registered `fsm_goto` and `fsm_current` as in-process MCP tools via `createSdkMcpServer` and `tool()` from the Agent SDK with Zod schemas. `fsm_goto` validates transitions (reusing the same logic as `goto.ts`), commits events via Store within `withLock()`, and returns the new state card. Invalid transitions return error text to the agent (not thrown). Terminal state detection checks for empty transitions and sets `run_status` to `"completed"`. `fsm_current` reads the snapshot and returns the current state card. MCP server is passed to `query()` via `mcpServers` option, and MCP tool names (`mcp__freefsm__fsm_goto`, `mcp__freefsm__fsm_current`) are added to `allowedTools`.
- **Tests**: 11 tests added, all 104 tests passing (93 existing + 11 new)
- **Notes**: The existing `run.test.ts` mock needed updating to include `tool` and `createSdkMcpServer` exports since `run.ts` now imports them. Terminal state detection is based on `Object.keys(transitions).length === 0` (general) rather than hardcoding `"done"`. Demo criteria requires live Agent SDK; build and all tests verified.

## Step 4: Add request_input MCP Tool
- **Files changed**: `freefsm/src/commands/run.ts` (modified), `freefsm/src/__tests__/request-input.test.ts` (new)
- **What was built**: Added `request_input` as a third in-process MCP tool. It writes the prompt to `process.stderr`, reads a line from `process.stdin` via `readline`, and returns the user's input. EOF on stdin returns `"EOF: stdin closed, no input available"` to the agent. `mcp__freefsm__request_input` added to `allowedTools`.
- **Tests**: 5 tests added, all 109 tests passing (104 existing + 5 new)
- **Notes**: Used a `resolved` flag to prevent the readline `close` event from racing with the `line` event (both fire when a line is read then the interface closes). No deviations from spec.

## Step 5: Add allowed_tools YAML Schema Extension
- **Files changed**: `freefsm/src/fsm.ts` (modified), `freefsm/src/commands/run.ts` (modified), `freefsm/src/__tests__/fsm.test.ts` (modified), `freefsm/src/__tests__/run.test.ts` (modified), `freefsm/src/__tests__/mcp-tools.test.ts` (modified), `freefsm/src/__tests__/request-input.test.ts` (modified)
- **What was built**: Extended the `Fsm` interface with optional `allowed_tools?: string[]` field. Added validation in `loadFsm()` (must be array of non-empty strings if present). In `run.ts`, when `fsm.allowed_tools` is set, MCP tool names are prepended and passed as `allowedTools` to `query()`. When unset, `allowedTools` is omitted entirely so the agent has full toolset access.
- **Tests**: 7 tests added (5 in fsm.test.ts, 2 in run.test.ts), 2 existing tests updated to match new behavior; all 116 tests passing (109 existing + 7 new)
- **Notes**: Behavioral change from Steps 3-4: previously `allowedTools` always contained MCP tool names even without `allowed_tools` in YAML, which unnecessarily restricted the agent to only MCP tools. Now `allowedTools` is only set when the YAML explicitly declares `allowed_tools`, giving full toolset access by default. Updated 2 pre-existing tests in `mcp-tools.test.ts` and `request-input.test.ts` to reflect this corrected behavior.

## Step 6: Integration Testing and Cleanup
- **Files changed**: `freefsm/src/__tests__/run-integration.test.ts` (new)
- **What was built**: End-to-end integration tests for `freefsm run` that mock the Agent SDK's `query()` to simulate an agent driving the FSM through all states via `fsm_goto` tool calls. Tests verify Store artifacts (events.jsonl and snapshot.json), `fsm_current` mid-workflow, `request_input` with piped stdin (including EOF handling), error recovery from invalid transitions, and metadata file creation.
- **Tests**: 10 tests added; all 126 tests passing (116 existing + 10 new). Build (`tsc`) and lint (`biome check`) both clean with no issues.
- **Notes**: No deviations from spec. Integration tests use the same mock pattern as existing unit tests (capturing tool handlers via `tool()` mock) but exercise the full run lifecycle including Store persistence. The mocked `query()` generator calls tool handlers inline to simulate agent behavior, then yields a final result message.
