# AGENTS.md

## Project Overview

FreeFlow is a CLI-first workflow runtime for agent workflows. It combines structured workflow control (YAML) with flexible in-state reasoning (LLM). Designed as a Claude Code plugin with CLI + hooks architecture.

Language: TypeScript (npm distribution). Node.js >= 18.

## Design Docs

- [docs/design.md](docs/design.md) — design notes, runtime spec, CLI contracts, storage, hooks

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
| `src/fsm.ts` | Workflow YAML loader, full schema validation |
| `src/store.ts` | Storage: events.jsonl, snapshot.json, file lock |
| `src/errors.ts` | `CliError` + `FsmError` classes |
| `src/output.ts` | `formatStateCard()` + `jsonEnvelope()` |
| `src/commands/start.ts` | Initialize run, commit start event |
| `src/commands/current.ts` | Read snapshot, resolve state card |
| `src/commands/goto.ts` | Validate transition, commit goto event |
| `src/commands/finish.ts` | Abort run, commit finish event |
| `src/hooks/post-tool-use.ts` | PostToolUse hook: auto-detect, counter, reminder |
| `hooks/hooks.json` | Claude Code hook declarations |
| `skills/create/SKILL.md` | /fflow:create — guided workflow YAML creation |
| `skills/start/SKILL.md` | /fflow:start — initialize a workflow run |
| `skills/e2e-run/SKILL.md` | /fflow:e2e-run — run e2e agent tests |
| `src/e2e/multi-turn-session.ts` | V1 query() wrapper for multi-turn agent sessions |
| `src/e2e/agent-session.ts` | High-level agent control with send/wait API |
| `src/e2e/verifier-tools.ts` | MCP tools (run_agent, wait, send) for verifier agent |
| `src/e2e/dual-stream-logger.ts` | Color-coded stderr logger for embedded/verifier/input streams |
| `src/e2e/verify-runner.ts` | Verifier agent runner via Agent SDK |
| `src/e2e/parser.ts` | Test plan markdown parser |
| `src/e2e/path-enumerator.ts` | DFS path enumeration on workflow transitions |
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
    session.jsonl            # Symlink to Claude session JSONL log (freefsm run)
    verifier-session.jsonl   # (verify only) Verifier agent's session log
    executor-session.jsonl   # (verify only) Executor agent's session log
    <test-plan>.md           # (verify only) Copy of the test plan
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
`fflow run` symlinks the Claude session JSONL log (`session.jsonl`) into the run directory.
`fflow verify` symlinks the verifier's (`verifier-session.jsonl`) and executor's (`executor-session.jsonl`) session logs into the run directory, along with a copy of the test plan.

