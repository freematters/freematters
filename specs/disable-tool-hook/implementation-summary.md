# Implementation Summary: Disable Tool Hook by Default

## Overview

Made the freeflow PostToolUse hook opt-in. The hook script now checks `~/.freeflow/settings.json` before executing — it's a no-op unless `hooks.postToolUse` is `true`. A new `/fflow configure` skill lets users enable/disable the hook via natural language.

## Steps Completed

| Step | Title | Commit |
|------|-------|--------|
| 1 | Settings module | `4f25211` |
| 2 | Hook gate + integration tests | `c77788e` |
| 3 | Configure skill | `10d4023` |

## Test Summary

- 165 tests total, all passing
- 8 new settings module tests (unit)
- 3 new hook gate tests (integration)
- 6 existing hook tests updated with `enableHook()` fixture
- Lint/format: clean (biome check)

## Files Created/Modified

| File | Description |
|------|-------------|
| `src/settings.ts` | New — `loadSettings`, `saveSettings`, `isHookEnabled` |
| `src/__tests__/settings.test.ts` | New — 8 unit tests for settings module |
| `src/hooks/post-tool-use.ts` | Modified — added `isHookEnabled` gate at top of `handlePostToolUse` |
| `src/__tests__/hooks/post-tool-use.test.ts` | Modified — 3 new gate tests, 6 existing tests updated |
| `skills/configure/SKILL.md` | New — `/fflow configure` skill |

## How to Run

```bash
cd packages/freeflow
npm run build        # compile TypeScript
npm test             # run all 165 tests
npm run check        # biome lint/format
```

To enable the hook: `/fflow configure "enable tool hook"`
To disable: `/fflow configure "disable tool hook"`

## Remaining Work

- None — feature is complete and tested
