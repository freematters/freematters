# FreeFSM Design Primary (v1)

This is the primary design document for FreeFSM v1.

## 1) Overview

FreeFSM is a CLI-first FSM runtime for agent workflows.

It combines:

- structured workflow control (FSM YAML)
- flexible in-state reasoning (LLM)

v1 command scope:

- `start`
- `current`
- `goto`
- `finish`

v1 non-goals:

- history/viz commands
- recovery/resume details
- nested/parallel FSM

---

## 2) High-Level Architecture

```text
Agent/Host Integration
    ├── Slash/Skill adapter (/fsm:create, /fsm:start, /fsm:current, /fsm:finish)
    └── freefsm CLI (human-readable default, optional `-j` JSON)
            ├── Runtime (lifecycle + transition validation)
            └── Storage (events + snapshot)
```

Design principles:

- deterministic transition validation
- stable machine-readable contracts (`-j/--json`)
- minimal v1 surface area
- runtime is authoritative; guidance comes from command output and error messages

---

## 3) Runtime Spec

## 3.1 FSM Schema

Top-level required fields:

- `version: 1`
- `guide: string`
- `initial: string`
- `states: object` (non-empty)

State definition (`states.<name>`):

- `prompt: string` (required)
- `todos: string[]` (optional, soft constraint only in v1)
- `transitions: {label: target_state}` (required)

State names must match `[A-Za-z_-][A-Za-z0-9_-]*` (no spaces).

Validation rules:

- `initial` must exist in `states`
- terminal state is fixed as `states.done` and must exist
- transition targets must exist in `states`
- `transitions` can be empty only for `states.done`
- all states except `done` must have non-empty `transitions`
- transition labels must be non-empty strings
- state names must match `[A-Za-z_-][A-Za-z0-9_-]*`
- todo items must be non-empty strings and unique

Schema failures return `SCHEMA_INVALID`.

## 3.2 Run Lifecycle

`run_status`:

- `active`
- `completed`
- `aborted`

Transitions:

- `active -> completed`: only when `goto done`
- `active -> aborted`: only via `finish`
- `completed/aborted`: terminal

`finish` is abort-only in v1.

## 3.3 CLI Contracts

All commands support `-j/--json`, but default output is human-readable (without `-j`).

When `-j` is used, output follows this JSON envelope:

```json
{
  "ok": true,
  "code": null,
  "message": "string",
  "data": {}
}
```

### `current`

```bash
freefsm current --run-id <run_id> [-j]
```

Human-readable (default) fields:

- `state`
- `prompt`
- `todos`
- `transitions`

JSON (`-j`) additionally includes internal fields:

- `run_id`
- `run_status`

### `start`

```bash
freefsm start <fsm_path> [--run-id <run_id>] [-j]
```

- `--run-id` is optional; if omitted, a short ID is auto-generated (nanoid)
- the resolved `run_id` is always included in output

Success `data` (command-specific):

- `run_id` (resolved/generated run id)
- `state` (initial)
- `prompt`
- `todos`
- `transitions`
- `run_status` (JSON mode)

### `goto`

```bash
freefsm goto <target_state> --run-id <run_id> --on <transition_label> [-j]
```

Success `data` (command-specific):

- `state` (new state after transition)
- `prompt`
- `todos`
- `transitions`
- `run_status` (JSON mode)
- `completion_reason` (JSON mode, only when target is `done`)

If `target_state == "done"`:

- `run_status=completed`
- `completion_reason=done_auto`

### `finish`

```bash
freefsm finish --run-id <run_id> [-j]
```

Human-readable success:

- terminal summary only (no `run_id` / `run_status`)

JSON (`-j`) success `data` includes:

- `run_id`
- `run_status=aborted`
- `completion_reason=manual_abort`

## 3.4 Validation Order & Error Precedence

First failing rule wins.

### `start`

1. CLI args valid
2. schema valid
3. run_id not already initialized (if auto-generated, guaranteed unique)

### `current`

1. CLI args valid
2. run exists

### `goto`

1. CLI args valid
2. run exists
3. run is active
4. target state exists
5. exact transition match: `states[state].transitions[on] == target`

For `INVALID_TRANSITION`:

- stderr must include failure reason and available transitions
- if `-j` is used, include:

```json
{
  "state": "<state>",
  "allowed_transitions": { "label": "target" }
}
```

### `finish`

1. CLI args valid
2. run exists
3. run is active

## 3.5 Error Handling

Exit codes:

- `0` success
- `2` failure (unified)

Failure reason:

- stderr should be human-readable and concise.
- no strict stderr format is required in v1.

`-j` mode may still expose structured `code` and `data`, but default integration path should not require JSON.

## 3.6 Todo Policy (v1)

- todos are soft constraints
- they do not block `goto`
- they are included in command outputs (`start`, `current`, `goto`)

---

## 4) Integration Spec

Public commands:

- `/fsm:create [PATH]`
- `/fsm:start PATH`
- `/fsm:current`
- `/fsm:finish`

Internal:

- `goto` is not exposed as slash command in v1
- transitions are driven by agent/runtime via CLI/tooling

### `/fsm:create [PATH]`

- enters guided Q&A mode to create a workflow
- user describes goals, phases, and constraints in natural language
- agent synthesizes schema-compliant YAML (`version`, `guide`, `initial`, `states`)
- if `PATH` is provided, save there; otherwise choose a default path and return it
- validate schema before finalizing output
- does not depend on `freefsm` CLI; pure conversation, agent writes YAML via Write tool

### `/fsm:start PATH`

- skill generates a descriptive slug as `run_id` (e.g. `plan-execute-auth`, derived from FSM filename or workflow purpose)
- runs: `freefsm start <PATH> --run-id <slug>`
- on success, emit full state card:
  - `state`, `prompt`, `todos`, `transitions`

### `/fsm:current`

- runs: `freefsm current --run-id <run_id>`
- returns `current` output (human-readable):
  - `state`, `prompt`, `todos`, `transitions`
- if host uses `-j`, internal fields `run_id`/`run_status` are also available

### `/fsm:finish`

- runs: `freefsm finish --run-id <run_id>`
- returns terminal summary (human-readable)
- if host uses `-j`, includes `run_status=aborted` and `completion_reason=manual_abort`

Normal completion path remains: `goto done`.

Guidance model:

- agent guidance relies on CLI command output and concise error messages
- `current` provides the full state card (`state`, `prompt`, `todos`, `transitions`)
- invalid transitions are guided by `goto` error output (including `allowed_transitions` in `-j` mode)
- keep one hook in v1: periodic PostToolUse reminder every 5 tool turns

PostToolUse reminder hook (v1):

- trigger: every 5 tool turns
- action: inject concise FSM reminder from current run snapshot + FSM definition
- reminder content: `state`, `prompt` (optional short), `transitions`
- no PreToolUse validation hook in v1

Todo reminder fixed line (shown in current/start/goto outputs when todos exist):
`You MUST create a task for each of these items and complete them in order:`

Consistency rules:

- runtime CLI is authoritative
- PostToolUse reminder hook is guidance-only (not enforcement)
- default integration path uses human-readable mode; `-j` is optional when structured parsing is required

---

## 5) Storage Spec

## 5.1 Goals

- deterministic state transitions for `start/current/goto/finish`
- append-only audit trail
- fast `current` reads
- safe concurrent CLI calls for same `run_id`

## 5.2 Storage Strategy

- event log (source of truth): append-only JSONL
- snapshot (read optimization): latest runtime state

(Recovery behavior is deferred in current scope.)

## 5.3 Directory Layout

Default storage root: `~/.freefsm/` (can be overridden via `--root` flag or `FREEFSM_ROOT` env var).

```text
~/.freefsm/
  runs/
    <run_id>/
      fsm.meta.json
      events.jsonl
      snapshot.json
      lock
```

## 5.4 Data Contracts

### `fsm.meta.json`

```json
{
  "run_id": "projA-thread123-plan-execute",
  "fsm_path": "./workflows/plan-execute.fsm.yaml",
  "created_at": "2026-02-28T09:00:00+08:00",
  "version": 1
}
```

### `events.jsonl` event record

Required fields:

- `seq` (strictly increasing per run)
- `ts`
- `run_id`
- `event` (`start|goto|finish`)
- `from_state`
- `to_state`
- `on_label`
- `actor` (`agent|human|system`)
- `reason`
- `metadata`

### `snapshot.json`

```json
{
  "run_id": "projA-thread123-plan-execute",
  "run_status": "active",
  "state": "Execute",
  "last_seq": 2,
  "updated_at": "2026-02-28T09:10:22+08:00"
}
```

`run_status` values:

- `active`
- `completed`
- `aborted`

terminal `completion_reason`:

- `done_auto`
- `manual_abort`

## 5.5 Write Path

For state-changing operations (`start`, `goto`, `finish`):

1. acquire per-run lock
2. read snapshot
3. validate command
4. append event to `events.jsonl`
5. update `snapshot.json` (`last_seq`)
6. release lock

## 5.6 Read Path

`current`:

1. read snapshot
2. resolve state definition from FSM (`prompt`, `todos`, `transitions`)
3. return `current` command output (`state`, `prompt`, `todos`, `transitions`), with internal `run_id`/`run_status` included only in JSON mode

## 5.7 Concurrency

- lock granularity: per `run_id`
- lock type: file lock
- guarantees:
  - no duplicate seq
  - no interleaved writes for same run
  - consistent snapshot updates

## 5.8 Integration Notes

- entering `done` state => emit `finish` (`reason=done_auto`), set snapshot `run_status=completed`
- `freefsm finish` => emit `finish` (`reason=manual_abort`), set snapshot `run_status=aborted`
- todos remain advisory in v1

## 5.9 Minimal Test Matrix

- append event + snapshot update success path
- concurrent `goto` on same run => seq monotonic, no corruption
- todo soft constraint behavior visible in reminders/context
- terminal behavior:
  - `goto done` => `completed/done_auto`
  - `finish` => `aborted/manual_abort`

---

## 6) Implementation Structure

```text
freefsm/
├── skills/
│   ├── create/
│   │   └── SKILL.md
│   ├── start/
│   │   └── SKILL.md
│   ├── current/
│   │   └── SKILL.md
│   └── finish/
│       └── SKILL.md
├── hooks/
│   └── hooks.json             # PostToolUse only (every 5 turns)
├── bin/
│   └── freefsm
├── src/
│   ├── cli.ts                 # CLI command routing
│   ├── commands/
│   │   ├── start.ts
│   │   ├── current.ts
│   │   ├── goto.ts
│   │   └── finish.ts
│   ├── hooks/
│   │   └── post-tool-use.ts   # periodic reminder hook
│   ├── fsm.ts                 # core FSM logic (load yaml, validate, transition)
│   └── store.ts               # storage (events, snapshot, lock)
├── package.json
└── tsconfig.json
```

Language: TypeScript (npm distribution, Claude Code plugin ecosystem).

### Distribution

- Development: run CLI and skills in local workspace
- npm: `npm i -g freefsm` installs CLI globally

---

## 7) Document Map

- Primary design: `design-primary.md` (this file)
- Alternative design notes: `design-alternative.md`
