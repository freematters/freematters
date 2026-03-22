# Requirements: Disable Tool Hook by Default

### Q1: Should `/fflow configure` be a new CLI command, or a new subcommand under an existing one?

Currently fflow has `start`, `current`, `goto`, `finish`, and `verify`. The user's idea mentions `/fflow configure "I want to enable tool hook"` — this implies a natural-language interface. Should `configure` be a new top-level CLI command (e.g. `fflow configure <prompt>`), or would you prefer a simpler flag-based approach like `fflow config set hook.enabled true`?

**A1:** It should be a skill (`/fflow configure`), not a CLI command. The skill handles the natural-language interface and writes to `~/.freeflow/settings.json`.

### Q2: How should the hook be disabled by default?

Currently `hooks/hooks.json` declares the PostToolUse hook unconditionally. To disable by default, there are a few approaches:

1. **Remove hooks.json from the package entirely** — the `/fflow configure` skill writes the hook into Claude Code's settings when the user enables it, and removes it when disabled.
2. **Keep hooks.json but have the hook script check settings.json first** — the hook is always registered but exits early (no-op) if `settings.json` doesn't have it enabled.
3. **Something else?**

Which approach do you prefer?

**A2:** Option 2 — keep hooks.json, but the hook script checks `~/.freeflow/settings.json` and exits early (no-op) if the hook is not enabled.

### Q3: What should the settings.json schema look like?

A minimal approach would be:

```json
{
  "hook": {
    "enabled": true
  }
}
```

Or should it be more granular to support future settings too? For example:

```json
{
  "hooks": {
    "postToolUse": true
  }
}
```

Do you have a preference, or should we keep it simple and flat for now?

**A3:** Second option — `{ "hooks": { "postToolUse": true } }`. More granular, supports future hook types.

### Q4: For the `/fflow configure` skill — should it toggle the current state (read settings, flip the value), or always ask the user what they want?

For example:
- **Toggle**: skill reads current state, shows it, asks "enable/disable?"
- **Intent-based**: user says `/fflow configure "enable tool hook"` and the skill parses the intent and writes the setting directly, confirming what it did.

Which behavior do you want?

**A4:** Intent-based — the skill parses the user's natural-language argument, writes the setting, and confirms what it did.

### Q5: Should we add e2e testing for this feature?

This feature has two parts: (1) the hook early-exit check, and (2) the configure skill. E2e testing with fflow verify is slow (two agent sessions). Given the scope:

- The hook early-exit logic is easily covered by unit tests
- The skill is a simple read/write to settings.json

I'd recommend **no e2e** for this — unit/integration tests should be sufficient. Do you agree, or do you want e2e coverage?

**A5:** No e2e. Unit/integration tests only.
