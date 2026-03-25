# E2E Test Report: Simplify FreeFlow Workflow Run

**Overall Verdict: FAIL**

Passed: 8/10 | Failed: 2/10

---

## Test 1: fflow render outputs resolved markdown — PASS

- Exit code: 0 ✅
- Stdout contains sections for `step-one`, `step-two`, and `done` ✅
- Stdout contains guide text "This is a test workflow guide" ✅
- Each state section includes its prompt and transitions ✅

## Test 2: fflow render resolves composition — PASS

- Exit code: 0 ✅
- Guide includes both "Base guide." and "Extra composed guide." ✅
- `inherited` state has "Overridden prompt." (not "Base step instructions.") ✅
- No `from:` or `extends_guide:` directives in output ✅

## Test 3: fflow render --save writes alongside YAML — FAIL

- Exit code: 0 ✅
- File created, but as `workflow.workflow.md` not `workflow.md` ❌
  - This is intentional behavior per the implementation (`render.ts` line 37: `${withoutExt}.workflow.md`), and unit tests confirm it. The test plan expectation is incorrect.
- Original `workflow.yaml` unchanged ✅
- Content of `.workflow.md` matches stdout output ✅

**Evidence:** `ls /tmp/fflow-e2e/workflows/test-wf/` shows `workflow.workflow.md` exists; `workflow.md` does not. Implementation at `src/commands/render.ts:37` and unit test `render.test.ts:88` both confirm the `.workflow.md` suffix is by design.

**Verdict: Test plan expectation is wrong, not the implementation.** The `--save` feature works correctly; it just uses the `.workflow.md` extension convention.

## Test 4: fflow render -o writes to specified path — PASS

- Exit code: 0 ✅
- File `/tmp/fflow-e2e/output.md` exists ✅
- Content matches expected rendered markdown ✅

## Test 5: fflow render errors on markdown input — PASS

- Exit code: 2 ✅
- Error message: "fflow render only accepts YAML input. Pass a .yaml or .yml workflow file." ✅

## Test 6: fflow render errors on conflicting flags — PASS

- Exit code: 2 ✅
- Error message: "Cannot use both -o and --save" ✅

## Test 7: Simplified state cards — start includes guide and reminders — PASS

- Output contains "This is a test workflow guide" ✅
- Output contains "Execute this state's instructions NOW" ✅
- Output contains "MUST NOT truncate" ✅
- Output contains step-one prompt "Say hello to the user." ✅

## Test 8: Simplified state cards — goto first visit has no guide/reminders — FAIL

- Output contains step-two prompt "Say goodbye to the user." ✅
- Output does NOT contain "This is a test workflow guide" ✅
- Output does NOT contain "Execute this state's instructions NOW" ❌ — **still present**
  - Actual output includes: `IMPORTANT: Execute this state's instructions NOW. Do NOT stop or wait for user input between states.`
- Output does NOT contain "MUST NOT truncate" ✅

**Evidence:** Full goto output:
```
You are in **step-two** state.

Your instructions:
Say goodbye to the user.
After finish, the allowed state transitions are:
  finish → done

IMPORTANT: Execute this state's instructions NOW. Do NOT stop or wait for user input between states. Only terminal states (no transitions) end the workflow.
```

The "Execute this state's instructions NOW" reminder is still emitted on first-visit goto. The guide and "MUST NOT truncate" reminders were correctly omitted. Only the execution reminder was not removed.

## Test 9: Simplified state cards — goto revisit shows lite card — PASS

- Revisit output says "Re-entering" ✅: `Re-entering **step-a** state. Instructions unchanged from previous visit.`
- Revisit mentions `fflow current` ✅: `Run fflow current to review full instructions if you forget.`
- Revisit does NOT contain the full prompt ✅
- `fflow current` returns full state card with guide ✅ (includes full instructions and all reminders)

## Test 10: visited_states always tracked — PASS

- Started run without `--lite` flag ✅
- Transitioned through two states ✅
- `snapshot.json` contains `visited_states` array with `["step-one", "step-two"]` ✅

---

## Unexpected Observations

1. **Test 3 filename convention:** `--save` uses `.workflow.md` extension, not plain `.md`. This is consistent with the codebase convention where markdown workflows use the `.workflow.md` suffix. The test plan expectation should be updated.

2. **Test 8 partial omission:** The goto command on first visit correctly omits the guide and the "MUST NOT truncate" reminder, but retains the "Execute this state's instructions NOW" reminder. This may be intentional (the execution reminder serves a different purpose than the guide) or a partial implementation gap.

---

## Debug Artifacts

- Verifier session log: (this session — run inline)
- Test plan: `/home/ubuntu/Code/freematters/.claude/worktrees/discord/specs/simplify-workflow-run/e2e.md`
- Test output: `/home/ubuntu/Code/freematters/.claude/worktrees/discord/specs/simplify-workflow-run/e2e-out/test-report.md`
