# GitLab CLI Reference

## Authentication

`GITLAB_TOKEN` env var or `glab auth login`. Verify with `glab auth status`.

## Command Preference

**Prefer native `glab` commands** — they auto-detect host and project from the git remote:

| Operation | Command |
|-----------|---------|
| Create issue | `glab issue create -t "title" -d "body" --no-editor` |
| Post note | `glab issue note <iid> -m "body"` |
| View issue | `glab issue view <iid> -F json` |
| Update issue | `glab issue update <iid> -d "desc" -l label -u label` |
| Create MR | `glab mr create -t "title" -d "body" -s source -b target --remove-source-branch --squash-before-merge --push --yes` |
| View MR | `glab mr view <iid> -F json` |
| Update MR | `glab mr update <iid> -d "desc"` |

**Use `glab api` only** when native commands can't do the job:
- File-body upload: `-F body=@file` (artifact creation/update)
- Note editing: `PUT .../notes/<id>` (no native equivalent)
- Award emoji: `POST .../award_emoji`
- Resolve discussions: `PUT .../discussions/<id>`
- Label creation: `POST .../labels`

## URL-Encoded Project Path

For `glab api` calls, URL-encode the project path:

```bash
PROJECT_PATH=$(git remote get-url origin | sed 's|.*://[^/]*/||;s|\.git$||' | sed 's|.*:||')
ENCODED_PATH=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))" <<< "$PROJECT_PATH")
```

## Thread Resolution

```bash
glab api -X PUT "projects/$ENCODED_PATH/merge_requests/<mr_iid>/discussions/<discussion_id>" \
  -f resolved=true
```

## Emoji Dedup

Use award emoji (eyes, rocket) on notes instead of GitHub reactions:

```bash
# Acknowledge receipt
glab api -X POST "projects/$ENCODED_PATH/merge_requests/<mr_iid>/notes/<note_id>/award_emoji" \
  -f name=eyes

# Mark as handled
glab api -X POST "projects/$ENCODED_PATH/merge_requests/<mr_iid>/notes/<note_id>/award_emoji" \
  -f name=rocket
```

## `@bot` Handling

- Search: pipe through `grep '@bot'` rather than embedding in jq (avoids escaping issues).
- Dedup: discussion threads are handled if a subsequent note starts with `[from bot]`;
  standalone notes are handled if they have a rocket award emoji.

## `[from bot]` Convention

All bot-authored notes MUST be prefixed with `[from bot]` to distinguish agent-generated
notes from human-authored ones.

## Error Handling

- **Rate limit (429)**: Read `Retry-After` header, wait, retry.
- **Network errors**: Retry after 5s, fail after 3 attempts.
- **Description update conflict**: Re-read, re-apply, retry.
