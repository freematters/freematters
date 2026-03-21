---
name: configure
description: >-
  Set up the {{CHANNEL}} channel — save the bot token and review access policy.
  Use when the user pastes a {{CHANNEL}} bot token, asks to configure {{CHANNEL}},
  asks "how do I set this up" or "who can reach me," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /{{CHANNEL}}:configure — Channel Setup

Writes the bot token to `{{CHANNEL_DIR}}/.env` and orients the user on access
policy. The server reads both files at boot.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read both state files and give the user a complete picture:

1. **Token** — check `{{CHANNEL_DIR}}/.env` for `{{TOKEN_VAR}}`. Show set/not-set;
   if set, mask most of it.

2. **Access** — read `{{CHANNEL_DIR}}/access.json` (missing file = defaults:
   `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed senders: count and list
   - Pending pairings: count, with codes and sender IDs if any

3. **What next** — end with a concrete next step based on state:
   - No token → *"Run `/{{CHANNEL}}:configure <token>` with your token {{TOKEN_HINT}}."*
   - Token set, nobody allowed → guide user to start pairing or add IDs
   - Token set, someone allowed → *"Ready."*

### `<token>` — save it

1. Treat `$ARGUMENTS` as the token (trim whitespace).
2. `mkdir -p {{CHANNEL_DIR}}`
3. Read existing `.env` if present; update/add the `{{TOKEN_VAR}}=` line,
   preserve other keys. Write back, no quotes around the value.
4. `chmod 600 {{CHANNEL_DIR}}/.env` — the token is a credential.
5. Confirm, then show the no-args status so the user sees where they stand.

### `clear` — remove the token

Delete the `{{TOKEN_VAR}}=` line (or the file if that's the only line).

---

## Implementation notes

- Missing channels dir = not configured, not an error.
- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes take
  effect immediately, no restart.
