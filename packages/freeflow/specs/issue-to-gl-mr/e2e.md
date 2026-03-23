## e2e.md

# Test: gitlab-spec-gen fast-forward mode

Verify that the gitlab-spec-gen workflow creates a GitLab issue, gathers requirements
via issue notes, and completes the full spec pipeline in fast-forward mode
(design → plan → e2e-gen → done) without intermediate user approvals.

## Background

The gitlab-spec-gen workflow drives a spec-generation process entirely through GitLab
issue notes. It creates an issue on a target GitLab project, asks requirements questions via
notes, and posts spec artifacts (requirements.md, design.md, plan.md) as issue notes.

Artifacts are cached locally at `$HOME/.freeflow/runs/{run_id}/artifacts/` and their
GitLab note IDs are tracked in `$HOME/.freeflow/runs/{run_id}/artifact_comment_ids.json`.
When creating artifacts, the executor writes a local file first, then posts it to GitLab
via `glab api`. When updating, it edits the local file and patches the existing note
in-place.

In fast-forward mode, after requirements are gathered, the workflow skips the checkpoint
and proceeds directly through design → plan → e2e-gen → done without polling for user
approval at each step.

The executor will be launched with the `/fflow gitlab-spec-gen` skill. It interacts with
the user (verifier) through GitLab issue notes. The verifier simulates being the issue
creator by posting replies on the issue.

Key states and transitions:
- **create-issue**: Creates a GitLab issue via `glab issue create`, posts welcome note, polls for user choice
- **requirements**: Asks Q&A questions via notes, compiles requirements.md artifact
- **design** (fast-forward): Writes design.md without waiting for approval
- **plan** (fast-forward): Writes plan.md without waiting for approval
- **e2e-gen**: Checks for E2E section in design, generates e2e.md if present
- **done**: Adds spec-ready label, posts summary

The executor polls for replies using `poll_issue_gl.py`. The verifier must post replies
on the GitLab issue (not via `send()`) since the executor reads from GitLab, not stdin.

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Verify `glab` CLI is authenticated: `glab auth status`
- Ensure `GITLAB_TOKEN` env var is set
- Verify GitLab project is accessible: `glab api projects/ran.xian%2Ftest-proj --hostname gitlab.corp.metabit-trading.com`
- Executor prompt: |
    You are running the gitlab-spec-gen workflow to generate a spec on the GitLab project ran.xian/test-proj
    on gitlab.corp.metabit-trading.com.

    The idea: "Build a simple key-value store CLI tool that supports get, set, and delete
    operations, storing data in a local JSON file."

    Start the workflow by running:
    /fflow packages/freeflow/workflows/gitlab-spec-gen/workflow.yaml

    When asked for a project, use: ran.xian/test-proj (on gitlab.corp.metabit-trading.com)
    When asked for the idea, use the key-value store description above.

    Follow the workflow states. When you reach a state that requires polling for user
    notes, use the poll_issue_gl.py script as described in the workflow guide.

    IMPORTANT: You are running from the repo root.

## Steps

1. **Issue creation**: Wait for the executor to create the GitLab issue and post the welcome note
   - Expected: Executor creates an issue on ran.xian/test-proj with a title related to "key-value store", posts a welcome note offering requirements or research, and starts polling for a reply

2. **Choose requirements**: When the executor is polling for the user's choice, post a reply on the issue choosing requirements (option 1). Use `glab api -X POST projects/ran.xian%2Ftest-proj/issues/<iid>/notes -f body=1 --hostname gitlab.corp.metabit-trading.com` to reply.
   - Expected: Executor receives the reply and transitions to the requirements state, begins asking clarification questions

3. **Answer first question**: Wait for the executor to post a requirements question. Then reply on the issue with a reasonable answer. Keep it simple — e.g., "Yes, that sounds good" or a brief answer to whatever was asked.
   - Expected: Executor records the Q&A and asks another question or offers to proceed

4. **Choose fast forward**: When the executor offers transition options (including fast forward), reply on the issue with "fast forward" or the number corresponding to fast forward.
   - Expected: Executor compiles requirements.md artifact note, updates the status checklist, and transitions directly to design without waiting for checkpoint approval

5. **Verify design artifact**: Wait for the executor to post the design.md artifact note on the issue. Do NOT reply — in fast-forward mode, no approval is needed.
   - Expected: Executor posts a `## design.md` note with architecture overview and transitions to plan without polling

6. **Verify plan artifact**: Wait for the executor to post the plan.md artifact note on the issue.
   - Expected: Executor posts a `## plan.md` note with implementation steps and transitions to e2e-gen without polling

7. **Verify completion**: Wait for the executor to reach the done state and finalize the issue.
   - Expected: Executor adds the `spec-ready` label, checks off status items, and posts a summary note. The workflow completes.

8. **Verify local artifact cache**: After the workflow completes, find the run ID from the executor output and verify local artifact files exist. Run `ls $HOME/.freeflow/runs/*/artifacts/` to find artifact files, and `cat $HOME/.freeflow/runs/*/artifact_comment_ids.json` to check the note ID tracking file.
   - Expected: Local artifact files exist for at least requirements.md, design.md, and plan.md. The artifact_comment_ids.json file contains numeric note IDs for each artifact. The GitLab notes referenced by those IDs exist and match the local file content.

## Expected Outcomes

- A GitLab issue is created on ran.xian/test-proj with proper structure (title, status checklist)
- Requirements Q&A happens through issue notes with `[bot reply]` prefix
- Fast-forward mode skips checkpoint and intermediate approvals
- All spec artifacts (requirements.md, design.md, plan.md) are posted as issue notes
- Local artifact cache files exist at `$HOME/.freeflow/runs/{run_id}/artifacts/`
- `artifact_comment_ids.json` maps artifact filenames to valid GitLab note IDs
- The issue receives the `spec-ready` label upon completion
- Status checklist items are checked off in the issue description

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Issue creation + welcome note | 120s |
| Each poll cycle (waiting for user reply) | 120s |
| Requirements Q&A per question | 120s |
| Design generation (fast-forward) | 180s |
| Plan generation (fast-forward) | 180s |
| E2E-gen + done finalization | 120s |

Note: The executor makes multiple GitLab API calls and Claude API calls per state.
Allow generous timeouts, especially for design and plan generation which involve
substantial content creation.

## Cleanup

- Close the test issue on ran.xian/test-proj: `glab api -X PUT projects/ran.xian%2Ftest-proj/issues/<iid> -f state_event=close --hostname gitlab.corp.metabit-trading.com`
- Remove the `spec-ready` label if it was created: this is fine to leave as it may be reused
- Clean up the freeflow run directory including artifact cache: `rm -rf $HOME/.freeflow/runs/<run_id>`
