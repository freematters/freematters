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

## Step 7: Modify `spec-to-code` for GitLab issue mode
- **Files changed**: `workflows/spec-to-code/workflow.yaml` (modified), `download_spec_gl.py` (new), `prepare_implementation_gl.py` (new)
- **What was built**: Platform detection in setup state, GitLab-specific sections in implement/done states, GitLab variants of download_spec and prepare_implementation scripts
- **Tests**: 278 passing, no regression
- **Notes**: GitHub issue mode preserved unchanged; GitLab mode uses `glab api` throughout
