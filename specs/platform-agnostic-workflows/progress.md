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

## Step 3: Unify issue-to-spec
- **Files changed**: `packages/freeflow/workflows/issue-to-spec/workflow.yaml`, `scripts/poll_issue.py`, `scripts/poll_issue_gl.py`
- **What was built**: Unified issue-to-spec workflow merging github-spec-gen, gitlab-spec-gen, and github-spec-gen-lite. Platform conditionals + lite mode support.
- **Tests**: No automated tests (manual verification per plan)
- **Notes**: Artifact management pattern shared in guide, platform-specific API details in each state.

## Step 4: Unify issue-to-pr
- **Files changed**: `packages/freeflow/workflows/issue-to-pr/workflow.yaml`
- **What was built**: Unified issue-to-pr workflow supporting both GitHub and GitLab with --lite mode. References unified sub-workflows.
- **Tests**: No automated tests
- **Notes**: Platform detection in start state, conditional gates for both platforms.

## Step 5: Delete old workflows
- **Files changed**: Deleted 8 workflow directories (github-spec-gen, github-spec-gen-lite, gitlab-spec-gen, github-pr-lifecycle, gitlab-mr-lifecycle, gitlab-issue-to-mr, issue-to-pr-lite, spec-gen-lite, idea-to-pr-lite)
- **What was built**: N/A (deletion)
- **Tests**: Verified old workflow names fail to resolve via `fflow render`

## Step 6: Update references and commands
- **Files changed**: AGENTS.md, .claude/commands/pr.md, .claude/commands/quick.md, skills/fflow/SKILL.md, skills/fflow-author/composability.md, spec-to-code/workflow.yaml, idea-to-pr/workflow.yaml
- **What was built**: Updated all references from old workflow names to new unified names
- **Tests**: Grepped codebase for old names, verified no dangling references in active code

## Review
- All 5 new/modified workflows render successfully via `fflow render`
- Build passes, all 224 tests pass
- Consistency review: all platform branches present, script paths correct, no stale references
- Sub-workflow composition verified: fflow runtime replaces child `done` transitions with parent-declared transitions (fsm.ts:339-341)
