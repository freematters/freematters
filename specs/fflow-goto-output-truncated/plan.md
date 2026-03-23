# Implementation Plan: Fix fflow output truncation

## Checklist
- [x] Step 1: Implement the feature
- [x] Step 2: E2E test

---

## Step 1: Implement the feature

**Depends on**: none

**Objective**: Add output truncation warning to the `/fflow` skill file.

**Sub-items**:
- Add a prominent warning in section 5 ("Flow CLI output") of `packages/freeflow/skills/fflow/SKILL.md` instructing the agent to never truncate output from `fflow start`, `fflow goto`, or `fflow current` commands
- The warning should appear before existing content in section 5 so it is seen first
- The warning must explain that state cards contain critical workflow instructions (guide rules, state instructions, transitions) that will be missed if output is tailed or headed

**Related Files**: `packages/freeflow/skills/fflow/SKILL.md`

**Test Requirements**: Manual verification — run a workflow with long state cards and confirm the agent reads full output

---

## Step 2: E2E test

**Depends on**: Step 1

**Objective**: Not required per requirements. Manual verification only.
