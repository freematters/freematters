# Summary: Disable Tool Hook by Default

## Project Overview

Make the freeflow PostToolUse hook opt-in by adding a settings gate that checks `~/.freeflow/settings.json` before executing hook logic. A new `/fflow configure` skill lets users enable/disable the hook via natural language. The hook registration in `hooks.json` stays but the script no-ops unless explicitly enabled.

## Artifacts

| File | Description |
|------|-------------|
| `rough-idea.md` | Original user input |
| `requirements.md` | Q&A record with 5 clarified requirements |
| `design.md` | Architecture, components, data models, integration tests, error handling |
| `plan.md` | 3-step implementation plan with dependency graph |

## Key Decisions

1. **Hook stays registered, exits early** — keeps `hooks.json` in the package but the script checks settings before doing work. Simpler than dynamic hook registration.
2. **Settings schema**: `{ "hooks": { "postToolUse": boolean } }` — granular enough for future hook types.
3. **Skill, not CLI command** — `/fflow configure` is a skill that parses natural language and writes settings directly.
4. **No e2e tests** — feature is simple enough for unit/integration tests only.

## Next Steps

1. Implement Step 1: Settings module (`src/settings.ts`)
2. Implement Step 2: Hook gate in `post-tool-use.ts` + integration tests
3. Implement Step 3: Configure skill (`skills/configure/SKILL.md`)
