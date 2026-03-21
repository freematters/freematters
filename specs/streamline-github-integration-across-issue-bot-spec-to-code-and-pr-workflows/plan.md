# Implementation Plan: Streamline GitHub Integration

## Checklist
- [x] Step 1: spec-to-code progress posting to issue
- [x] Step 2: code-review spec fetching from linked issue
- [x] Step 3: issue-bot done state: plan checklist + workflow chaining
- [x] Step 4: PR-lifecycle source issue as parameter

---

## Step 1: spec-to-code progress posting to issue

**Depends on**: none

**Objective**: Replace local progress files (progress.md, review-round-N.md, implementation-summary.md, e2e-report.md) with GitHub issue comments. Remove source-issue file. spec-to-code checks off plan items in the issue body (already populated by issue-bot).

**Implementation Guidance**:
- In `implement` state: remove `progress.md` writes. Add `[from bot]` progress comment per step. Re-read issue body, check off step, update via `gh issue edit`. Reference design §4.2.2.
- In `e2e-test` state: remove `e2e-report.md` write. Post `[from bot] **E2E Tests**` comment. Check off "E2E tests" in issue body. Reference design §4.2.3.
- In `review` state: remove `review-round-N.md` writes. Post `[from bot] **Code Review (Round {n})**` comment. Reference design §4.2.4.
- In `done` state: remove `implementation-summary.md` and `source-issue` writes. Keep summary comment on issue. Reference design §4.2.5.
- In `setup` state: remove `source-issue` write from `prepare_implementation.py`.

---

## Step 2: code-review spec fetching from linked issue

**Depends on**: none

**Objective**: When code-review processes a PR with a `Closes #N` link, fetch design.md and plan.md from the linked issue and provide them to review sub-agents for design-compliance checks.

**Implementation Guidance**:
- In `code-review/workflow.yaml` init state: parse PR body for `Closes #N` / `Resolves owner/repo#N` regex. If match, fetch issue comments, extract `## design.md` and `## plan.md`, write to `/tmp/pr_design.md` and `/tmp/pr_plan.md`. Reference design §4.3.
- In agent instruction files (`agents/code-quality.md`, `agents/security.md`, `agents/performance.md`): add design-compliance check when `/tmp/pr_design.md` exists.
- In post-and-resolve state: if no spec found, note in summary comment.

---

## Step 3: issue-bot done state: plan checklist + workflow chaining

**Depends on**: none

**Objective**: In issue-bot's done state, ensure the issue body has plan step checkboxes (plus E2E item). Add semi-automatic handoff to spec-to-code with auto-chain option.

**Implementation Guidance**:
- In `issue-bot/workflow.yaml` done state:
  1. Re-read issue body. Ensure `## Plan` has checkboxes for all steps + `- [ ] E2E tests` if e2e.md generated.
  2. Post handoff comment with 3 options (design §4.1).
  3. Poll for reply. Option 1/2 → instruct agent to run `/spec-to-code {repo}#{issue}`. Option 3 → terminal.

---

## Step 4: PR-lifecycle source issue as parameter

**Depends on**: Step 1

**Objective**: PR-lifecycle receives source issue reference as a parameter instead of reading from file. Uses it to add `Closes #N` to PR description.

**Implementation Guidance**:
- In `pr-lifecycle/workflow.yaml` create-pr state: replace `./specs/*/source-issue` file read with parameter check. If `--source-issue` provided, add `Closes #{N}`. Reference design §4.4.
- In `spec-to-code/workflow.yaml` done state (issue mode): when chaining, invoke `/pr --source-issue {repo}#{issue}`.
