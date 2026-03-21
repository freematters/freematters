# Test: spec-gen fast-forward mode

Verify that the local spec-gen workflow runs end-to-end in fast-forward mode,
producing all spec artifacts without intermediate user approvals.

## Background

The spec-gen workflow generates specifications through interactive requirements gathering,
research, design, and planning. In fast-forward mode, after requirements are gathered,
the workflow skips intermediate approvals and proceeds directly through
design → plan → e2e-gen → done.

The executor runs the workflow via `/fflow` and interacts as the user. The verifier
provides input when the executor requests it (via `request_input`).

Key states:
- **create-structure**: Creates spec directory, asks user for idea and starting point
- **requirements**: Q&A cycle, one question at a time
- **design** (fast-forward): Writes design.md without waiting for approval
- **plan** (fast-forward): Writes plan.md without waiting for approval
- **e2e-gen**: Checks for E2E section, generates e2e.md if present
- **done**: Writes summary.md, presents to user

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Create a temporary workspace: `mkdir -p /tmp/spec-gen-test`
- Executor prompt: |
    You are testing the spec-gen workflow. Your working directory is /tmp/spec-gen-test.

    Start by running: /fflow packages/freeflow/workflows/spec-gen/workflow.yaml

    The idea: "Build a hello-world CLI that prints a greeting with the user's name."

    When asked where to start, choose "requirements clarification".
    Answer each requirement question briefly and directly.
    When offered transition options, choose "fast forward" to skip intermediate approvals.

    IMPORTANT: You are running from /home/ubuntu/Code/freematters/.claude/worktrees/pr-62-review

## Steps

1. **Start workflow**: Wait for the executor to initialize the workflow and create the spec directory
   - Expected: Executor creates `./specs/<slug>/` directory structure and asks where to start

2. **Choose requirements**: Wait for the executor to ask where to start, then confirm it chooses requirements
   - Expected: Executor transitions to requirements state and asks the first clarification question

3. **Answer questions**: Wait for the executor to complete the Q&A cycle (1-3 questions)
   - Expected: Executor asks questions one at a time and records answers in requirements.md

4. **Choose fast forward**: Wait for the executor to offer transition options including fast forward
   - Expected: Executor chooses fast forward and begins generating design without intermediate approvals

5. **Verify design**: Wait for the executor to generate design.md
   - Expected: Executor writes a design.md file in the specs directory with architecture overview

6. **Verify plan**: Wait for the executor to generate plan.md
   - Expected: Executor writes plan.md with numbered implementation steps

7. **Verify completion**: Wait for the executor to reach the done state
   - Expected: Executor writes summary.md and completes the workflow

## Expected Outcomes

- Spec directory created at `./specs/<slug>/` with rough-idea.md, requirements.md, design.md, plan.md, summary.md
- Requirements Q&A follows one-question-at-a-time cycle
- Fast-forward mode skips intermediate approvals (no user confirmation between design → plan → done)
- All spec artifacts are written incrementally (not batched)

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow initialization | 120s |
| Each requirement question | 120s |
| Design generation (fast-forward) | 180s |
| Plan generation (fast-forward) | 180s |
| E2E-gen + summary + completion | 120s |

## Cleanup

- Remove the test spec directory: `rm -rf /tmp/spec-gen-test/specs`
- The freeflow run storage is automatically cleaned up
