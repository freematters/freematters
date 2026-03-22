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
