---
name: configure
description: >-
  Set up the GitHub Issues channel — save the GitHub token and configure which
  repos to watch. Use when the user pastes a GitHub token or asks to configure
  GitHub Issues notifications.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /github-issues:configure — GitHub Issues Channel Setup

Writes the GitHub token to `~/.claude/channels/github-issues/.env` and
manages the list of repos to watch.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

1. **Token** — check `~/.claude/channels/github-issues/.env` for
   `GITHUB_TOKEN`. Show set/not-set; if set, mask most of it.

2. **Repos** — check `~/.claude/channels/github-issues/repos.json` for
   watched repos. Show the list if any.

3. **Sender filter** — check `~/.claude/channels/github-issues/filter.json`.
   Show allowFrom and ignoreFrom lists if configured.
   If not configured, say "No sender filter — all events forwarded."

4. **What next** — concrete next step:
   - No token → *"Create a personal access token at github.com/settings/tokens
     with `repo` scope, then run `/github-issues:configure <token>`."*
   - Token set, no repos → *"Run `/github-issues:configure watch owner/repo`
     to start watching a repository."*
   - Token set, repos configured → *"Ready. Watching: [repo list]."*

### `<token>` — save it

1. Treat `$ARGUMENTS` as the token if it starts with `ghp_` or `github_pat_`.
2. `mkdir -p ~/.claude/channels/github-issues`
3. Read existing `.env`; update/add `GITHUB_TOKEN=` line. Write back.
4. `chmod 600 ~/.claude/channels/github-issues/.env`
5. Show status.

### `watch <owner/repo>`

1. Read `~/.claude/channels/github-issues/repos.json` (default `[]`).
2. Add `owner/repo` (dedupe). Write back.
3. Confirm.

### `unwatch <owner/repo>`

Remove from list. Write back.

### `allow <username>`

Add a GitHub username to the sender allowlist.
1. Read `~/.claude/channels/github-issues/filter.json`
   (default `{"allowFrom":[],"ignoreFrom":[]}`).
2. Add username to `allowFrom` (dedupe). Write back.
3. Confirm. When `allowFrom` is non-empty, only events from those users are forwarded.

### `ignore <username>`

Add a GitHub username to the ignore list (e.g., bots like `dependabot`).
1. Read filter.json. Add username to `ignoreFrom` (dedupe). Write back.
2. Confirm. `ignoreFrom` is checked first — ignored users are always dropped
   even if they're also in `allowFrom`.

### `unallow <username>`

Remove from `allowFrom`. Write back.

### `unignore <username>`

Remove from `ignoreFrom`. Write back.

### `filter clear`

Delete `filter.json`. All events will be forwarded again.

### `clear` — remove the token

Delete the `GITHUB_TOKEN=` line from `.env`.

---

## Sender filter

`~/.claude/channels/github-issues/filter.json`:

```json
{
  "allowFrom": ["teammate1", "teammate2"],
  "ignoreFrom": ["dependabot", "renovate"]
}
```

- **No file** = no filtering, all events forwarded (default).
- **`allowFrom` non-empty** = only events from these GitHub usernames pass.
- **`ignoreFrom`** = events from these users are always dropped (checked first).
- **Both empty** = same as no file, all events forwarded.
- Filter is re-read every poll cycle — changes take effect within 60s.

## Implementation notes

- Token changes need a session restart or `/reload-plugins`.
- Repo and filter changes take effect on next poll cycle (within 60s by default).
