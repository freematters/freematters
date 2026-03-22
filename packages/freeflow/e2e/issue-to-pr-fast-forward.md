# Test: issue-to-pr fast-forward with user confirmation gates

Verify that the issue-to-pr composite workflow runs the full pipeline in
fast-forward mode: github-spec-gen (fast-forward) → decide (fast forward) →
confirm-implement (poll → approved) → spec-to-code → confirm-pr (poll → submit) →
pr-lifecycle, using a real GitHub issue on freematters/testbed.

## Background

The issue-to-pr workflow composes three child workflows (github-spec-gen, spec-to-code,
pr-lifecycle) via `workflow:` composition (version 1.2). States from child workflows
are namespaced: github-spec-gen's states become `spec/create-issue`, `spec/requirements`, etc.

This test exercises the **fast forward** path — after github-spec-gen completes, the
executor chooses "fast forward" at the decide gate. This means the agent polls the
GitHub issue for user confirmation before implementation and before PR submission.

The feature is intentionally trivial (a hello function) to keep implementation fast
while still exercising the full pipeline with issue-based interaction.

Key phases:
1. **start**: Detect input mode — new idea with repo name
2. **github-spec-gen** (fast-forward): Create issue, Q&A via issue comments, generate spec
3. **decide**: Choose "fast forward" for semi-auto mode with gates
4. **confirm-implement**: Agent posts confirmation request on issue, waits for "go"
5. **spec-to-code**: Implement the spec in issue mode
6. **confirm-pr**: Agent posts implementation summary, waits for "submit"
7. **pr-lifecycle**: Create and monitor PR linked to the issue

The executor should:
- Clone freematters/testbed to a temp directory
- Run the issue-to-pr workflow with a new idea
- Navigate through github-spec-gen (fast-forward)
- Choose "fast forward" at decide gate
- At confirm-implement, the verifier will post "go" on the issue
- At confirm-pr, the verifier will post "submit" on the issue

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Clone testbed: `git clone https://github.com/freematters/testbed.git /tmp/issue-to-pr-testbed`
- Executor prompt: |
    You are testing the issue-to-pr workflow end-to-end. Your working directory is /tmp/issue-to-pr-testbed.

    Start by running: /fflow packages/freeflow/workflows/issue-to-pr/workflow.yaml

    The idea: "Add a hello module to freematters/testbed. Create src/hello.py with a
    function hello(name: str) -> str that returns 'Hello, <name>!' and add
    tests/test_hello.py with basic tests."

    The repo is freematters/testbed.

    When prompted for where to start in spec-gen, choose "requirements clarification".
    Answer each question briefly — this is a trivial hello utility. No e2e tests needed.
    When offered transition options after requirements, choose "fast forward".
    When asked about execution mode (full auto / fast forward / stop here), choose "fast forward" (option 2).

    At the confirm-implement gate, wait for the user to reply "go" on the issue.
    At the confirm-pr gate, wait for the user to reply "submit" on the issue.

    IMPORTANT: You are running from the freematters monorepo root. Use the local fflow binary.

## Steps

1. **Start workflow**: Wait for the executor to initialize and detect input mode
   - Expected: Executor enters `start` state, detects new idea mode, transitions to `spec/create-issue`

2. **Issue creation**: Wait for the executor to create a GitHub issue on freematters/testbed
   - Expected: Executor creates issue with title, status checklist, and welcome comment

3. **Requirements phase**: Wait for the executor to complete Q&A on the issue
   - Expected: Executor posts questions as issue comments, records answers, chooses fast-forward

4. **Spec generation**: Wait for all spec artifacts to be generated
   - Expected: Design, plan posted as issue comments, status checklist updated

5. **Decide gate**: Wait for the executor to reach decide and choose fast-forward
   - Expected: Executor posts mode selection on issue, chooses "fast forward"

6. **Confirm-implement gate**: Wait for the executor to post confirmation request
   - Expected: Executor posts "Ready to Implement" comment, starts polling
   - Action: Post "go" as a comment on the issue to approve implementation
   - Expected: Executor detects approval and transitions to implement

7. **Implementation**: Wait for the executor to implement the hello feature
   - Expected: Executor runs spec-to-code in issue mode, creates feature branch, implements, pushes

8. **Confirm-pr gate**: Wait for the executor to post implementation summary
   - Expected: Executor posts implementation summary on issue, starts polling
   - Action: Post "submit" as a comment on the issue to approve PR
   - Expected: Executor detects approval and transitions to submit-pr

9. **PR creation**: Wait for the executor to create a pull request
   - Expected: PR is created on freematters/testbed, linked to the source issue

## Expected Outcomes

- A GitHub issue is created on freematters/testbed
- Spec artifacts are posted as issue comments
- The agent pauses at confirm-implement and waits for "go" on the issue
- The agent pauses at confirm-pr and waits for "submit" on the issue
- A feature branch with src/hello.py and tests/test_hello.py is created
- A PR is created and linked to the issue
- Issue status checklist is updated throughout

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow init + issue creation | 120s |
| Requirements Q&A cycle | 180s |
| Spec generation (fast-forward) | 300s |
| Decide gate | 60s |
| Confirm-implement polling | 120s |
| Implementation (sub-agents) | 600s |
| Confirm-pr polling | 120s |
| PR creation | 120s |

## Cleanup

- Close the test PR if still open: `gh pr close --repo freematters/testbed <branch> --delete-branch`
- Close the test issue: `gh issue close --repo freematters/testbed <number>`
- Remove the cloned repo: `rm -rf /tmp/issue-to-pr-testbed`
