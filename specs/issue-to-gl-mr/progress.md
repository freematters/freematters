# Implementation Progress: GitLab Workflow Support

## Step 1: Rename `pr-lifecycle` → `github-pr-lifecycle`
- **Files changed**: `workflows/pr-lifecycle/` → `workflows/github-pr-lifecycle/`, updated references in `issue-to-pr`, `idea-to-pr`, `.claude/commands/pr.md`, `AGENTS.md`, tests
- **What was built**: Renamed directory and updated all workflow/test references
- **Tests**: 278 passing, no changes to test count
- **Notes**: Pure rename, no behavior change

## Step 3: Create `poll_issue_gl.py` polling script
- **Files changed**: `workflows/gitlab-spec-gen/poll_issue_gl.py` (new)
- **What was built**: GitLab equivalent of `poll_issue.py` using `glab api`, with `--hostname` support for self-hosted instances, URL-encoded project paths, `author.username` filtering, award emoji reactions
- **Tests**: Script-level (no unit test framework for Python scripts)
- **Notes**: Counts non-system notes since GitLab doesn't expose comment count directly

## Step 5: Create `poll_mr_gl.py` polling script
- **Files changed**: `workflows/gitlab-mr-lifecycle/poll_mr_gl.py` (new)
- **What was built**: GitLab equivalent of `poll_pr.py` — monitors MR state, pipeline status, discussions, @bot mentions. Writes `mr_status.json`. Uses REST discussions endpoint (no GraphQL needed), native rebase detection via `detailed_merge_status`
- **Tests**: Script-level
- **Notes**: Simpler than GitHub version — thread resolution via REST PUT, CI status embedded in MR object

## Step 2: Create `gitlab-spec-gen` workflow
- **Files changed**: `workflows/gitlab-spec-gen/workflow.yaml` (new)
- **What was built**: GitLab-specific spec-gen workflow using `extends_guide` + `from:` to inherit spec-gen states, with `### GitLab Adaptation` sections replacing all `gh` CLI with `glab` equivalents. Artifact storage via GitLab notes, polling via `poll_issue_gl.py`, award emoji reactions.
- **Tests**: 278 passing
- **Notes**: Research state only has `back to requirements` transition (no `proceed to design`)

## Step 4: Create `gitlab-mr-lifecycle` workflow
- **Files changed**: `workflows/gitlab-mr-lifecycle/workflow.yaml` (new)
- **What was built**: GitLab MR monitoring workflow with 7 states (create-mr, poll, fix, rebase, address, push, done). Uses native GitLab rebase API, REST thread resolution (no GraphQL), CI status embedded in MR object.
- **Tests**: 278 passing
- **Notes**: Simpler than GitHub variant — REST PUT for thread resolution, native rebase API

## Step 6: Create `gitlab-issue-to-mr` composition workflow
- **Files changed**: `workflows/gitlab-issue-to-mr/workflow.yaml` (new)
- **What was built**: End-to-end GitLab workflow composing `gitlab-spec-gen` + `spec-to-code` + `gitlab-mr-lifecycle`. 8 states: start, spec, decide, confirm-implement, implement, confirm-mr, submit-mr, done. Auto-detects GitLab hostname from git remote.
- **Tests**: 309 passing (10 new composition tests)
- **Notes**: Follows issue-to-pr pattern exactly, with glab CLI throughout

## Step 7: Modify `spec-to-code` for GitLab issue mode
- **Files changed**: `workflows/spec-to-code/workflow.yaml` (modified), `download_spec_gl.py` (new), `prepare_implementation_gl.py` (new)
- **What was built**: Platform detection in setup state, GitLab-specific sections in implement/done states, GitLab variants of download_spec and prepare_implementation scripts
- **Tests**: 278 passing, no regression
- **Notes**: GitHub issue mode preserved unchanged; GitLab mode uses `glab api` throughout

## Step 8: Integration tests
- **Files changed**: `src/__tests__/workflow-gitlab.test.ts` (new)
- **What was built**: 31 integration tests covering all new/modified workflows: gitlab-spec-gen (6), gitlab-mr-lifecycle (4), gitlab-issue-to-mr composition (10), github-pr-lifecycle rename (3), issue-to-pr backward compat (5), research transition constraints (3)
- **Tests**: 309 passing (31 new)
- **Notes**: All FSM schema validation, composition expansion, and transition constraint tests pass
