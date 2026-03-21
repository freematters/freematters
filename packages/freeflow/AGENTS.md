# AGENTS.md

## Project Overview

FreeFlow is a CLI-first workflow runtime for agent workflows. It combines structured workflow control (FSM YAML) with flexible in-state reasoning (LLM). Designed as a Claude Code plugin with CLI + hooks architecture.

Language: TypeScript (npm distribution). Node.js >= 18.

## Design Docs

- [docs/design-primary.md](docs/design-primary.md) — authoritative v1 spec: runtime, CLI contracts, storage, integration
- [docs/design-alternative.md](docs/design-alternative.md) — alternative design notes and hook details

Read the design docs before making any changes.

## Architecture

```
fflow CLI (human-readable default, -j JSON)
    ├── commands/ (start, current, goto, finish)
    ├── commands/e2e/ (gen, verify)
    ├── e2e/ (agent-session, multi-turn-session, verifier-tools, dual-stream-logger, verify-runner, parser, path-enumerator)
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
| `skills/create/SKILL.md` | /fflow:create — guided FSM YAML creation |
| `skills/start/SKILL.md` | /fflow:start — initialize a workflow run |
| `skills/e2e-run/SKILL.md` | /fflow:e2e-run — run e2e agent tests |
| `src/e2e/multi-turn-session.ts` | V1 query() wrapper for multi-turn agent sessions |
| `src/e2e/agent-session.ts` | High-level agent control with send/wait API |
| `src/e2e/verifier-tools.ts` | MCP tools (run_agent, wait, send) for verifier agent |
| `src/e2e/dual-stream-logger.ts` | Color-coded stderr logger for embedded/verifier/input streams |
| `src/e2e/verify-runner.ts` | Verifier agent runner via Agent SDK |
| `src/e2e/parser.ts` | Test plan markdown parser |
| `src/e2e/path-enumerator.ts` | DFS path enumeration on FSM transitions |
| `src/commands/e2e/verify.ts` | `fflow verify` command |

## CLI Commands

```bash
fflow start <fsm_path> [--run-id <id>] [-j]
fflow current --run-id <id> [-j]
fflow goto <target> --run-id <id> --on <label> [-j]
fflow finish --run-id <id> [-j]
fflow verify <plan.md> --test-dir <path> [--model <model>] [--verbose] [-j]
```

Global: `--root <path>` overrides storage root (default `~/.freeflow/`, env `FREEFLOW_ROOT`).

## Error Codes

`SCHEMA_INVALID`, `RUN_EXISTS`, `RUN_NOT_FOUND`, `RUN_NOT_ACTIVE`, `STATE_NOT_FOUND`, `INVALID_TRANSITION`, `ARGS_INVALID`, `WORKFLOW_NOT_FOUND`, `WORKFLOW_AMBIGUOUS`

Exit codes: `0` success, `2` failure.

## Storage

```
~/.freeflow/
  runs/<run_id>/
    fsm.meta.json    # Run metadata
    events.jsonl     # Append-only event log
    snapshot.json    # Current state snapshot
    session.jsonl            # Symlink to Claude session JSONL log
    embedded-session.jsonl   # (verify only) Symlink to embedded agent's session log
    lock/                    # Directory-based file lock
  sessions/
    <session_id>.json      # Session→run binding
    <session_id>.counter   # Hook call counter
```

Write path (§5.5): acquire lock → read snapshot → validate → append event → update snapshot → release lock.

## Build & Test

```bash
npm run build        # Compile TypeScript
npm test             # Vitest (200 tests)
npm run check        # Biome format + lint
```

## E2E Testing

Agent-driven e2e testing framework. Test plans are structured markdown executed by a Claude agent.

```bash
# Execute a test plan with a live agent
fflow verify test-plan.md --test-dir ./out
```

Test plans are raw markdown read by the verifier agent.
Output: `test-report.md` in `--test-dir`.
Dogfood test plans live in `e2e/`.

Both `fflow run` and `fflow verify` print the Claude session ID to stderr on session start.
`fflow run` symlinks the Claude session JSONL log (`session.jsonl`) into the FSM run directory.
`fflow verify` symlinks both the verifier's (`session.jsonl`) and embedded agent's (`embedded-session.jsonl`) Claude session logs into the verifier's FSM run directory.

## Implementation Status

| Milestone | Status |
|-----------|--------|
| M1-M6: Schema, storage, CLI, all commands | Done |
| M7: PostToolUse reminder hook | Done |
| M8: Skills (/fflow:create, /fflow:start, /fflow:e2e-run) | Done |
| M9: E2E testing framework (gen, verify, verifier.workflow.yaml) | Done |
