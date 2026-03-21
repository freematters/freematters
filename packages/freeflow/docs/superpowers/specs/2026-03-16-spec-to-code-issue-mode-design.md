# spec-to-code Issue Mode — Design Spec

## Overview

Extend the existing `spec-to-code.fsm.yaml` workflow to optionally accept a GitHub issue reference (`owner/repo#N`) as input instead of a local spec directory. When issue-sourced, the workflow downloads artifact comments from the issue, implements locally, pushes to a remote branch after each step, and reports progress back to the issue via `[from bot]` comments and checklist updates.

## Input Detection

The workflow argument determines the mode:

- **Local mode** (existing): argument is a local path (e.g., `./specs/my-feature/`)
- **Issue mode** (new): argument matches `owner/repo#N` pattern

The `load-spec` state detects the mode and stores `source_mode` ("local" or "issue") plus issue metadata (`owner`, `repo`, `issue_number`) in conversation memory.

## State-by-State Changes

### `load-spec`

**Local mode**: unchanged.

**Issue mode** (new branch):
1. Validate issue exists and has `spec-ready` label
2. Fetch all comments via `gh api --paginate`, find artifact comments (body starts with `## design.md`, `## plan.md`, `## requirements.md`, `## research/*.md`, `## e2e.md`)
3. Derive slug from issue title (lowercase, hyphens)
4. Save each artifact to `./specs/<slug>/<filename>`
5. Create branch: `git checkout -b issue-{n}-{slug}`
6. Store issue metadata for later states
7. Post `[from bot]` comment: "Starting implementation. Tracking on branch `issue-{n}-{slug}`."

### `implement`

Unchanged — works on local files regardless of source mode.

### `commit`

**Local mode**: unchanged (stage + commit).

**Issue mode** additions after commit:
1. Push to remote: `git push -u origin <branch>` (first) or `git push` (subsequent)
2. Update issue body checklist: `- [ ] Step N` → `- [x] Step N`
3. Post `[from bot]` comment with step summary + commit SHA link

Local `progress.md` still written (sub-agents read it).

### `spec-error`

**Local mode**: unchanged.

**Issue mode** addition: post `[from bot]` comment on issue describing the spec issue and local fix. Do NOT edit issue artifact comments.

### `e2e-test`

Unchanged.

### `review`

Unchanged, except: if issue mode, push after fix-review commits to keep remote current.

### `fix-review`

**Issue mode** addition: push after committing fixes.

### `checkpoint`

Unchanged.

### `done`

**Local mode**: unchanged.

**Issue mode** additions:
1. Ensure all commits pushed to remote
2. Post `[from bot]` summary comment on issue (branch, steps completed, tests)
3. Add `implementation-complete` label to issue
4. Suggest user run `/pr` for PR creation

## Guide Changes

Add conditional rules to the workflow guide:

```
### Issue Mode (when source is owner/repo#N)

- All issue comments MUST be prefixed with `[from bot]`
- Push to remote after every commit
- Update issue body checklist after each step
- Store issue metadata: owner, repo, issue_number, branch_name, source_mode
```

## What Does NOT Change

- The `implement` state and sub-agent prompts — they read local `./specs/<slug>/` files
- TDD discipline, YAGNI/KISS rules
- The FSM flow (states and transitions remain identical)
- Local `progress.md` append-only log
