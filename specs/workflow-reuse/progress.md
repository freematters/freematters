# Progress: Workflow State Reuse

## Step 1: Core ref resolution in loadFsm
- **Files changed**: `packages/freeflow/src/fsm.ts`, `packages/freeflow/src/__tests__/fsm-reuse.test.ts`, 14 fixture YAMLs
- **What was built**: `from: workflow#state` ref resolution — loadFsm split into public + internal, resolveRefs() parses refs, loads base states recursively, merges prompt/transitions/todos, detects cycles
- **Tests**: 13 new tests, all passing (124 total)
- **Notes**: None — clean implementation matching design.md spec

## Step 2: extends_guide support
- **Files changed**: `packages/freeflow/src/fsm.ts`, `packages/freeflow/src/__tests__/fsm-reuse.test.ts`, 7 fixture YAMLs
- **What was built**: `extends_guide` top-level field — resolveExtendsGuide() loads base workflow guide, merges with local guide using `{{base}}` semantics
- **Tests**: 6 new tests, all passing (130 total)
- **Notes**: None
