# GitHub CLI Reference

## Authentication

```bash
gh auth status
```
If not logged in, prompt user to run `gh auth login`.

## Command Preference

**Prefer `gh pr` / `gh run` / `gh issue` high-level commands** over raw `gh api` calls.
They handle auth, pagination, and output formatting automatically.

**Use `gh api` only** when high-level commands can't do the job:
- GraphQL mutations (resolve threads, add reactions)
- Bulk operations with custom jq filters
- Endpoints without a CLI equivalent

## GraphQL Queries

Always **inline** owner/repo/PR values directly into the query string.
Do NOT use `-f owner=... -f repo=...` variable binding — shell escaping breaks it.

```bash
# Correct
gh api graphql -f query='query { repository(owner: "myorg", name: "myrepo") { ... } }'

# Wrong — breaks due to shell escaping
gh api graphql -f query='query($o:String!){repository(owner:$o,...)}' -f o="myorg"
```

## Thread Resolution

```bash
gh api graphql -f query='
  mutation { resolveReviewThread(input: {threadId: "<thread_id>"}) {
    thread { isResolved }
  } }
'
```

## Check Runs

Use `gh pr checks <N>` instead of raw `/commits/{sha}/check-runs` API.

## `@bot` Handling

- Search: pipe through `grep '@bot'` rather than embedding in jq (avoids escaping issues).
- Dedup: inline threads are handled if a subsequent note starts with `[from bot]`;
  issue comments are handled if they have a rocket (🚀) reaction.

## `[from bot]` Convention

All bot-authored comments MUST start with `[from bot]` to distinguish agent-generated
comments from human-authored ones.

## PR Review Submission

Submit a review with comments:
```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  -f event=COMMENT -f body="..." -f 'comments[]=...'
```

## Reply to Review Thread

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/comments/{comment_id}/replies \
  -f body="[from bot] ..."
```

## Error Handling

- **Rate limit (429)**: Read `X-RateLimit-Reset` header, wait until reset, retry.
- **Network errors**: Retry after 5s, fail after 3 attempts.
- **Issue body update conflict**: Re-read the current body, re-apply changes, retry.
