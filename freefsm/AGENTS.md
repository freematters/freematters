# AGENTS.md

## Project Overview

FreeFSM is a CLI-first FSM runtime for agent workflows. It combines structured workflow control (FSM YAML) with flexible in-state reasoning (LLM). Designed as a Claude Code plugin with CLI + hooks architecture.

Language: TypeScript (npm distribution). Node.js >= 18.

## Design Docs

- [docs/design-primary.md](docs/design-primary.md) — authoritative v1 spec: runtime, CLI contracts, storage, integration
- [docs/design-alternative.md](docs/design-alternative.md) — alternative design notes and hook details

Read the design docs before making any changes.

## Architecture

```
freefsm CLI (human-readable default, -j JSON)
    ├── commands/ (start, current, goto, finish)
    ├── hooks/ (PostToolUse reminder)
    ├── fsm.ts (schema loader + validation)
    ├── store.ts (events + snapshots + file lock + sessions)
    └── output.ts (state card + reminder + JSON envelope)
```

Design principles:
- Deterministic transition validation (YAML is authoritative)
- Event sourcing: append-only JSONL + snapshot for fast reads
- Per-run file lock for concurrent safety
- Stable machine-readable contracts (`-j/--json`)

## Key Files

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point, arg parsing, command routing |
| `src/fsm.ts` | FSM YAML loader, full schema validation |
| `src/store.ts` | Storage: events.jsonl, snapshot.json, file lock |
| `src/errors.ts` | `CliError` + `FsmError` classes |
| `src/output.ts` | `formatStateCard()` + `jsonEnvelope()` |
| `src/commands/start.ts` | Initialize run, commit start event |
| `src/commands/current.ts` | Read snapshot, resolve state card |
| `src/commands/goto.ts` | Validate transition, commit goto event |
| `src/commands/finish.ts` | Abort run, commit finish event |
| `src/hooks/post-tool-use.ts` | PostToolUse hook: auto-detect, counter, reminder |
| `hooks/hooks.json` | Claude Code hook declarations |
| `skills/create/SKILL.md` | /fsm:create — guided FSM YAML creation |
| `skills/start/SKILL.md` | /fsm:start — initialize a workflow run |
| `skills/current/SKILL.md` | /fsm:current — query current state |
| `skills/finish/SKILL.md` | /fsm:finish — abort an active run |

## CLI Commands

```bash
freefsm start <fsm_path> [--run-id <id>] [-j]
freefsm current --run-id <id> [-j]
freefsm goto <target> --run-id <id> --on <label> [-j]
freefsm finish --run-id <id> [-j]
```

Global: `--root <path>` overrides storage root (default `~/.freefsm/`, env `FREEFSM_ROOT`).

## Error Codes

`SCHEMA_INVALID`, `RUN_EXISTS`, `RUN_NOT_FOUND`, `RUN_NOT_ACTIVE`, `STATE_NOT_FOUND`, `INVALID_TRANSITION`, `ARGS_INVALID`

Exit codes: `0` success, `2` failure.

## Storage

```
~/.freefsm/
  runs/<run_id>/
    fsm.meta.json    # Run metadata
    events.jsonl     # Append-only event log
    snapshot.json    # Current state snapshot
    lock/            # Directory-based file lock
  sessions/
    <session_id>.json      # Session→run binding
    <session_id>.counter   # Hook call counter
```

Write path (§5.5): acquire lock → read snapshot → validate → append event → update snapshot → release lock.

## Build & Test

```bash
npm run build        # Compile TypeScript
npm test             # Vitest
npm run check        # Biome format + lint
```

## Implementation Status

| Milestone | Status |
|-----------|--------|
| M1-M6: Schema, storage, CLI, all commands | Done |
| M7: PostToolUse reminder hook | Done |
| M8: Skills (/fsm:create, /fsm:start, /fsm:current, /fsm:finish) | Done |
