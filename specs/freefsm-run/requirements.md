### Goal
Add a `freefsm run <workflow.fsm.yaml>` command that launches a Claude Agent SDK session to autonomously execute an FSM workflow, with a `request-input` MCP tool for human-in-the-loop interaction.

### Decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Agent SDK API style | **V1 `query()` API** — stable async generator |
| 2 | Human input mechanism | **stdin** — print prompt to stderr, read from stdin |
| 3 | FSM state management | **Reuse existing freefsm infrastructure via function imports** (not child process) |
| 4 | Agent tool access | **Configurable per-workflow** — YAML `allowed_tools` field, defaults to full toolset |
| 5 | Cost/turn limits | **Skip for v1** |
| 6 | State instruction delivery | Agent calls `freefsm start` / `freefsm goto` which return state cards. MCP tools wrap existing functions. |

### Functional Requirements

1. **CLI command**: `freefsm run <path-to-workflow.yaml> [--run-id <id>]`
   - Resolves workflow path using same logic as existing `freefsm start`
   - Auto-generates run ID if not provided (same `<name>-<timestamp>` format)

2. **Agent session**: Uses `@anthropic-ai/claude-agent-sdk` V1 `query()` with streaming input (async generator)
   - System prompt contains the FSM guide (from YAML `guide` field) + instructions on how to use the FSM tools
   - Initial user message contains the output of `freefsm start` (the initial state card)

3. **MCP tools** (registered via `createSdkMcpServer`):
   - `fsm_goto(target, on)` — wraps the existing `goto` function, returns new state card
   - `fsm_current()` — wraps the existing `current` function, returns current state card
   - `request_input(prompt, schema?)` — prints prompt to stderr, reads response from stdin, returns the input

4. **Allowed tools**: The YAML may contain an `allowed_tools` list at the top level. These are passed to the Agent SDK's `allowedTools` option. If omitted, defaults to full Claude Code toolset. The MCP tools (`fsm_goto`, `fsm_current`, `request_input`) are always allowed.

5. **Workflow YAML schema extension**: Add optional `allowed_tools: string[]` field to the workflow schema.

### Non-Functional Requirements

- `@anthropic-ai/claude-agent-sdk` and `zod` added as dependencies
- No new external MCP server process — everything runs in-process via `createSdkMcpServer`
- The agent loop runs until the FSM reaches a terminal state (no transitions) or the agent stops

### Out of Scope (v1)

- Cost/turn limits (`maxTurns`, `maxBudgetUsd`)
- MCP elicitation support
- Session resume/persistence across process restarts
- Per-state allowed tools (only per-workflow)
