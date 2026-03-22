# Test: github-spec-gen design revision (in-place edit)

Verify the github-spec-gen workflow handles design revisions via local file edit +
in-place GitHub comment update (no minimize-and-repost).

## Background

The github-spec-gen workflow creates a GitHub issue and drives spec generation through
issue comments. Artifacts are cached locally at `$HOME/.freeflow/runs/{run_id}/artifacts/`
and their GitHub comment IDs tracked in `artifact_comment_ids.json`.

This test exercises: create-issue → requirements (1 question) → design → user requests
a design change → design revision (in-place edit) → approve → plan → e2e-gen → done.

The key verification: when the design is revised, the executor edits the local file
with the Edit tool and patches the existing GitHub comment via `gh api PATCH`. The
comment ID must stay the same and no minimized/duplicate comments should exist.

The executor polls for replies using `poll_issue.py`. The verifier posts replies on
the GitHub issue since the executor reads from GitHub, not stdin.

## Setup

- Ensure fflow CLI is built: `npm run build` in `packages/freeflow/`
- Verify GitHub CLI is authenticated: `gh auth status`
- Executor prompt: |
    You are running the github-spec-gen workflow to generate a spec on freematters/testbed.

    The idea: "A CLI tool that converts CSV files to JSON."

    Start the workflow by running:
    /fflow packages/freeflow/workflows/github-spec-gen/workflow.yaml

    When asked for a repo, use: freematters/testbed
    When asked for the idea, use the CSV-to-JSON converter description above.

    Follow the workflow states. When you reach a state that requires polling for user
    comments, use the poll_issue.py script as described in the workflow guide.

    IMPORTANT: You are running from the repo root at /home/ubuntu/Code/freematters/.claude/worktrees/optimize-github-spec-gen

## Steps

1. **Issue creation**: Wait for the executor to create the issue and post the welcome comment
   - Expected: Executor creates an issue on freematters/testbed, posts welcome comment, starts polling

2. **Choose requirements**: Post "1" on the issue to choose requirements
   - Expected: Executor transitions to requirements and asks a clarification question

3. **Answer and fast-forward to design**: Answer the question briefly ("Keep it simple, just basic CSV parsing, no streaming needed"). When the executor asks the next question or offers options, reply "That covers it, let's go straight to design" to signal requirements are done. If the executor posts transition options, choose the option that proceeds to design (not fast-forward — we need approval step).
   - Expected: Executor compiles requirements.md and transitions toward design

4. **Wait for design**: Wait for the executor to post the design.md artifact
   - Expected: Executor posts `## design.md` comment and asks for approval. Note the comment URL or ID.

5. **Request design change**: Reply on the issue: "Add a --pretty flag for pretty-printed JSON output. Update the CLI interface section."
   - Expected: Executor edits the local `artifacts/design.md` file (using Edit tool, not full rewrite) and patches the SAME GitHub comment in-place via `gh api PATCH`

6. **Approve design**: After the executor confirms the revision, reply "approved"
   - Expected: Executor checks off design in status checklist, transitions to plan

7. **Verify in-place edit**: Check that only one `## design.md` comment exists on the issue (not two). The design comment should contain "--pretty" in its content.
   - Expected: Exactly one design comment, content includes the --pretty flag addition

8. **Complete workflow**: Let the executor continue through plan → e2e-gen → done. Approve the plan when asked.
   - Expected: Workflow completes, issue gets spec-ready label

## Expected Outcomes

- Design artifact revised via Edit tool + gh api PATCH (in-place, same comment ID)
- Only one `## design.md` comment on the issue (no minimize-and-repost)
- Revised design contains the requested --pretty flag change
- Full workflow completes with spec-ready label

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Issue creation | 120s |
| Each poll cycle | 120s |
| Design generation | 180s |
| Design revision | 120s |
| Plan + e2e-gen + done | 300s |

## Cleanup

- Close the test issue: `gh issue close <number> --repo freematters/testbed --comment "[test cleanup]"`
- Clean up run directory: `rm -rf $HOME/.freeflow/runs/<run_id>`
