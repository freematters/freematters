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
    ├── commands/e2e/ (gen, verify)
    ├── e2e/ (parser, transcript-logger, verify-runner, report-generator, path-enumerator)
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
| `src/e2e/parser.ts` | Test plan markdown parser (Setup, Steps, Expected Outcomes, Cleanup) |
| `src/e2e/verify-runner.ts` | FSM-driven agent verification loop with transcript capture |
| `src/e2e/transcript-logger.ts` | Timestamped transcript + API JSONL logging |
| `src/e2e/report-generator.ts` | Generate test-report.md with per-step verdicts |
| `src/e2e/path-enumerator.ts` | DFS path enumeration on FSM transitions |
| `src/commands/e2e/verify.ts` | `freefsm e2e verify` command |
| `src/commands/e2e/gen.ts` | `freefsm e2e gen` command |
| `workflows/verifier.fsm.yaml` | FSM workflow for structured e2e verification |

## CLI Commands

```bash
freefsm start <fsm_path> [--run-id <id>] [-j]
freefsm current --run-id <id> [-j]
freefsm goto <target> --run-id <id> --on <label> [-j]
freefsm finish --run-id <id> [-j]
freefsm e2e gen <workflow.yaml> [--output <file>] [-j]
freefsm e2e verify <plan.md> --test-dir <path> [--parse-only] [--model <model>] [--dangerously-bypass-permissions] [-j]
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
npm test             # Vitest (200 tests)
npm run check        # Biome format + lint
npm run test:e2e:parse  # Validate e2e test plans (parse-only, no API)
```

## E2E Testing

Agent-driven e2e testing framework. Test plans are structured markdown executed by a Claude agent.

```bash
# Generate a test plan from a workflow YAML
freefsm e2e gen workflows/verifier.fsm.yaml --output test-plan.md

# Validate a test plan parses correctly (no API needed)
freefsm e2e verify test-plan.md --test-dir ./out --parse-only

# Execute a test plan with a live agent (requires API access)
freefsm e2e verify test-plan.md --test-dir ./out --dangerously-bypass-permissions
```

Test plan format: `## Setup`, `## Steps`, `## Expected Outcomes`, `## Cleanup`.
Output: `transcript.jsonl`, `api.jsonl`, `test-report.md` in `--test-dir`.
Dogfood test plans live in `e2e/`.

## Implementation Status

| Milestone | Status |
|-----------|--------|
| M1-M6: Schema, storage, CLI, all commands | Done |
| M7: PostToolUse reminder hook | Done |
| M8: Skills (/fsm:create, /fsm:start, /fsm:current, /fsm:finish) | Done |
| M9: E2E testing framework (gen, verify, verifier.fsm.yaml) | Done |
