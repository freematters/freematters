# Platform-Agnostic Workflow Consolidation

Consolidate the current platform-specific workflow variants into platform-agnostic workflows:

- **One `pr-lifecycle`** instead of `github-pr-lifecycle` + `gitlab-mr-lifecycle`
- **One `issue-to-spec`** (renamed from `*-spec-gen`) instead of `github-spec-gen` + `gitlab-spec-gen`
- **One `issue-to-pr`** instead of `issue-to-pr` + `gitlab-issue-to-mr`

Each workflow should auto-detect the platform (GitHub vs GitLab) and adapt accordingly.
The goal is to eliminate the duplication between GitHub and GitLab variants while keeping
all existing functionality.

## Current State

- 6 platform-specific workflows: `github-spec-gen`, `github-spec-gen-lite`, `github-pr-lifecycle`, `gitlab-spec-gen`, `gitlab-mr-lifecycle`, `gitlab-issue-to-mr`
- 4 Python polling/helper scripts with GitHub/GitLab variants: `poll_issue.py`/`poll_issue_gl.py`, `poll_pr.py`/`poll_mr_gl.py`, `download_spec.py`/`download_spec_gl.py`, `prepare_implementation.py`/`prepare_implementation_gl.py`
- 2 reference docs: `github-cli.md`, `gitlab-cli.md`
- Significant prompt duplication across GitHub/GitLab variants in workflow YAML states
