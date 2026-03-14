# Implementation Plan: mr-lifecycle v2

## Checklist
- [x] Step 1: Restructure state flow (merge poll, remove !fix, update transitions)
- [ ] Step 2: Implement `@bot` detection and conversational reply in poll
- [ ] Step 3: Implement `@bot` code change flow (poll → fix → push → poll)
- [ ] Step 4: Bot review severity filtering and auto-fix round limit
- [ ] Step 5: Remove resolve from push, add comment-only behavior
- [ ] Step 6: Update code-review pipeline (respond-and-resolve + `/bot-review` trigger)
- [ ] Step 7: Manual E2E testing (see manual-e2e.md)

---

## Step 1: Restructure state flow

**Objective**: Transform the v1 state machine into the v2 structure — merge `wait-for-pipeline` + `wait-for-input` into `poll`, extract rebase from polling, remove all `!fix` references.

**Test Requirements**: Load the updated YAML with `freefsm start` and verify all states parse correctly. Walk through each transition with `freefsm goto` to confirm the state graph is valid.

**Implementation Guidance**:
- Rename `wait-for-pipeline` → `poll`. Delete `wait-for-input`.
- Merge monitoring logic: `poll` monitors CI completion, target branch updates, `@bot` mentions, merge/close (see design.md §4.2).
- Remove all `!fix` references from every state's prompt and todos.
- Update `poll` transitions: `pipelines finished` → check, `fix requested` → fix, `MR merged` → done, `MR closed` → done.
- Remove rebase logic from `poll` prompt. Add `target branch updated` as a poll exit → `check`. In `check`, add rebase detection. In `fix`, keep rebase handling.
- Update `create-mr` transition: `MR ready` → `poll`.

**Integration Notes**: This is a structural refactor of the YAML. All subsequent steps build on this new structure.

**Demo**: `freefsm start mr-lifecycle.fsm.yaml --run-id test-1` succeeds. Walk through `create-mr → poll → check → fix → push → poll → done` with `freefsm goto`. All transitions valid.

---

## Step 2: Implement `@bot` detection and conversational reply in poll

**Objective**: Enable poll to detect `@bot` mentions and reply conversationally in-place, with `[from bot]` prefix and dedup logic.

**Test Requirements**: Create a test MR with `@bot` comments. Verify poll detects them, replies with `[from bot]` prefix, adds reaction, and skips already-replied mentions on next cycle.

**Implementation Guidance**:
- In `poll` prompt, add `@bot` mention detection instructions (see design.md §2.1 dedup logic):
  - Inline threads: check if every user note with `@bot` is followed by a `[from bot]` note
  - Issue comments: check if a `[from bot]` reply exists for each `@bot` comment
- Add instruction to reply with `[from bot]` prefix
- Add instruction to react to `@bot` comment after replying
- Conversational `@bot` mentions are handled in-place (no state transition) — the polling script prints status but continues
- Mention that `@bot` conversation detection should happen on each poll cycle, not just at exit

**Integration Notes**: Builds on Step 1's `poll` state. Does not yet handle code-change `@bot` requests.

**Demo**: Post `@bot explain this function` on a test MR. Observe poll detects and replies with `[from bot]` prefix + reaction. Post again — second mention is skipped.

---

## Step 3: Implement `@bot` code change flow

**Objective**: Enable `@bot` mentions that request code changes to exit poll and flow through fix → push → poll.

**Test Requirements**: Post `@bot please fix the typo on line 5` on a test MR. Verify poll exits with `fix requested`, fix state applies the change, push state commits/pushes and comments with `[from bot]`, workflow returns to poll.

**Implementation Guidance**:
- In `poll` prompt, add intent analysis: when `@bot` mention requires code change, the polling script should exit with `RESULT: fix requested` and include the `@bot` context (comment body, file path if inline).
- In `fix` prompt, add `@bot` code change as a fix source with priority (see design.md §4.4): CI failures > `@bot` requests > bot review blockers.
- Add user priority rule: if `@bot` contradicts a bot review blocker, follow user's instruction (design.md §2.1).
- In `push` prompt, add instruction to comment with `[from bot]` prefix on addressed threads. Explicitly state: do NOT resolve threads.

**Integration Notes**: Builds on Steps 1-2. The fix and push states now handle `@bot`-originated work alongside CI/review work.

**Demo**: Post `@bot add a null check here` on an inline thread. Observe: poll exits → fix applies change → push commits with `[from bot]` comment → returns to poll.

---

## Step 4: Bot review severity filtering and auto-fix round limit

**Objective**: Only auto-fix blocker-severity bot reviews, skip major. Limit auto-fix to 3 rounds.

**Test Requirements**: Verify check state skips major-severity comments. Verify auto-fix counter increments only for CI/blocker fixes. Verify at round 4, check state stops auto-fixing and enters poll idle.

**Implementation Guidance**:
- In `check` prompt, update bot review detection to parse severity (design.md §5.4). Only include blocker in fix list. Explicitly skip major.
- Add `auto_fix_rounds` counter tracking. Instructions should tell the agent to track this across cycles (e.g., note in MR description or in-conversation state).
- In `check`, if `auto_fix_rounds >= 3`, skip bot review blockers. Only `@bot` requests and CI failures (if any) remain actionable. If nothing actionable → transition to `poll` (idle mode).
- In `fix`, increment counter only when fixing CI failures or bot review blockers (not `@bot` requests). See design.md §4.4.
- When limit reached, add instruction to comment on MR summarizing remaining issues.

**Integration Notes**: Builds on Steps 1-3. The check and fix states now have conditional logic based on severity and round count.

**Demo**: Simulate 3 rounds of bot blocker fixes. On round 4, verify check skips blockers, posts summary, enters poll idle. Verify `@bot` still works in idle mode.

---

## Step 5: Remove resolve from push, add comment-only behavior

**Objective**: mr-lifecycle must never resolve review threads. Push state only comments.

**Test Requirements**: After push, verify no threads are resolved. Verify `[from bot]` comments are posted on addressed threads.

**Implementation Guidance**:
- In `push` prompt, remove all resolve instructions (GitLab resolve API, GitHub thread resolution).
- Keep comment instructions: reply to addressed review threads explaining what was fixed, prefixed with `[from bot]`.
- Remove resolve-related todos from push state.
- Update push todos to reflect: comment on threads, react to `@bot` comments, push, update description.

**Integration Notes**: This is a simplification of the existing push state. Resolve responsibility is now entirely with the code-review pipeline (Step 6).

**Demo**: Run a full fix → push cycle. Verify threads have `[from bot]` comments but remain unresolved.

---

## Step 6: Update code-review pipeline (respond-and-resolve + `/bot-review` trigger)

**Objective**: Update `code-review.fsm.yaml` to align with v2 design, and set up `/bot-review` as the manual trigger mechanism.

**Test Requirements**:
- Verify code-review auto-resolves threads where issues are fixed.
- Verify code-review responds to user rebuttals.
- Verify `/bot-review` comment triggers code-review via GitHub Actions.

**Implementation Guidance**:

### 6a: `/bot-review` GitHub Actions trigger
- Update the code-review CI workflow (`.github/workflows/`) to support two triggers:
  - `pull_request: types: [opened]` — automatic on PR creation
  - `issue_comment: types: [created]` — manual via `/bot-review` comment
- Add job condition: `github.event.action == 'opened'` OR (`issue_comment` + `github.event.issue.pull_request` + comment body contains `/bot-review`)
- See design.md §2.2.

### 6b: Code-review respond-and-resolve alignment
- Verify `code-review.fsm.yaml` `post-and-resolve` state handles:
  - Auto-resolve: check current code to verify issues are fixed before resolving (already present)
  - User rebuttal: detect user replies, evaluate argument, confirm+resolve or explain+keep open (already present)
  - Pending reply detection: every user note should eventually have a bot note after it
- Add `[from bot]`-awareness: mr-lifecycle comments appear as user identity with `[from bot]` prefix. Code-review should recognize these as agent-generated but treat them as user messages for reply detection purposes.
- Update guide section to describe the division of labor with mr-lifecycle.

**Integration Notes**: This step bridges mr-lifecycle and code-review. After this, the two workflows have clear, documented responsibilities.

**Demo**:
- Post `/bot-review` as a PR comment → code-review pipeline triggers.
- After mr-lifecycle fixes a blocker, run `/bot-review` → code-review verifies fix and resolves thread.

---

## Step 7: Manual E2E testing

**Objective**: End-to-end validation of the complete v2 workflow on a real PR.

**Test Requirements**: Run through all scenarios in `manual-e2e.md` (T1–T13).

**Implementation Guidance**:
- Follow `specs/mr-lifecycle-v2/manual-e2e.md` for setup, scenarios, and debugging.
- Search for any remaining `!fix` references and remove them.
- Verify YAML schema validity with `freefsm start`.
- Review all state prompts for consistency with the v2 design.

**Integration Notes**: Final validation step. All previous steps should be complete.

**Demo**: Full end-to-end run covering all 13 manual test scenarios.
