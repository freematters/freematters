---
name: configure
description: Configure FreeFlow settings like hook enablement. Use when the user wants to enable/disable freeflow features (e.g., "enable tool hook", "disable the post tool use hook").
---

# Configure FreeFlow Settings

Parse the user's natural-language argument and update `~/.freeflow/settings.json` accordingly.

This skill does NOT call any `fflow` CLI commands — it directly reads/writes the settings file.

## Process

1. **Parse intent** — Interpret the user's argument to determine:
   - **Action**: enable or disable
   - **Setting**: which setting to change (currently only `hooks.postToolUse` is supported)

   Common phrasings to recognise:
   - "enable tool hook" / "enable post tool use hook" -> set `hooks.postToolUse` to `true`
   - "disable tool hook" / "disable the hook" -> set `hooks.postToolUse` to `false`

   If the intent is ambiguous, ask the user to clarify before making changes.

2. **Read current settings** — Use the Read tool to read `~/.freeflow/settings.json`.
   - If the file does not exist or is empty, treat current settings as `{}`.
   - If the file contains invalid JSON, treat current settings as `{}`.

3. **Update the setting** — Merge the change into the existing settings object. Do NOT overwrite unrelated keys.

   For example, if the file currently contains:
   ```json
   { "other": "value" }
   ```
   and the user wants to enable the tool hook, write:
   ```json
   {
     "other": "value",
     "hooks": {
       "postToolUse": true
     }
   }
   ```

4. **Write the file** — Use the Write tool to save the updated JSON to `~/.freeflow/settings.json`. Create the `~/.freeflow/` directory first if it does not exist (use `mkdir -p`).

5. **Confirm** — Tell the user what was changed, e.g.:
   - "Enabled the post-tool-use hook. FreeFlow will now show workflow reminders after tool calls."
   - "Disabled the post-tool-use hook. FreeFlow will no longer show workflow reminders after tool calls."

## Supported Settings

| Setting path | Type | Default | Description |
|---|---|---|---|
| `hooks.postToolUse` | boolean | `false` | When `true`, the PostToolUse hook fires workflow reminders after tool calls. |
