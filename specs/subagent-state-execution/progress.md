# Progress: Subagent State Execution

## Step 1: Schema — add `subagent` flag to FsmState
- **Files changed**: `packages/freeflow/src/fsm.ts`, `packages/freeflow/src/__tests__/fsm.test.ts`
- **What was built**: Added `subagent?: boolean` to `FsmState` interface, validation in `loadFsmInternal`, and inheritance through `from:` refs
- **Tests**: 4 tests added (schema accepts true/false, rejects non-boolean, backward compat), all passing
- **Notes**: None

## Step 2: Output — add `formatSubagentDispatch` function
- **Files changed**: `packages/freeflow/src/output.ts`, `packages/freeflow/src/__tests__/output.test.ts`
- **What was built**: Added `subagent?: boolean` to `StateCard`, propagation in `stateCardFromFsm`, new `formatSubagentDispatch()` function
- **Tests**: 4 tests added (dispatch rendering, formatStateCard independence, flag propagation), all passing
- **Notes**: None

## Step 3: Commands — route to dispatch format in start/goto
- **Files changed**: `packages/freeflow/src/commands/start.ts`, `packages/freeflow/src/commands/goto.ts`, `packages/freeflow/src/__tests__/subagent-commands.test.ts`
- **What was built**: Routed subagent states to `formatSubagentDispatch` in start and goto commands. JSON output includes `subagent` field. `current` unchanged.
- **Tests**: 6 tests added (start dispatch, goto dispatch, current normal, mixed workflow, JSON output), all passing
- **Notes**: None
