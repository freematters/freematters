---
name: configure
description: >-
  Set up the Notion channel — save the API token and configure which pages/databases
  to watch. Use when the user pastes a Notion integration token or asks to configure
  Notion notifications.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /notion:configure — Notion Channel Setup

Writes the Notion integration token to `~/.claude/channels/notion/.env`.
The server reads this at boot.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

1. **Token** — check `~/.claude/channels/notion/.env` for `NOTION_API_TOKEN`.
   Show set/not-set; if set, mask most of it.

2. **What next** — concrete next step:
   - No token → *"Create an internal integration at notion.so/my-integrations,
     copy the token, then run `/notion:configure <token>`. Make sure to connect
     the integration to the pages/databases you want to monitor."*
   - Token set → *"Ready. The channel will poll for changes to pages and
     databases your integration can access."*

### `<token>` — save it

1. Treat `$ARGUMENTS` as the token (trim whitespace). Notion tokens start
   with `ntn_` or `secret_`.
2. `mkdir -p ~/.claude/channels/notion`
3. Read existing `.env`; update/add `NOTION_API_TOKEN=` line. Write back.
4. `chmod 600 ~/.claude/channels/notion/.env`
5. Show status.

### `clear` — remove the token

Delete the `NOTION_API_TOKEN=` line from `.env`.

---

## Implementation notes

- Token changes need a session restart or `/reload-plugins`.
- No access skill needed — Notion access is controlled by which pages the
  integration is connected to in Notion's UI.
