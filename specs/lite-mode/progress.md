# Progress: Lite Mode for fflow

## Step 1: Extend data models and store
- **Files changed**: `packages/freeflow/src/store.ts`, `packages/freeflow/src/__tests__/store.test.ts`
- **What was built**: Added `lite?: boolean` to `RunMeta`, `visited_states?: string[]` to `Snapshot` and `SnapshotInput`. Updated `commit()` to propagate/carry-forward `visited_states`.
- **Tests**: 4 new unit tests, all passing
- **Notes**: None

## Step 2: Add formatLiteCard and simplify formatReminder
- **Files changed**: `packages/freeflow/src/output.ts`, `packages/freeflow/src/__tests__/output-lite.test.ts`, `packages/freeflow/src/__tests__/hooks/post-tool-use.test.ts`
- **What was built**: Added `formatLiteCard()` for abbreviated re-entry cards. Simplified `formatReminder()` to omit prompt excerpt — now shows only state name, guide, todos, and transitions.
- **Tests**: 6 new unit tests, 1 existing test updated, all passing
- **Notes**: None
