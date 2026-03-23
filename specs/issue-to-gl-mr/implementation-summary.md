# Implementation Summary: GitLab Workflow Support

## Overview

Added full GitLab workflow support to fflow by creating `gitlab-spec-gen`, `gitlab-mr-lifecycle`, and `gitlab-issue-to-mr` workflows that mirror the existing GitHub equivalents. Uses `glab` CLI for all GitLab interactions with `GITLAB_TOKEN` env var authentication. Also renamed `pr-lifecycle` → `github-pr-lifecycle` for naming consistency, extended `spec-to-code` to support GitLab issue mode, and fixed the spec-gen research state to only allow transitioning back to requirements.

## Steps Completed

| Step | Title | Commit |
|------|-------|--------|
| 1 | Rename `pr-lifecycle` → `github-pr-lifecycle` | `6a25d3b` |
| 2 | Create `gitlab-spec-gen` workflow | `a9b531a` |
| 3 | Create `poll_issue_gl.py` polling script | `f12451c` |
| 4 | Create `gitlab-mr-lifecycle` workflow | `40ccda9` |
| 5 | Create `poll_mr_gl.py` polling script | `fa47e47` |
| 6 | Create `gitlab-issue-to-mr` composition workflow | `064b3d3` |
| 7 | Modify `spec-to-code` for GitLab issue mode | `aadea42` |
| 8 | Integration tests | `8c06b8c` |

## Test Summary

- **Total tests**: 309 (31 new)
- **All passing**: Yes
- **Coverage**: FSM schema validation, composition expansion, transition constraints, backward compatibility

## Files Created/Modified

| File | Description |
|------|-------------|
| `workflows/gitlab-spec-gen/workflow.yaml` | GitLab spec-gen extending spec-gen via `from:` + `extends_guide` |
| `workflows/gitlab-spec-gen/poll_issue_gl.py` | Polls GitLab issue notes for user replies |
| `workflows/gitlab-mr-lifecycle/workflow.yaml` | GitLab MR monitoring (create, poll, fix, rebase, address, push, done) |
| `workflows/gitlab-mr-lifecycle/poll_mr_gl.py` | Monitors MR status, pipeline, discussions, @bot mentions |
| `workflows/gitlab-issue-to-mr/workflow.yaml` | End-to-end composition: gitlab-spec-gen + spec-to-code + gitlab-mr-lifecycle |
| `workflows/github-pr-lifecycle/` | Renamed from `pr-lifecycle/` |
| `workflows/spec-to-code/workflow.yaml` | Added GitLab issue mode detection and instructions |
| `workflows/spec-to-code/download_spec_gl.py` | Downloads spec artifacts from GitLab issue notes |
| `workflows/spec-to-code/prepare_implementation_gl.py` | Creates branch, adds labels on GitLab |
| `src/__tests__/workflow-gitlab.test.ts` | 31 integration tests for GitLab workflows |

## How to Run

```bash
npm run build        # Build TypeScript
npm test             # Run all 309 tests

# Start GitLab issue-to-MR workflow
fflow start workflows/gitlab-issue-to-mr/workflow.yaml --run-id my-run
```

## Remaining Work

- E2E test (`specs/issue-to-gl-mr/e2e.md`) not yet executed — requires `glab` CLI + `GITLAB_TOKEN` + network access to `gitlab.corp.metabit-trading.com`
- `glab` v1.89.0 does not support `--jq` flag — scripts pipe through `jq` instead
