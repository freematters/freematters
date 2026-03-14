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
