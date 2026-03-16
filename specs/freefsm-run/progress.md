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

