# Test: github-spec-gen design revision (in-place edit)

Verify that when the user requests changes to a design artifact, the executor
edits the local file cache and updates the GitHub comment in-place (no
minimize-and-repost), then continues the workflow.

## Background

The github-spec-gen workflow caches artifacts locally at
`$HOME/.freeflow/runs/{run_id}/artifacts/` and tracks GitHub comment IDs in
`artifact_comment_ids.json`. When an artifact needs revision:

1. The executor edits the local file with the Edit tool (diff only).
2. It patches the existing GitHub comment via
   `gh api repos/.../issues/comments/{id} -X PATCH -F body=@file`.

This test exercises the non-fast-forward path: requirements -> checkpoint ->
design -> (user requests changes) -> design revision -> plan -> done.

The executor polls for replies using `poll_issue.py`. The verifier posts
replies on the GitHub issue since the executor reads from GitHub, not stdin.

Key verification points:
- The GitHub comment ID stays the same after revision (in-place edit, not new comment).
- The local file content matches the updated GitHub comment.
- No minimized comments exist on the issue.

## Setup

- Ensure fflow CLI is built: `npm run build` in `packages/freeflow/`
- Verify GitHub CLI is authenticated: `gh auth status`
- Executor prompt: |
    You are running the github-spec-gen workflow to generate a spec on freematters/testbed.

    The idea: "Build a markdown link checker CLI that reads a markdown file,
    extracts all URLs, checks them with HTTP HEAD requests, and reports broken links."

    Start the workflow by running:
    /fflow packages/freeflow/workflows/github-spec-gen/workflow.yaml

    When asked for a repo, use: freematters/testbed
    When asked for the idea, use the markdown link checker description above.

    Follow the workflow states. When you reach a state that requires polling for
    user comments, use the poll_issue.py script as described in the workflow guide.

    IMPORTANT: You are running from the repo root at /home/ubuntu/Code/freematters/.claude/worktrees/optimize-github-spec-gen

## Steps

1. **Issue creation**: Wait for the executor to create the GitHub issue and post the welcome comment
   - Expected: Executor creates an issue on freematters/testbed, posts a welcome comment with options, and starts polling

2. **Choose requirements**: Post "1" on the issue to choose requirements
   - Expected: Executor transitions to requirements and asks a clarification question

3. **Answer questions**: For each question the executor posts, reply with a brief reasonable answer. After answering 2-3 questions, when the executor offers transition options, choose "requirements complete" (checkpoint)
   - Expected: Executor compiles requirements.md artifact, updates status checklist, transitions to checkpoint

4. **Proceed to design**: When the executor posts the checkpoint summary with options, reply "proceed to design"
   - Expected: Executor transitions to design state and begins writing the design

5. **Verify initial design**: Wait for the executor to post the design.md artifact comment. Record the GitHub comment ID of the design artifact (check `artifact_comment_ids.json` or note the comment URL)
   - Expected: Executor posts `## design.md` comment, writes local file, and asks for approval

6. **Request design changes**: Reply on the issue asking for a specific change: "Please add a section on rate limiting — the checker should respect robots.txt and limit concurrent requests to 5 per domain."
   - Expected: Executor edits the local `artifacts/design.md` file using the Edit tool (not a full rewrite), then patches the SAME GitHub comment in-place via `gh api PATCH`. The comment ID in `artifact_comment_ids.json` must remain unchanged.

7. **Approve revised design**: After the executor posts confirmation of the revision, reply "approved"
   - Expected: Executor updates status checklist and transitions to plan

8. **Verify in-place edit**: Check that: (a) the design comment ID is the same as before the revision, (b) the GitHub comment content matches the local file, (c) no minimized comments exist on the issue
   - Expected: Same comment ID, content matches, no minimized comments. Run: `gh api repos/freematters/testbed/issues/{n}/comments --jq '[.[] | select(.body | startswith("## design.md"))] | length'` should return 1 (only one design comment, not two)

9. **Complete workflow**: Let the executor continue through plan -> e2e-gen -> done in normal (non-fast-forward) mode. Approve the plan when asked.
   - Expected: Executor completes the remaining states and finalizes the issue with spec-ready label

## Expected Outcomes

- Design artifact is revised via local file Edit + GitHub comment PATCH (in-place)
- The design comment ID remains the same before and after revision
- Only one `## design.md` comment exists on the issue (no minimize-and-repost)
- Local artifact cache files match their GitHub comment counterparts
- `artifact_comment_ids.json` is consistent throughout the workflow
- The full workflow completes successfully

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Issue creation + welcome comment | 120s |
| Each poll cycle (waiting for user reply) | 120s |
| Requirements Q&A per question | 120s |
| Design generation | 180s |
| Design revision (edit + patch) | 120s |
| Plan generation | 180s |
| E2E-gen + done finalization | 120s |

## Cleanup

- Close the test issue on freematters/testbed: `gh issue close <number> --repo freematters/testbed --comment "[test cleanup] Closing test issue"`
- Clean up the freeflow run directory including artifact cache: `rm -rf $HOME/.freeflow/runs/<run_id>`
