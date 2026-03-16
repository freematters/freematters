# Implementation Plan: `freefsm run` — Agent SDK Workflow Executor

## Checklist
- [x] Step 1: Add `@anthropic-ai/claude-agent-sdk` and `zod` dependencies
- [x] Step 2: Implement `run` command with minimal agent loop (no MCP tools yet)
- [x] Step 3: Add FSM MCP tools (`fsm_goto`, `fsm_current`)
- [x] Step 4: Add `request_input` MCP tool (stdin-based)
- [ ] Step 5: Add `allowed_tools` YAML schema extension
- [ ] Step 6: Integration testing and cleanup

---

## Step 1: Add Dependencies

**Objective**: Add the Agent SDK and Zod as project dependencies so they're available for import.

**Test Requirements**:
- Verify `@anthropic-ai/claude-agent-sdk` and `zod` resolve correctly after install
- Verify existing tests still pass (no dependency conflicts)

**Implementation Guidance**:
```bash
cd freefsm && npm install @anthropic-ai/claude-agent-sdk zod
```
Verify `package.json` and `package-lock.json` are updated.

**Integration Notes**: No code changes yet — just dependency setup.

**Demo**: `npm ls @anthropic-ai/claude-agent-sdk zod` shows both installed.

---

## Step 2: Implement `run` Command with Minimal Agent Loop

**Objective**: Create the `run` command skeleton that starts an FSM run and launches a basic Agent SDK session. The agent receives the initial state card but has no custom MCP tools yet — it can only use built-in Claude Code tools.

**Test Requirements**:
- Unit test: `run` command initializes FSM run via Store (same events as `start`)
- Unit test: system prompt is built from FSM `guide` field
- Unit test: run ID auto-generation follows `<name>-<timestamp>` format

**Implementation Guidance**:
1. Create `src/commands/run.ts` with `RunArgs` interface and async `run()` function (ref: design §4.1)
2. Reuse `loadFsm()`, `Store.initRun()`, `Store.commit()` for FSM initialization (same as `start.ts`)
3. Build system prompt from `fsm.guide` (ref: design §4.5)
4. Call `query()` with streaming input — initial message is `formatStateCard()` of initial state
5. Iterate over `SDKMessage` stream, print `result` messages to stdout
6. Register command in `cli.ts`: `freefsm run <path> [--run-id <id>]`

**Integration Notes**: The agent can talk and use built-in tools but can't transition the FSM yet. This validates the Agent SDK integration works end-to-end.

**Demo**: `freefsm run workflows/pdd.fsm.yaml` launches an agent that prints the initial state card and responds.

---

## Step 3: Add FSM MCP Tools (`fsm_goto`, `fsm_current`)

**Objective**: Register `fsm_goto` and `fsm_current` as in-process MCP tools so the agent can drive the FSM autonomously.

**Test Requirements**:
- Unit test: `fsm_goto` handler validates transition and commits event via Store
- Unit test: `fsm_goto` returns new state card on success
- Unit test: `fsm_goto` returns error text (not throw) on invalid transition
- Unit test: `fsm_current` returns current state card
- Unit test: terminal state detection (state with no transitions)

**Implementation Guidance**:
1. Create MCP server via `createSdkMcpServer()` with Zod schemas (ref: design §4.2)
2. `fsm_goto` handler: read snapshot → validate transition (same logic as `goto.ts`) → `Store.commit()` within `Store.withLock()` → return `formatStateCard()` of new state
3. `fsm_current` handler: read snapshot + meta → `loadFsm()` → return `formatStateCard()`
4. Pass MCP server to `query()` via `mcpServers` option
5. Add MCP tool names to `allowedTools`: `mcp__freefsm__fsm_goto`, `mcp__freefsm__fsm_current`

**Integration Notes**: Now the agent can transition states. Combined with Step 2, this gives us a complete autonomous workflow executor.

**Demo**: `freefsm run workflows/simple-test.fsm.yaml` — agent executes each state and transitions to `done`.

---

## Step 4: Add `request_input` MCP Tool

**Objective**: Add a stdin-based human input tool so the agent can pause and ask the human for input.

**Test Requirements**:
- Unit test: `request_input` handler writes prompt to stderr
- Unit test: `request_input` handler reads line from stdin and returns it
- Unit test: EOF on stdin returns appropriate message to agent

**Implementation Guidance**:
1. Add `request_input` tool to the MCP server (ref: design §4.2, §4.3)
2. Zod schema: `{ prompt: z.string() }`
3. Handler: write `prompt` to `process.stderr`, create `readline` interface on `process.stdin`, return Promise that resolves with the user's line
4. Handle EOF: if stdin closes, return `{ content: [{ type: "text", text: "EOF: stdin closed, no input available" }] }`
5. Add to `allowedTools`: `mcp__freefsm__request_input`

**Integration Notes**: Builds on Step 3 — the agent now has full FSM control plus human interaction.

**Demo**: Run a workflow where a state's prompt says "ask the user for their name". Agent calls `request_input`, prompt appears in terminal, user types response, agent continues.

---

## Step 5: Add `allowed_tools` YAML Schema Extension

**Objective**: Let workflow YAML authors control which Claude Code tools the agent can access.

**Test Requirements**:
- Unit test: `loadFsm()` accepts YAML with `allowed_tools` field
- Unit test: `loadFsm()` accepts YAML without `allowed_tools` (backward compatible)
- Unit test: `allowed_tools` validation — must be string array
- Unit test: MCP tool names are always included regardless of `allowed_tools`

**Implementation Guidance**:
1. Extend `Fsm` interface in `fsm.ts`: add `allowed_tools?: string[]` (ref: design §5)
2. Add validation in `loadFsm()`: if present, must be array of strings
3. In `run.ts`: if `fsm.allowed_tools` is set, pass to `query()` as `allowedTools` with MCP tool names prepended. If unset, don't restrict tools (full toolset).

**Integration Notes**: Builds on Steps 2-4. No changes to MCP tools.

**Demo**: Create a YAML with `allowed_tools: [Read, Bash]`. Run it and verify the agent can't use Edit or Write.

---

## Step 6: Integration Testing and Cleanup

**Objective**: End-to-end testing with real and mock workflows, cleanup, documentation.

**Test Requirements**:
- Integration test: full workflow execution with a 3-state test FSM (mock Agent SDK responses)
- Integration test: verify events.jsonl and snapshot.json after completion
- Integration test: `request_input` with piped stdin
- Verify all existing tests still pass

**Implementation Guidance**:
1. Create a simple test FSM YAML for integration tests
2. Mock `query()` to return predetermined tool calls that drive the FSM through all states
3. Verify Store artifacts (events, snapshot) match expected state
4. Run `npm run check` (biome format + lint)
5. Run full test suite

**Integration Notes**: Final step — validates everything works together.

**Demo**: `npm test && npm run test:integration` — all green.
