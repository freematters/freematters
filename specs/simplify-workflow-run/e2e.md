# E2E Test Plan: Simplify FreeFlow Workflow Run

## Background

This test validates the new `fflow render` command and simplified state card output.
`fflow render` resolves YAML workflows (including composition) into standalone markdown.
State cards from `fflow goto` no longer repeat guide/reminders, and revisited states
show lite cards by default.

## Setup

Build freeflow from source and use the local binary:

```
cd packages/freeflow && npm run build
```

Use `node packages/freeflow/dist/cli.js` as the fflow binary for all commands.

Create a test workspace in a temp directory with a simple test workflow:

```yaml
# /tmp/fflow-e2e/workflows/test-wf/workflow.yaml
version: 1
guide: |
  This is a test workflow guide.
  Rule: always greet the user.
initial: step-one
states:
  step-one:
    prompt: "Say hello to the user."
    transitions:
      next: step-two
  step-two:
    prompt: "Say goodbye to the user."
    transitions:
      finish: done
  done:
    prompt: "Workflow complete."
    transitions: {}
```

Also create a workflow with composition for render testing:

```yaml
# /tmp/fflow-e2e/workflows/base-wf/workflow.yaml
version: 1
guide: "Base guide."
initial: base-step
states:
  base-step:
    prompt: "Base step instructions."
    transitions:
      next: done
  done:
    prompt: "Done."
    transitions: {}
```

```yaml
# /tmp/fflow-e2e/workflows/composed-wf/workflow.yaml
version: 1.1
extends_guide: "../base-wf/workflow.yaml"
guide: |
  {{base}}
  Extra composed guide.
initial: inherited
states:
  inherited:
    from: "../base-wf/workflow.yaml#base-step"
    prompt: "Overridden prompt."
    transitions:
      next: done
  done:
    prompt: "Composed done."
    transitions: {}
```

---

## Test 1: fflow render outputs resolved markdown

1. Run `fflow render /tmp/fflow-e2e/workflows/test-wf/workflow.yaml`
2. **Verify:** Exit code is 0
3. **Verify:** Stdout contains markdown with sections for `step-one`, `step-two`, and `done`
4. **Verify:** Stdout contains the guide text "This is a test workflow guide"
5. **Verify:** Each state section includes its prompt and transitions

## Test 2: fflow render resolves composition

1. Run `fflow render /tmp/fflow-e2e/workflows/composed-wf/workflow.yaml`
2. **Verify:** Exit code is 0
3. **Verify:** Guide includes both "Base guide." and "Extra composed guide."
4. **Verify:** The `inherited` state has "Overridden prompt." (not "Base step instructions.")
5. **Verify:** No `from:` or `extends_guide:` directives appear in the output

## Test 3: fflow render --save writes alongside YAML

1. Run `fflow render /tmp/fflow-e2e/workflows/test-wf/workflow.yaml --save`
2. **Verify:** File `/tmp/fflow-e2e/workflows/test-wf/workflow.md` exists
3. **Verify:** File `/tmp/fflow-e2e/workflows/test-wf/workflow.yaml` still exists and is unchanged
4. **Verify:** Content of `.md` matches what stdout would produce

## Test 4: fflow render -o writes to specified path

1. Run `fflow render /tmp/fflow-e2e/workflows/test-wf/workflow.yaml -o /tmp/fflow-e2e/output.md`
2. **Verify:** File `/tmp/fflow-e2e/output.md` exists
3. **Verify:** Content matches expected rendered markdown

## Test 5: fflow render errors on markdown input

1. Create a file `/tmp/fflow-e2e/test.workflow.md` with any content
2. Run `fflow render /tmp/fflow-e2e/test.workflow.md`
3. **Verify:** Exit code is 2
4. **Verify:** Error message indicates only YAML input is accepted

## Test 6: fflow render errors on conflicting flags

1. Run `fflow render /tmp/fflow-e2e/workflows/test-wf/workflow.yaml --save -o /tmp/out.md`
2. **Verify:** Exit code is 2
3. **Verify:** Error message indicates cannot use both `--save` and `-o`

## Test 7: Simplified state cards — start includes guide and reminders

1. Run `fflow start /tmp/fflow-e2e/workflows/test-wf/workflow.yaml --run-id e2e-card-test`
2. **Verify:** Output contains "This is a test workflow guide"
3. **Verify:** Output contains "Execute this state's instructions NOW"
4. **Verify:** Output contains "MUST NOT truncate"
5. **Verify:** Output contains the step-one prompt

## Test 8: Simplified state cards — goto first visit has no guide/reminders

1. Using run `e2e-card-test`, run `fflow goto step-two --run-id e2e-card-test --on next`
2. **Verify:** Output contains the step-two prompt "Say goodbye to the user."
3. **Verify:** Output does NOT contain "This is a test workflow guide"
4. **Verify:** Output does NOT contain "Execute this state's instructions NOW"
5. **Verify:** Output does NOT contain "MUST NOT truncate"

## Test 9: Simplified state cards — goto revisit shows lite card

1. Create a workflow where a state can be revisited (loop transition)
2. Start a run, visit the state, leave, then revisit via `fflow goto`
3. **Verify:** Revisit output says "Re-entering" and mentions `fflow current`
4. **Verify:** Revisit output does NOT contain the full prompt
5. **Verify:** `fflow current` still returns the full state card with guide

## Test 10: visited_states always tracked

1. Start a run WITHOUT `--lite` flag
2. Transition through two states
3. Read `snapshot.json` from the run directory
4. **Verify:** `visited_states` array exists and contains both visited state names
