# Test: gitlab-mr-lifecycle creates and monitors MR

Verify that the gitlab-mr-lifecycle workflow creates a GitLab MR from an existing branch,
monitors its status, and reaches the done state when merged.

## Background

The gitlab-mr-lifecycle workflow monitors a GitLab MR from creation through merge or close.
It creates an MR via `glab mr create`, polls for status changes using `poll_mr_gl.py`,
and handles CI failures, rebases, and review discussions.

States: `create-mr` → `poll` → (fix | rebase | address) → `push` → `poll` → `done`

The test uses a pre-existing branch `issue-1-kv-store` on `gitlab.corp.metabit-trading.com/ran.xian/test-proj`
that has a simple Python key-value store implementation ready to merge into `master`.

The executor will:
- Start the gitlab-mr-lifecycle workflow from the test-proj directory
- The workflow creates an MR from `issue-1-kv-store` → `master`
- Poll for MR status until it reaches a stable state (CI passes or no CI configured)
- The verifier will then merge the MR via the GitLab API
- The poll script detects the merge and the workflow transitions to done

The executor uses `glab` CLI for all GitLab interactions. Auth is via `GITLAB_TOKEN` env var.

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Verify `glab` CLI is installed and authenticated: `glab auth status`
- Ensure `GITLAB_TOKEN` env var is set: `export GITLAB_TOKEN=$(grep 'gitlab_token:' ~/.metabit/mg/config.yml | awk '{print $2}')`
- Verify the test branch exists: `cd /home/ubuntu/Code/test-proj && git branch -a | grep issue-1-kv-store`
- Ensure we're on the right branch: `cd /home/ubuntu/Code/test-proj && git checkout issue-1-kv-store`
- Executor prompt: |
    You are testing the gitlab-mr-lifecycle workflow. Your working directory is /home/ubuntu/Code/test-proj.
    This is a GitLab repo at gitlab.corp.metabit-trading.com/ran.xian/test-proj.

    Start the workflow by running:
    /fflow packages/freeflow/workflows/gitlab-mr-lifecycle/workflow.yaml

    The workflow will create an MR from branch `issue-1-kv-store` to `master`.
    Follow the workflow states. The target branch is `master`.

    IMPORTANT: The fflow CLI is at /home/ubuntu/Code/freematters/.claude/worktrees/gitlab/packages/freeflow/dist/cli.js
    You are running from /home/ubuntu/Code/test-proj

## Steps

1. **MR creation**: Wait for the executor to create the MR and post an implementation summary note
   - Expected: Executor runs `glab auth status`, detects project path and hostname from git remote, creates an MR from `issue-1-kv-store` to `master`, posts an implementation summary note with `[from bot]` prefix, and starts polling

2. **Verify MR exists**: While the executor is polling, verify the MR was created on GitLab. Run `export GITLAB_TOKEN=$(grep 'gitlab_token:' ~/.metabit/mg/config.yml | awk '{print $2}') && glab api projects/ran.xian%2Ftest-proj/merge_requests --hostname gitlab.corp.metabit-trading.com | jq '[.[] | select(.source_branch=="issue-1-kv-store")] | .[0] | {iid: .iid, title: .title, state: .state}'`
   - Expected: An MR exists with source_branch `issue-1-kv-store`, state is `opened`

3. **Merge the MR**: Merge the MR via API to trigger the poll script's exit. Run `export GITLAB_TOKEN=$(grep 'gitlab_token:' ~/.metabit/mg/config.yml | awk '{print $2}') && MR_IID=$(glab api projects/ran.xian%2Ftest-proj/merge_requests --hostname gitlab.corp.metabit-trading.com | jq '[.[] | select(.source_branch=="issue-1-kv-store")] | .[0] | .iid') && glab api -X PUT "projects/ran.xian%2Ftest-proj/merge_requests/$MR_IID/merge" --hostname gitlab.corp.metabit-trading.com | jq '.state'`
   - Expected: MR state changes to `merged`

4. **Verify workflow completion**: Wait for the executor to detect the merge and transition to the done state
   - Expected: Executor detects `RESULT: MR merged` from the poll script and transitions to the done state. The workflow completes.

## Expected Outcomes

- An MR is created on `gitlab.corp.metabit-trading.com/ran.xian/test-proj` from `issue-1-kv-store` to `master`
- The MR has an implementation summary note with `[from bot]` prefix
- After merging, the workflow detects the merge and completes in the done state
- The `glab` CLI is used throughout (no raw curl/HTTP)

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| MR creation + summary note | 180s |
| Polling cycle detection | 120s |
| Merge detection + done transition | 120s |

Note: The executor makes multiple `glab` API calls and Claude API calls per state.
Allow generous timeouts for MR creation which involves branch comparison and description generation.

## Cleanup

- Delete the test branch on remote if needed: `cd /home/ubuntu/Code/test-proj && git push origin --delete issue-1-kv-store 2>/dev/null || true`
- Reset local repo to master: `cd /home/ubuntu/Code/test-proj && git checkout master && git pull`
- Clean up the freeflow run directory: `rm -rf $HOME/.freeflow/runs/gitlab-mr-lifecycle-*`
