# Test: github-spec-gen fast-forward mode

Verify that the github-spec-gen workflow creates a GitHub issue, gathers requirements
via issue comments, and completes the full spec pipeline in fast-forward mode
(design → plan → e2e-gen → done) without intermediate user approvals.

## Background

The github-spec-gen workflow drives a spec-generation process entirely through GitHub
issue comments. It creates an issue on a target repo, asks requirements questions via
comments, and posts spec artifacts (requirements.md, design.md, plan.md) as issue comments.

In fast-forward mode, after requirements are gathered, the workflow skips the checkpoint
and proceeds directly through design → plan → e2e-gen → done without polling for user
approval at each step.

The executor will be launched with the `/fflow github-spec-gen` skill. It interacts with
the user (verifier) through GitHub issue comments. The verifier simulates being the issue
creator by posting replies on the issue.

Key states and transitions:
- **create-issue**: Creates a GitHub issue, posts welcome message, polls for user choice
- **requirements**: Asks Q&A questions via comments, compiles requirements.md artifact
- **design** (fast-forward): Writes design.md without waiting for approval
- **plan** (fast-forward): Writes plan.md without waiting for approval
- **e2e-gen**: Checks for E2E section in design, generates e2e.md if present
- **done**: Adds spec-ready label, posts summary

The executor polls for replies using `poll_issue.py`. The verifier must post replies
on the GitHub issue (not via `send()`) since the executor reads from GitHub, not stdin.

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Verify GitHub CLI is authenticated: `gh auth status`
- Executor prompt: |
    You are running the github-spec-gen workflow to generate a spec on freematters/testbed.

    The idea: "Build a simple key-value store CLI tool that supports get, set, and delete
    operations, storing data in a local JSON file."

    Start the workflow by running:
    /fflow packages/freeflow/workflows/github-spec-gen/workflow.yaml

    When asked for a repo, use: freematters/testbed
    When asked for the idea, use the key-value store description above.

    Follow the workflow states. When you reach a state that requires polling for user
    comments, use the poll_issue.py script as described in the workflow guide.

    IMPORTANT: You are running from the repo root at /home/ubuntu/Code/freematters/.claude/worktrees/pr-62-review

## Steps

1. **Issue creation**: Wait for the executor to create the GitHub issue and post the welcome comment
   - Expected: Executor creates an issue on freematters/testbed with a title related to "key-value store", posts a welcome comment offering requirements or research, and starts polling for a reply

2. **Choose requirements**: When the executor is polling for the user's choice, post a reply on the issue choosing requirements (option 1). Use `gh issue comment <number> --repo freematters/testbed --body "1"` to reply.
   - Expected: Executor receives the reply and transitions to the requirements state, begins asking clarification questions

3. **Answer first question**: Wait for the executor to post a requirements question. Then reply on the issue with a reasonable answer. Keep it simple — e.g., "Yes, that sounds good" or a brief answer to whatever was asked.
   - Expected: Executor records the Q&A and asks another question or offers to proceed

4. **Choose fast forward**: When the executor offers transition options (including fast forward), reply on the issue with "fast forward" or the number corresponding to fast forward.
   - Expected: Executor compiles requirements.md artifact comment, updates the status checklist, and transitions directly to design without waiting for checkpoint approval

5. **Verify design artifact**: Wait for the executor to post the design.md artifact comment on the issue. Do NOT reply — in fast-forward mode, no approval is needed.
   - Expected: Executor posts a `## design.md` comment with architecture overview and transitions to plan without polling

6. **Verify plan artifact**: Wait for the executor to post the plan.md artifact comment on the issue.
   - Expected: Executor posts a `## plan.md` comment with implementation steps and transitions to e2e-gen without polling

7. **Verify completion**: Wait for the executor to reach the done state and finalize the issue.
   - Expected: Executor adds the `spec-ready` label, checks off status items, and posts a summary comment. The workflow completes.

## Expected Outcomes

- A GitHub issue is created on freematters/testbed with proper structure (title, status checklist)
- Requirements Q&A happens through issue comments with `[bot reply]` prefix
- Fast-forward mode skips checkpoint and intermediate approvals
- All spec artifacts (requirements.md, design.md, plan.md) are posted as issue comments
- The issue receives the `spec-ready` label upon completion
- Status checklist items are checked off in the issue body

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Issue creation + welcome comment | 120s |
| Each poll cycle (waiting for user reply) | 120s |
| Requirements Q&A per question | 120s |
| Design generation (fast-forward) | 180s |
| Plan generation (fast-forward) | 180s |
| E2E-gen + done finalization | 120s |

Note: The executor makes multiple GitHub API calls and Claude API calls per state.
Allow generous timeouts, especially for design and plan generation which involve
substantial content creation.

## Cleanup

- Close the test issue on freematters/testbed: `gh issue close <number> --repo freematters/testbed --comment "[test cleanup] Closing test issue"`
- Remove the `spec-ready` label if it was created: this is fine to leave as it may be reused
- The freeflow run storage is automatically cleaned up
