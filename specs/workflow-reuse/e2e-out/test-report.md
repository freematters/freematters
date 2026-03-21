# E2E Test Report: Workflow state-level reuse (from + extends_guide)

## Overall Verdict: PASS

All 10 test steps passed. The workflow state-level reuse feature (`from:` references and `extends_guide`) works correctly.

**Note:** The globally installed `fflow` binary (from main repo) does NOT have the `from:` resolution feature yet. Tests were executed using the worktree build at `/home/ubuntu/Code/freematters/.claude/worktrees/reuse/packages/freeflow/dist/cli.js`. The initial attempt with the global `fflow` failed with `SCHEMA_INVALID` because the global version lacks `resolveRefs()`.

## Per-Step Verdicts

### Step 1: Start child workflow
**Verdict: PASS**
- Command: `fflow start /tmp/test-reuse-workflows/child-qa.workflow.yaml --run-id test-reuse -j`
- Expected: Run initializes successfully in "ask" state with exit code 0
- Actual: `{"ok": true, "state": "ask"}` — run started successfully
- Evidence: JSON output shows `"state": "ask"`, `"ok": true`

### Step 2: Verify guide contains base + child content
**Verdict: PASS**
- Expected: Guide contains BOTH "Base guide rule: always be concise" AND "Child guide rule: all output must be in English"
- Actual: `loadFsm()` returns guide: `"Base guide rule: always be concise.\n\nChild guide rule: all output must be in English.\n"`
- Evidence: The `extends_guide` + `{{base}}` mechanism correctly merges both guides
- Note: `fflow current -j` does not expose the `guide` field; verified via direct `loadFsm()` call

### Step 3: Verify ask prompt has base + appended content
**Verdict: PASS**
- Expected: Prompt contains "Ask the user a question" (from base) AND "Additional: ask the question via issue comment" (from child)
- Actual: Prompt is `"Ask the user a question.\n\nAdditional: ask the question via issue comment.\n"`
- Evidence: `fflow start` JSON output `data.prompt` field

### Step 4: Verify ask todos are base + appended
**Verdict: PASS**
- Expected: 3 todos in order: "Formulate a clear question", "Wait for user response", "Post question as GitHub comment"
- Actual: `["Formulate a clear question", "Wait for user response", "Post question as GitHub comment"]`
- Evidence: `fflow start` JSON output `data.todos` array — 3 items, correct order (base first, child appended)

### Step 5: Verify ask transitions are merged
**Verdict: PASS**
- Expected: Transitions contain BOTH "answered → answer" (from base) AND "skipped → done" (from child)
- Actual: `{"answered": "answer", "skipped": "done"}`
- Evidence: `fflow start` JSON output `data.transitions` — both transitions present

### Step 6: Transition via base transition
**Verdict: PASS**
- Command: `fflow goto answer --run-id test-reuse --on "answered" -j`
- Expected: State transitions to "answer" with exit code 0
- Actual: `{"ok": true, "state": "answer", "from_state": "ask"}`
- Evidence: Transition succeeded, state moved from ask → answer

### Step 7: Verify answer state is pure inheritance
**Verdict: PASS**
- Expected: Prompt is exactly "Process the user's answer and summarize."
- Actual: Prompt is `"Process the user's answer and summarize.\n"`
- Evidence: `fflow goto` JSON output `data.prompt` — matches base prompt (trailing newline from YAML block scalar)

### Step 8: Verify answer transitions inherited
**Verdict: PASS**
- Expected: Transitions contain "done → done" (inherited from base)
- Actual: `{"done": "done"}`
- Evidence: `fflow goto` JSON output `data.transitions` — inherited transition present

### Step 9: Transition to done
**Verdict: PASS**
- Command: `fflow goto done --run-id test-reuse --on "done" -j`
- Expected: State transitions to "done" with exit code 0
- Actual: `{"ok": true, "state": "done", "run_status": "completed"}`
- Evidence: Transition succeeded, run auto-completed

### Step 10: Verify done is locally defined
**Verdict: PASS**
- Expected: Prompt is "Child done: finalize and close issue."
- Actual: Prompt is `"Child done: finalize and close issue.\n"`
- Evidence: `fflow goto` JSON output `data.prompt` — uses child's local definition, NOT base's "Workflow complete."

## Summary

| Step | Description | Verdict |
|------|-------------|---------|
| 1 | Start child workflow | PASS |
| 2 | Guide has base + child content | PASS |
| 3 | Ask prompt has base + appended | PASS |
| 4 | Ask todos are base + appended (3 total) | PASS |
| 5 | Ask transitions are merged (2 total) | PASS |
| 6 | Transition via base transition | PASS |
| 7 | Answer state is pure inheritance | PASS |
| 8 | Answer transitions inherited | PASS |
| 9 | Transition to done | PASS |
| 10 | Done is locally defined | PASS |

**Result: 10/10 steps passed**

## Unexpected Observations

1. **Global `fflow` binary lacks `from:` resolution**: The globally installed `fflow` (at `/home/ubuntu/.nvm/versions/node/v22.16.0/bin/fflow`, linked to `/home/ubuntu/Code/freematters/packages/freeflow/dist/cli.js`) does not have the `resolveRefs()` function. Running `fflow start` with the child workflow via the global binary fails with `SCHEMA_INVALID: state "answer": "prompt" must be a non-empty string`. The worktree build at `.claude/worktrees/reuse/packages/freeflow/dist/` has the fix. This means the main branch has not been updated with the reuse feature yet.

2. **`fflow current -j` does not expose the `guide` field**: The guide was verified via direct `loadFsm()` call instead of the CLI `current` command.

## Debug Artifacts

- **Verifier run directory**: `/home/ubuntu/.freeflow/runs/verifier-1774079562710/`
  - `events.jsonl` — FSM event history
  - `snapshot.json` — final FSM state
  - `fsm.meta.json` — run metadata
- **Test run directory**: `/home/ubuntu/.freeflow/runs/test-reuse/`
  - `events.jsonl` — FSM event history for the test workflow run
  - `snapshot.json` — final FSM state
- **Test plan**: `/home/ubuntu/Code/freematters/.claude/worktrees/reuse/specs/workflow-reuse/e2e.md`
