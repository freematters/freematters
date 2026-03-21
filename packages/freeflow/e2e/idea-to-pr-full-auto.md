# Test: idea-to-pr full pipeline on testbed

Verify that the idea-to-pr composite workflow runs the complete pipeline:
spec-gen (fast-forward) → decide (full auto) → spec-to-code → pr-lifecycle,
ending with a real PR on freematters/testbed.

## Background

The idea-to-pr workflow composes three child workflows (spec-gen, spec-to-code,
pr-lifecycle) via `workflow:` composition (version 1.2). States from child
workflows are namespaced: spec-gen's states become `spec/create-structure`,
`spec/requirements`, etc.

This test exercises the **full auto** path — after spec-gen completes, the executor
chooses "full auto" at the decide gate, which runs spec-to-code in fast-forward
mode (no intermediate approvals) and then automatically creates and monitors a PR.

The feature is intentionally trivial (a greeting function) to keep implementation
fast while still exercising the full pipeline mechanics.

Key phases:
1. **spec-gen** (fast-forward): Generate spec artifacts for a simple greeting feature
2. **decide**: Choose "full auto" to proceed without human gates
3. **spec-to-code** (fast-forward): Implement the spec — create feature branch, dispatch sub-agents, run tests
4. **pr-lifecycle**: Create a PR on freematters/testbed and monitor until merged or the test ends

The executor should:
- Clone freematters/testbed to a temp directory
- Run the idea-to-pr workflow from that directory
- Choose "requirements clarification" → answer briefly → "fast forward"
- Choose "full auto" at the decide gate
- Let spec-to-code and pr-lifecycle run automatically

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Clone testbed: `git clone https://github.com/freematters/testbed.git /tmp/idea-to-pr-testbed`
- Executor prompt: |
    You are testing the idea-to-pr workflow end-to-end. Your working directory is /tmp/idea-to-pr-testbed.

    Start by running: /fflow packages/freeflow/workflows/idea-to-pr/workflow.yaml

    The idea: "Add a greet module to the project. Create src/greet.py with a function
    greet(name: str) -> str that returns 'Hello, <name>!' and a CLI entry point that
    reads a name from argv and prints the greeting. Add a test in tests/test_greet.py."

    When asked where to start, choose "requirements clarification".
    Answer each requirement question briefly and directly. Keep scope minimal — this is a simple greeting utility, no fancy features needed. No e2e tests needed for this feature.
    When offered transition options after requirements, choose "fast forward" to skip intermediate approvals.
    When asked how to proceed after the spec is complete (full auto / step by step / stop here), choose "full auto".

    Let the workflow run automatically from there — spec-to-code will implement and pr-lifecycle will create a PR.

    IMPORTANT: You are running from the freematters monorepo root

## Steps

1. **Start workflow**: Wait for the executor to initialize the workflow in the cloned testbed repo
   - Expected: Executor starts in `spec/create-structure` state, creates `./specs/<slug>/` directory, and asks where to start

2. **Requirements phase**: Wait for the executor to complete the requirements Q&A cycle
   - Expected: Executor transitions to `spec/requirements`, asks questions one at a time, records answers, then chooses fast forward

3. **Spec generation**: Wait for the executor to generate all spec artifacts in fast-forward mode
   - Expected: Executor writes design.md, plan.md, and summary.md in the specs directory without intermediate approvals

4. **Decide gate — full auto**: Wait for the executor to reach the decide state and choose full auto
   - Expected: Executor transitions from `spec/done` to `decide`, presents the three options, and selects "full auto"

5. **Implementation setup**: Wait for the executor to enter spec-to-code and set up the feature branch
   - Expected: Executor transitions to `implement/setup`, creates a feature branch, reads the plan, and selects fast-forward mode

6. **Implementation**: Wait for the executor to implement the greeting feature
   - Expected: Executor dispatches sub-agents to implement plan steps, creates src/greet.py and tests/test_greet.py, commits to feature branch

7. **PR creation**: Wait for the executor to enter pr-lifecycle and create a pull request
   - Expected: Executor transitions to `submit-pr/create-pr`, creates a PR on freematters/testbed, and begins polling

8. **PR monitoring**: Wait for the executor to enter the polling state
   - Expected: Executor transitions to `submit-pr/poll` and starts monitoring the PR for CI results and reviews

## Expected Outcomes

- Workflow starts in the composed `spec/create-structure` state
- Spec artifacts are generated in `./specs/<slug>/`
- Full auto mode propagates fast-forward to spec-to-code
- Feature branch is created and code is committed
- A real PR is created on freematters/testbed
- The PR contains src/greet.py with the greet function and tests/test_greet.py

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow initialization + clone | 120s |
| Requirements Q&A cycle | 180s |
| Spec generation (fast-forward) | 300s |
| Decide gate | 60s |
| Implementation setup | 120s |
| Implementation (sub-agents) | 600s |
| PR creation | 120s |
| PR monitoring (initial poll) | 120s |

## Cleanup

- Close the test PR if still open: `gh pr close --repo freematters/testbed <branch> --delete-branch` or equivalent
- Remove the cloned repo: `rm -rf /tmp/idea-to-pr-testbed`
- The freeflow run storage is automatically cleaned up
