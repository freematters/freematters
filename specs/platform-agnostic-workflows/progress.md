# Progress

## Step 1: Add --lite mode to spec-gen
- **Files changed**: `packages/freeflow/workflows/spec-gen/workflow.yaml`
- **What was built**: Added lite mode conditionals to design and plan states (4-section design, 1-step plan)
- **Tests**: No automated tests (manual verification per plan)
- **Notes**: Also committed batch-write requirements change from earlier in this conversation

## Step 2: Unify pr-lifecycle
- **Files changed**: `packages/freeflow/workflows/pr-lifecycle/workflow.yaml`, `scripts/poll_pr.py`, `scripts/poll_mr_gl.py`
- **What was built**: Unified pr-lifecycle workflow with platform-conditional branches in each state. Scripts copied to `scripts/` subdirectory.
- **Tests**: No automated tests (manual verification per plan)
- **Notes**: Platform-neutral transition labels (ready, merged, closed). All detail from both workflows preserved.
