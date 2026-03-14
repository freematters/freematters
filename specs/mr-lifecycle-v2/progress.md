# Progress — mr-lifecycle v2

## Step 1: Restructure state flow
- **Files changed**: `freefsm/workflows/mr-lifecycle.fsm.yaml`
- **What was built**: Transformed the v1 state machine into v2 structure — merged `wait-for-pipeline` and `wait-for-input` into a single `poll` state, removed all `!fix` references (replaced with `@bot` interaction model), extracted rebase detection from polling into `check` state, updated transitions (`create-mr` -> `poll`, `check` all-clear -> `poll`, `fix` nothing-to-fix -> `poll`, `push` -> `poll`), and updated the guide section to replace `!fix`/jq tips with `@bot`-oriented guidance.
- **Tests**: All validation passed:
  - `freefsm start mr-lifecycle.fsm.yaml --run-id test-step1` — YAML parses correctly, all 6 states loaded (create-mr, poll, check, fix, push, done)
  - Full path walk-through: `create-mr -> poll -> check -> fix -> push -> poll -> done` — all transitions valid
  - Alternate paths verified: `poll -> fix` (fix requested via @bot), `fix -> poll` (nothing to fix), `check -> poll` (all clear), `poll -> done` (MR closed)
- **Notes**: The project workflow file and the global npm install (`~/.nvm/.../freefsm/workflows/`) are the same file (symlink), so no separate copy was needed.

## Step 2: Implement @bot detection and conversational reply in poll
- **Files changed**: `freefsm/workflows/mr-lifecycle.fsm.yaml`, `specs/mr-lifecycle-v2/progress.md`
- **What was built**: Enhanced the `poll` state prompt with detailed `@bot` mention detection and conversational reply instructions, including platform-specific dedup logic matching design.md §5.3 — inline thread dedup via `[from bot]` note ordering, issue comment dedup via ✅ reaction check, reply-then-react workflow, and explicit per-cycle scanning emphasis.
- **Tests**: All validation passed:
  - `freefsm start freefsm/workflows/mr-lifecycle.fsm.yaml --run-id test-step2` — YAML parses correctly
  - `freefsm goto poll --run-id test-step2 --on "MR ready"` — poll state prompt contains all @bot detection instructions (inline thread dedup, issue comment dedup, `[from bot]` reply format, ✅ reaction dedup signal, per-cycle scanning)
  - Dedup logic matches design.md §5.3: inline threads use timestamp-ordered `[from bot]` note check, issue comments use ✅ reaction check
  - `freefsm finish --run-id test-step2` — clean up succeeded
- **Notes**: Code-change `@bot` mentions are noted in the prompt but deferred to Step 3 for full implementation. All `@bot` mentions are treated as conversational for now.

## Step 3: Implement @bot code change flow (poll -> fix -> push -> poll)
- **Files changed**: `freefsm/workflows/mr-lifecycle.fsm.yaml`, `specs/mr-lifecycle-v2/progress.md`
- **What was built**: Enabled `@bot` mentions that request code changes to exit poll and flow through fix -> push -> poll. Three state prompts were updated:
  - **poll**: Replaced placeholder code-change handling with full intent analysis — action verb detection (fix, add, remove, change, etc.), context printing (comment body, file path, line range for inline threads), exit with `RESULT: fix requested`, and intent ambiguity resolution rules (code-change when referencing specific code/files, conversational for why/how questions).
  - **fix**: Restructured as explicit priority-ordered fix sources (CI failures > `@bot` requests > bot review blockers) per design.md §4.4. Added user priority rule: `@bot` instructions override conflicting bot review blockers (design.md §2.1).
  - **push**: Added separate instructions for commenting on addressed `@bot` code change threads with `[from bot]` prefix + ✅ reaction dedup. Added explicit "Do NOT resolve threads" rule for both review threads and `@bot` threads.
- **Tests**: All validation passed:
  - `freefsm start freefsm/workflows/mr-lifecycle.fsm.yaml --run-id test-step3` — YAML parses correctly
  - Full cycle walk-through: `create-mr -> poll -> fix -> push -> poll -> done` — all transitions valid via `freefsm goto`
  - Poll prompt contains: intent analysis with action verb detection, context printing instructions, `RESULT: fix requested` exit, intent ambiguity resolution
  - Fix prompt contains: priority-ordered fix sources (CI > @bot > bot review blockers), user priority rule for @bot vs bot review conflicts
  - Push prompt contains: `[from bot]` comment instruction for addressed @bot threads, explicit "Do NOT resolve threads" rule
  - `freefsm finish --run-id test-step3` — run reached terminal `done` state (already completed)

## Step 4: Bot review severity filtering and auto-fix round limit
- **Files changed**: `freefsm/workflows/mr-lifecycle.fsm.yaml`, `specs/mr-lifecycle-v2/progress.md`
- **What was built**: Added bot review severity filtering and auto-fix round limiting to the `check` and `fix` states. Two state prompts were updated:
  - **check**: Added `## Auto-fix round tracking` section — `auto_fix_rounds` counter initialized on first entry, read from conversation history on subsequent entries, max 3 rounds. Added severity parsing instructions (detect `[BLOCKER]`, `[MAJOR]`, `<!-- severity: blocker -->` markers). Added severity filtering: blocker included only if `auto_fix_rounds < 3`, major never included. Added round-limit-reached behavior: post `[from bot]` summary comment listing remaining unresolved issues, then transition to `poll` idle mode. Updated todos to reflect severity parsing, counter tracking, and summary comment posting.
  - **fix**: Added `## Auto-fix round counter` section — increment `auto_fix_rounds` by 1 only when fixing CI failures or bot review blockers (not `@bot` requests per design.md §4.4). Explicit instruction to state the new counter value for conversation history tracking. Updated todos to include counter increment step.
  - **done**: Updated summary to say "auto-fix rounds used (out of 3 max)" for clarity.
- **Tests**: All validation passed:
  - `freefsm start freefsm/workflows/mr-lifecycle.fsm.yaml --run-id test-step4` — YAML parses correctly
  - Walk-through `create-mr -> poll -> check -> fix` — all transitions valid
  - Check state prompt contains: auto_fix_rounds tracking, severity parsing (BLOCKER/MAJOR markers), severity filtering (blocker only if < 3 rounds, major never), round limit summary comment instructions, idle mode transition
  - Fix state prompt contains: auto_fix_rounds increment rule (CI/blocker only, not @bot), explicit value stating instruction for conversation history
  - `freefsm finish --run-id test-step4` — clean up succeeded

## Step 5: Remove resolve from push, add comment-only behavior
- **Files changed**: `freefsm/workflows/mr-lifecycle.fsm.yaml`, `specs/mr-lifecycle-v2/progress.md`
- **What was built**: Strengthened the `push` state to enforce comment-only behavior with an explicit "NEVER resolve threads" rule. Changes to the push state:
  - Added a `## CRITICAL RULE: NEVER resolve threads` section at the top of the prompt, listing specific API mechanisms to avoid (GitLab `PUT /discussions/:id` with `resolved: true`, GitHub GraphQL `resolveReviewThread` mutation).
  - Restructured the prompt into a clear numbered action list (commit/push, comment on review threads, comment on @bot threads, react, update description).
  - Updated todos: reordered to put commit/push first, added explicit "NEVER resolve threads" reminder as the final todo item.
  - Verified no resolve instructions exist anywhere in the push state — all "resolve" mentions are the prohibition rule itself.
- **Tests**: All validation passed:
  - `freefsm start freefsm/workflows/mr-lifecycle.fsm.yaml --run-id test-step5` — YAML parses correctly
  - Full path walk-through: `create-mr -> poll -> fix -> push -> poll -> done` — all transitions valid
  - Push state prompt contains: "CRITICAL RULE: NEVER resolve threads" with specific API examples, `[from bot]` comment instructions for both review threads and @bot threads, ✅ reaction instructions
  - Push state prompt does NOT contain any resolve instructions (no resolve API calls, no resolveReviewThread mutations)
  - Grep confirmed: all "resolve" mentions in push state are part of the prohibition rule
  - `test-step5` run completed to terminal `done` state

## Step 6: Update code-review pipeline (respond-and-resolve + /bot-review trigger)
- **Files changed**: `.github/workflows/code-review.yml`, `freefsm/workflows/code-review.fsm.yaml`, `specs/mr-lifecycle-v2/progress.md`
- **What was built**: Two-part update bridging mr-lifecycle and code-review responsibilities.
  - **6a — `/bot-review` GitHub Actions trigger**: Updated `.github/workflows/code-review.yml` to support two triggers: `pull_request: types: [opened]` (automatic on PR creation only, removed `synchronize` and `reopened`) and `issue_comment: types: [created]` (manual via `/bot-review` comment). Added compound job condition checking event type, `github.event.issue.pull_request` presence, and comment body containing `/bot-review`. Added a step to resolve the PR head SHA for `issue_comment` events (since `github.event.pull_request` is not available). Updated concurrency group to handle both event types.
  - **6b — Code-review respond-and-resolve alignment**: Updated `code-review.fsm.yaml` guide section with: division of labor between code-review and mr-lifecycle (who posts, who resolves, who fixes), `[from bot]` awareness section explaining how mr-lifecycle comments appear under user identity with `[from bot]` prefix and how code-review should treat them. Updated `post-and-resolve` state: added `[from bot]`-awareness to user reply detection (step 1), added pending reply detection logic (step 3 — every user/`[from bot]` note must eventually have a bot note after it), added `[from bot]` fix explanation handling (verify current code before auto-resolving). Updated todos to include `[from bot]` reply handling and pending reply detection.
- **Tests**: All validation passed:
  - `freefsm start freefsm/workflows/code-review.fsm.yaml --run-id test-step6` — YAML parses correctly, guide section shows division of labor and `[from bot]` awareness
  - `post-and-resolve` state includes: `[from bot]`-awareness in user reply detection, pending reply detection (every user/`[from bot]` note needs a subsequent bot note), `[from bot]` fix explanation handling with code verification
  - Guide section describes division of labor: code-review posts reviews + resolves threads, mr-lifecycle fixes issues + comments (never resolves)
  - GitHub Actions workflow has both triggers: `pull_request: [opened]` and `issue_comment: [created]` with `/bot-review` check
  - `freefsm finish --run-id test-step6` — clean up succeeded
