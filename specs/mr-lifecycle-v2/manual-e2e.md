# Manual E2E Testing Guide: mr-lifecycle v2

## Prerequisites

- GitHub CLI authenticated: `gh auth login`
- A test repo with GitHub Actions CI configured
- Code-review pipeline available (`code-review.fsm.yaml` or `/bot-review`)
- freefsm installed and working

## Test Setup

1. Create a test branch with intentional issues:
   - A typo in a comment (for `@bot` fix request)
   - A missing null check (for bot review blocker simulation)
   - Working CI that can be broken (e.g., a test you can make fail)

2. Push the branch and open a PR

3. Start the workflow:
   ```
   /freefsm:start mr-lifecycle
   ```

## Test Scenarios

### T1: Happy path — PR opens, CI passes, no issues

**Steps**:
1. Open a clean PR (no issues, CI passes)
2. Start mr-lifecycle
3. Wait for poll to detect CI completion
4. check finds no issues

**Expected**: `create-mr → poll → check → poll` (idle). No fixes applied.

### T2: `@bot` conversational reply

**Steps**:
1. While in poll, post in an inline review thread: `@bot why does this function exist?`
2. Wait for poll cycle to detect it

**Expected**:
- Bot replies in the same thread with `[from bot]` prefix
- Reaction added to the `@bot` comment
- Workflow stays in poll (no state transition)

### T3: `@bot` conversational reply dedup

**Steps**:
1. After T2, wait for the next poll cycle

**Expected**: The same `@bot` mention is NOT replied to again (a `[from bot]` note already follows it).

### T4: `@bot` code change request

**Steps**:
1. Post in an inline thread: `@bot fix the typo on line X`
2. Wait for poll to detect it

**Expected**:
- Workflow transitions: poll → fix → push → poll
- Typo is fixed in a new commit
- `[from bot]` comment posted on the thread explaining the fix
- Thread is NOT resolved (still open)

### T5: `@bot` on issue comment

**Steps**:
1. Post a PR-level comment: `@bot what's the test coverage for this change?`
2. Wait for reply
3. Wait for next poll cycle

**Expected**:
- Bot replies with `[from bot]` prefix
- Reaction added to the original comment
- Not re-processed on subsequent cycles

### T6: Bot review blocker auto-fix

**Steps**:
1. Trigger code-review: `/bot-review` or let it run on PR open
2. Ensure code-review posts at least one `**blocker**` inline comment
3. Wait for poll → check

**Expected**:
- check identifies the blocker
- Transitions to fix, applies the fix
- push commits with `[from bot]` comment on the thread
- Thread remains unresolved

### T7: Bot review major ignored

**Steps**:
1. Ensure code-review has posted a `**major**` inline comment
2. Wait for poll → check

**Expected**: Major comment is NOT included in the fix list. Only blockers are auto-fixed.

### T8: Auto-fix round limit (3 rounds)

**Steps**:
1. Trigger 3 rounds of auto-fix cycles (break CI or have recurring blockers)
2. On the 4th cycle, check finds more blockers

**Expected**:
- Blockers are skipped (not auto-fixed)
- Summary comment posted on PR listing remaining issues
- Workflow enters poll idle
- `@bot` still works (test by posting `@bot` after idle)

### T9: `@bot` overrides bot review

**Steps**:
1. Code-review posts a blocker: "add error handling to this function"
2. Post: `@bot don't add error handling here, it's intentional`
3. Wait for fix state to process

**Expected**: Bot follows user instruction, skips the blocker. `[from bot]` comment explains the decision.

### T10: Rebase via normal flow

**Steps**:
1. While MR is open, push a commit to the target branch (main)
2. Wait for poll to detect

**Expected**:
- poll exits → check detects rebase needed → fix rebases → push force-pushes → poll
- Branch is up to date with target

### T11: Code-review auto-resolve

**Steps**:
1. After T6 (blocker was fixed and pushed), trigger `/bot-review`
2. Check the review thread

**Expected**: Code-review pipeline verifies the fix and resolves the thread.

### T12: Code-review responds to rebuttal

**Steps**:
1. Find an unresolved bot review thread
2. Reply: "this is intentional, we don't need this check because X"
3. Trigger `/bot-review`

**Expected**: Code-review re-evaluates. If user is right → confirms + resolves. If not → explains why + keeps open.

### T13: MR merge terminates workflow

**Steps**:
1. Approve and merge the PR
2. Wait for poll to detect

**Expected**: Workflow transitions to `done`. Summary output shows: MR URL, fix rounds, `@bot` interactions.

## Debugging

**Check current workflow state**:
```bash
freefsm current --run-id <run-id>
```

**Check event history**:
```bash
cat ~/.freefsm/runs/<run-id>/events.jsonl
```

**Test `@bot` detection manually** (GitHub GraphQL):
```bash
gh api graphql -f query='
  query { repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: N) {
      reviewThreads(first: 100) {
        nodes { isResolved comments(first: 20) {
          nodes { body createdAt author { login __typename } }
        }}
      }
    }
  }
}'
```

**Test issue comment detection**:
```bash
gh api repos/OWNER/REPO/issues/N/comments --jq '.[] | {id, author: .user.login, body: .body[:80]}'
```

**Check reactions on a comment**:
```bash
gh api repos/OWNER/REPO/issues/comments/COMMENT_ID/reactions
```

**Poll script not detecting events**: Check terminal output for `RESULT:` lines. If the script crashed, check for Python errors in stdout.
