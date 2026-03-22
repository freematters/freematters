# Implementation Summary: Lite Mode for fflow

## Overview

Added `--lite` mode to `fflow start` that reduces token cost when workflow states are re-entered during a conversation. In lite mode, `fflow goto` detects previously-visited states and outputs only transitions and todos (omitting the full prompt), directing the agent to call `fflow current` for full instructions. The PostToolUse hook reminder was also simplified to always omit prompt excerpts, showing only transitions and todos.

## Steps Completed

| Step | Title | Commit |
|------|-------|--------|
| 1 | Extend data models and store | `94d3d13` |
| 2 | Add formatLiteCard and simplify formatReminder | `20d044f` |
| 3 | Lite-aware goto command | `bc92252` |
| 4 | start --lite flag and CLI parsing | `2e55ae3` |
| 5 | Integration tests | `4914a1a` |
| - | Review fixes (round 1) | `df6281e` |

## Test Summary

- **Total tests**: 188 (19 new across 5 test files)
- **All passing**: Yes
- **Coverage**: Unit tests for store, output, goto, start; integration tests for full round-trips

## Files Created/Modified

| File | Description |
|------|-------------|
| `src/store.ts` | Added `lite?: boolean` to `RunMeta`, `visited_states?: string[]` to `Snapshot`/`SnapshotInput`, `initRun` overrides |
| `src/output.ts` | Added `formatLiteCard()`, simplified `formatReminder()` to omit prompt |
| `src/commands/goto.ts` | Lite-aware output: checks visited states, outputs lite card on re-entry |
| `src/commands/start.ts` | Accepts `--lite` flag, persists in metadata, seeds `visited_states` |
| `src/cli.ts` | Added `--lite` CLI flag for start command |
| `src/__tests__/store.test.ts` | 4 new tests for data model extensions |
| `src/__tests__/output-lite.test.ts` | 6 new tests for formatLiteCard and simplified formatReminder |
| `src/__tests__/goto-lite.test.ts` | 5 new tests for lite-aware goto behavior |
| `src/__tests__/start-lite.test.ts` | 4 new tests for start --lite flag |
| `src/__tests__/lite-integration.test.ts` | 4 integration tests for full round-trips |

## How to Run

```bash
cd packages/freeflow
npm run build
npm test

# Use lite mode
fflow start workflow.yaml --run-id my-run --lite
fflow goto next-state --run-id my-run --on "transition label"
fflow current --run-id my-run  # always shows full instructions
```

## Remaining Work

- No manual testing needed — all behavior is covered by automated tests
- Documentation: consider updating `docs/design.md` to mention lite mode
- The `--lite` flag should be added to the `/fflow` skill's start command template
