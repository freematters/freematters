---
name: configure
description: >-
  Set up the Slack channel — save bot tokens and review access policy.
  Use when the user pastes a Slack bot token, asks to configure Slack,
  asks "how do I set this up" or "who can reach me," or wants to check
  channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /slack:configure — Slack Channel Setup

Writes Slack tokens to `~/.claude/channels/slack/.env` and orients the user
on access policy. The server reads both files at boot.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read both state files and give the user a complete picture:

1. **Tokens** — check `~/.claude/channels/slack/.env` for:
   - `SLACK_BOT_TOKEN` — the OAuth bot token (starts with `xoxb-`)
   - `SLACK_APP_TOKEN` — the app-level token for Socket Mode (starts with `xapp-`)
   Show set/not-set for each; if set, show first 10 chars masked.

2. **Access** — read `~/.claude/channels/slack/access.json` (missing file =
   defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed senders: count and list
   - Pending pairings: count, with codes and sender IDs if any

3. **What next** — end with a concrete next step based on state:
   - No tokens → *"You need two tokens from api.slack.com/apps:*
     *1. OAuth Bot Token (`xoxb-...`) from OAuth & Permissions*
     *2. App-Level Token (`xapp-...`) from Basic Information → App-Level Tokens (with `connections:write` scope)*
     *Run `/slack:configure bot <bot-token>` and `/slack:configure app <app-token>`."*
   - Both tokens set, nobody allowed → *"DM your bot on Slack. It replies
     with a code; approve with `/slack:access pair <code>`."*
   - Both tokens set, someone allowed → *"Ready."*

**Push toward lockdown — always.** Once IDs are captured, offer to run
`/slack:access policy allowlist`.

### `bot <token>` — save bot token

1. Treat remaining `$ARGUMENTS` after `bot` as the token.
2. `mkdir -p ~/.claude/channels/slack`
3. Read existing `.env`; update/add `SLACK_BOT_TOKEN=` line. Write back.
4. `chmod 600 ~/.claude/channels/slack/.env`
5. Show status.

### `app <token>` — save app token

Same as bot, but for `SLACK_APP_TOKEN=` line.

### `clear` — remove both tokens

Delete both token lines from `.env`.

---

## Implementation notes

- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`.
- `access.json` is re-read on every inbound message — policy changes take
  effect immediately.
