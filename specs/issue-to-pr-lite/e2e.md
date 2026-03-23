# Test: issue-to-pr-lite full pipeline with simplified artifacts

Verify that the issue-to-pr-lite workflow runs the full pipeline: generates simplified
spec artifacts (4-section design.md, 2-step plan.md), implements via spec-to-code,
and submits a PR via pr-lifecycle — all on freematters/testbed.

## Background

The issue-to-pr-lite workflow composes github-spec-gen-lite with the existing spec-to-code
and pr-lifecycle sub-workflows. The key difference from issue-to-pr is that the spec-gen
phase produces simplified artifacts:

- **design.md**: 4 sections — Overview, Goal & Constraints, Architecture & Components
  (merged section), E2E Testing. No Error Handling section.
- **plan.md**: Exactly 2 steps — Step 1 "Implement the feature" (with bullet sub-items)
  and Step 2 "E2E test".

This test exercises the **full auto** path: spec-gen (fast-forward) → decide (full auto) →
spec-to-code → pr-lifecycle. The feature is intentionally trivial (a hello function) to
keep implementation fast while exercising the full pipeline.

Key phases:
1. **start**: Detect input mode — new idea with repo name
2. **github-spec-gen-lite** (fast-forward): Create issue, brief Q&A, generate simplified spec
3. **decide**: Choose "full auto" for fully automated mode
4. **spec-to-code**: Implement the 2-step plan
5. **pr-lifecycle**: Create and submit PR

The executor should:
- Clone freematters/testbed to a temp directory
- Run the issue-to-pr-lite workflow with a trivial idea
- Navigate through spec-gen (fast-forward)
- Choose "full auto" at decide gate
- Let spec-to-code and pr-lifecycle run automatically

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Clone testbed: `git clone https://github.com/freematters/testbed.git /tmp/issue-to-pr-lite-testbed`
- Executor prompt: |
    You are testing the issue-to-pr-lite workflow end-to-end. Your working directory is /tmp/issue-to-pr-lite-testbed.

    Start by running: /fflow packages/freeflow/workflows/issue-to-pr-lite/workflow.yaml

    The idea: "Add a hello module to freematters/testbed. Create src/hello.py with a
    function hello(name: str) -> str that returns 'Hello, <name>!' and add
    tests/test_hello.py with basic tests using pytest."

    The repo is freematters/testbed.

    When prompted for where to start in spec-gen, choose "requirements clarification".
    Answer each question briefly — this is a trivial hello utility. No e2e tests needed for this feature.
    When offered transition options after requirements, choose "fast forward".
    When asked about execution mode (full auto / fast forward / stop here), choose "full auto" (option 1).

    IMPORTANT: You are running from the freematters monorepo root. Use the local fflow binary.

## Steps

1. **Start workflow**: Wait for the executor to initialize and detect input mode
   - Expected: Executor enters `start` state, detects new idea mode, transitions to `spec/create-issue`

2. **Issue creation**: Wait for the executor to create a GitHub issue on freematters/testbed
   - Expected: Executor creates issue with title, status checklist, and welcome comment

3. **Requirements phase**: Wait for the executor to complete Q&A on the issue
   - Expected: Executor posts questions as issue comments, records answers, chooses fast-forward

4. **Simplified spec generation**: Wait for design.md and plan.md artifacts to be generated
   - Expected: Design and plan are posted as issue comments, status checklist updated

5. **Verify design.md structure**: Read the design.md artifact from the local cache at `$HOME/.freeflow/runs/*/artifacts/design.md` (find the run directory first)
   - Expected: design.md contains sections for "Overview", "Goal & Constraints", "Architecture & Components", and optionally "E2E Testing". It does NOT contain an "Error Handling" section. It does NOT have separate "Components & Interfaces" or "Data Models" sections — these are merged into "Architecture & Components".

6. **Verify plan.md structure**: Read the plan.md artifact from the local cache
   - Expected: plan.md contains exactly 2 steps in the checklist. Step 1 title contains "Implement" and has bullet sub-items. Step 2 title contains "E2E" or "test". There are no additional steps.

7. **Decide gate**: Wait for the executor to reach decide and choose "full auto"
   - Expected: Executor chooses "full auto" (option 1), transitions directly to implementation

8. **Implementation**: Wait for the executor to implement the hello feature via spec-to-code
   - Expected: Executor creates a feature branch, implements src/hello.py and tests/test_hello.py, commits and pushes. Tests pass.

9. **PR creation**: Wait for the executor to create a pull request via pr-lifecycle
   - Expected: A PR is created on freematters/testbed linked to the source issue. PR title and body reference the implementation.

## Expected Outcomes

- A GitHub issue is created on freematters/testbed with status checklist
- Spec artifacts (requirements.md, design.md, plan.md) are posted as issue comments
- design.md has simplified sections (no Error Handling, merged Architecture & Components)
- plan.md has exactly 2 steps (implement + e2e/test)
- Implementation creates src/hello.py and tests/test_hello.py on a feature branch
- All tests pass
- A PR is created on freematters/testbed
- Issue status checklist is updated throughout

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow init + issue creation | 120s |
| Requirements Q&A cycle | 180s |
| Spec generation (fast-forward) | 300s |
| Artifact verification | 30s |
| Decide gate | 60s |
| Implementation (spec-to-code) | 600s |
| PR creation (pr-lifecycle) | 120s |

## Cleanup

- Close the test PR if still open: `gh pr close --repo freematters/testbed <branch> --delete-branch`
- Close the test issue: `gh issue close --repo freematters/testbed <number>`
- Remove the cloned repo: `rm -rf /tmp/issue-to-pr-lite-testbed`
