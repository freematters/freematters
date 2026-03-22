# Progress — issue-to-pr workflow

## Step 1: Create the issue-to-pr workflow YAML
- **Files changed**: `packages/freeflow/workflows/issue-to-pr/workflow.yaml` (new)
- **What was built**: Workflow YAML composing github-spec-gen, spec-to-code, and pr-lifecycle with inline gate states (decide, confirm-implement, confirm-pr) and a start state for input detection
- **Tests**: 0 (schema validation is Step 2)
- **Notes**: Uses `extends_guide` from github-spec-gen, version 1.2 for workflow composition. Validated with loadFsm() — expands to 25 states.
