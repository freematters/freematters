# Progress: Issue-to-PR Lite Workflow

## Step 1: Implement the feature
- **Files changed**: `packages/freeflow/workflows/github-spec-gen-lite/workflow.yaml`, `packages/freeflow/workflows/issue-to-pr-lite/workflow.yaml`
- **What was built**: Two new workflow YAML files — github-spec-gen-lite (lite spec-gen with simplified 4-section design and 2-step plan) and issue-to-pr-lite (composition wrapper referencing the lite spec-gen)
- **Tests**: Validated via `fflow start` — FSM loads and enters start state successfully
- **Notes**: Both files use `extends_guide` and `from:` inheritance patterns consistent with existing workflows
