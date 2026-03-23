## requirements.md

### Q1: GitLab API authentication
**Q**: Should the workflow support `GITLAB_TOKEN` env var, config file, or both?
**A**: Must use `GITLAB_TOKEN` env var. User is responsible for setting it up.

### Q2: GitLab project identification
**Q**: Auto-detect project from git remote or require explicit input?
**A**: Auto-detect from git remote URL. Also use `glab` CLI instead of raw HTTP API — this changes the design significantly (simpler commands, auto-detection built in).

### Q3: Deliverable scope
**Q**: What files/workflows are expected after implementation?
**A**:
- `spec-gen` (base, exists)
- `github-spec-gen` (exists)
- `gitlab-spec-gen` (new)
- `spec-to-code` — modified to support both GitHub issue mode and GitLab issue mode
- `github-pr-lifecycle` (rename of current `pr-lifecycle`)
- `gitlab-mr-lifecycle` (new)
- `gitlab-issue-to-mr` (new — composes `gitlab-spec-gen` + `spec-to-code` + `gitlab-mr-lifecycle`)
- `issue-to-pr` — kept as-is (pointing to renamed `github-pr-lifecycle`)

### Q4: Composition workflows
**Q**: Create end-to-end composition workflows?
**A**: Yes, create `gitlab-issue-to-mr`. Keep `issue-to-pr` as-is.

Note: No `issue-to-code` base extraction needed — `issue-to-pr` stays unchanged, `gitlab-issue-to-mr` is a new standalone workflow.

### Q5: Testing strategy
**Q**: What testing approach?
**A**: Option B — unit tests (FSM schema validation) + e2e test plan (verifier-executor against real GitLab project).
- **GitLab test project**: `https://gitlab.corp.metabit-trading.com/ran.xian/test-proj`
- **GitLab instance**: `gitlab.corp.metabit-trading.com` (self-hosted)

### Compiled Requirements

**Functional:**
1. Create `gitlab-spec-gen` extending `spec-gen` with GitLab issue/notes interaction via `glab` CLI
2. Create `gitlab-mr-lifecycle` for monitoring GitLab MRs via `glab` CLI
3. Create `gitlab-issue-to-mr` composing the above with `spec-to-code`
4. Modify `spec-to-code` to support GitLab issue mode (notes, award emoji, etc.)
5. Rename `pr-lifecycle` → `github-pr-lifecycle`
6. Update `issue-to-pr` to reference renamed `github-pr-lifecycle`
7. Create GitLab polling scripts (`poll_issue_gl.py`, `poll_mr_gl.py`)

**Non-functional:**
- Auth: `GITLAB_TOKEN` env var only
- CLI: `glab` CLI (not raw HTTP/curl)
- Project detection: Auto-detect from git remote
- GitLab instance: Self-hosted (`gitlab.corp.metabit-trading.com`)
- Must not break existing `issue-to-pr` behavior

**Testing:**
- Unit tests: FSM schema validation for all new/modified workflow files
- E2E test plan: Verifier-executor against `ran.xian/test-proj` on `gitlab.corp.metabit-trading.com`
