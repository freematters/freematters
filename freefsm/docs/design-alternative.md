# FreeFSM Design

> FSM-based agent workflow plugin for Claude Code.
> Marries natural language flexibility with FSM determinism.

## Problem

Natural language prompts are not deterministic:

1. Cannot precisely describe workflows
2. Context pollution causes agents to drift from instructions
3. Hard constraints (MUST, ALWAYS, Red Flags) have no guarantee

Code is deterministic but rigid, hard to extend, and bug-prone.

**Solution:** Keep the agent loop as the main loop, but introduce an FSM abstraction to govern agent behavior. A pre-defined YAML file defines the workflow as a state machine. At each step, the agent is guided to the correct next state via CLI tool calls and hook-based prompt injection.

## Decisions

| Decision               | Choice                                   | Rationale                                                                  |
| ---------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| Target platform        | Claude Code (v1), Codex support added    | Hooks are essential for enforcement; Codex has limited hook support         |
| Architecture           | CLI + Hooks                              | Simple, debuggable, no MCP overhead                                        |
| Language               | TypeScript                               | npm distribution, Claude Code plugin ecosystem, hooks script compatibility |
| State persistence      | Event sourcing (JSONL + snapshot)         | Append-only audit trail, fast reads via snapshot                           |
| Todos                  | Soft constraint (warn, don't block)      | Hard enforcement deferred to future `strict: true` flag                    |
| Transitions            | Hard constraint (CLI rejects illegal)    | `goto` validates against FSM definition before committing                  |
| Hook reminder interval | Every 5 tool calls (PostToolUse)         | Fixed interval, configurable later                                         |
| Terminal state         | Fixed as `done`                          | Must exist in schema; `goto done` completes the run                        |
| Scope (v1)             | `start`, `current`, `goto`, `finish`     | No `todo`, `viz`, `log`, `compile`                                         |

## Architecture

```
+---------------------------------------------+
|              Claude Code Plugin              |
|                                              |
|  skills/              hooks/                 |
|  +-- create/          +-- hooks.json         |
|  +-- start/                                  |
|  +-- current/          PostToolUse:           |
|  +-- finish/            - every 5 tool calls |
|                           inject state       |
|                           reminder           |
|                                              |
+----------------------------------------------+
|              freefsm CLI (TypeScript)         |
|                                              |
|  freefsm start <yaml>   load FSM, enter     |
|                          initial state       |
|  freefsm current         query current state |
|  freefsm goto <state>    validate+transition |
|  freefsm finish          abort run           |
|                                              |
+----------------------------------------------+
|              ~/.freefsm/                      |
|  runs/<run_id>/                               |
|    fsm.meta.json  <- run metadata             |
|    events.jsonl   <- append-only event log    |
|    snapshot.json  <- current state snapshot    |
|    lock/          <- directory-based file lock |
|  sessions/                                    |
|    <session_id>.json     <- session->run bind |
|    <session_id>.counter  <- hook call counter  |
+----------------------------------------------+
```

**Data flow:**

1. `/freefsm:start workflow.yaml` -> skill instructs agent to call `freefsm start`
2. `freefsm start` -> writes start event, outputs guide + initial state card
3. Agent works -> PostToolUse hook every 5 tool calls injects state reminder via `freefsm current`
4. Agent calls `freefsm goto X --on "label"` -> CLI validates transition legality; if legal, writes event, outputs new state card
5. Agent reaches `done` state -> run completes (`run_status=completed`)
6. `/freefsm:finish` -> aborts an active run (`run_status=aborted`)

## Run Lifecycle

```
active -> completed   (goto done)
active -> aborted     (finish)
completed/aborted     terminal, no further operations
```

`finish` is abort-only. Normal completion is `goto done`.

## FSM YAML Schema

```yaml
version: 1

guide: |
  You are in an FSM workflow.
  Use freefsm goto <State> --on "<condition>" to transition.
  Use freefsm current to check current state.

initial: Plan

states:
  Plan:
    prompt: |
      Understand requirements, break into subtasks, confirm with user before proceeding. Do not write code.
    todos:
      - Review requirements document
      - Break into subtasks
    transitions:
      plan confirmed: Execute
      requirements unclear: Plan

  Execute:
    prompt: |
      Implement according to plan. Do not run tests.
    transitions:
      implementation complete: Test
      plan incorrect: Plan

  Test:
    prompt: |
      Verify implementation correctness. Do not modify implementation code.
    transitions:
      all passing: Review
      failures exist: Execute

  Review:
    prompt: |
      Review code quality, robustness, security.
    transitions:
      no issues: done
      has issues: Execute
      requirements misunderstood: Plan

  done:
    prompt: |
      Output completion summary (features, test coverage, review conclusions).
    transitions: {}
```

**Schema rules:**

- `version` must be `1`
- `guide` is optional; if provided, must be a non-empty string
- `initial` must reference an existing state in `states`
- `done` state must exist (terminal state)
- All transition target values must reference existing states
- State names must match `[A-Za-z_-][A-Za-z0-9_-]*`
- Non-`done` states must have at least one transition; `done` may have empty transitions
- `prompt` is required, plain text, no template variables
- `todos` is optional; items must be non-empty, unique strings (soft constraint only)
- `freefsm start` validates the schema and rejects invalid YAML (`SCHEMA_INVALID`)

## Storage

**Default root:** `~/.freefsm/` (override via `--root` flag or `FREEFSM_ROOT` env var).

### Data contracts

**`fsm.meta.json`** — run metadata:

```json
{
  "run_id": "plan-execute-auth",
  "fsm_path": "./workflows/plan-execute.fsm.yaml",
  "created_at": "2026-02-28T09:00:00.000Z",
  "version": 1
}
```

**`events.jsonl`** — append-only event log:

```jsonl
{"seq":1,"ts":"...","run_id":"a1b2c3","event":"start","from_state":null,"to_state":"Plan","on_label":null,"actor":"agent","reason":null,"metadata":null}
{"seq":2,"ts":"...","run_id":"a1b2c3","event":"goto","from_state":"Plan","to_state":"Execute","on_label":"plan confirmed","actor":"agent","reason":null,"metadata":null}
{"seq":3,"ts":"...","run_id":"a1b2c3","event":"goto","from_state":"Execute","to_state":"done","on_label":"implementation complete","actor":"agent","reason":null,"metadata":null}
```

**`snapshot.json`** — current state (read optimization):

```json
{
  "run_id": "a1b2c3",
  "run_status": "active",
  "state": "Execute",
  "last_seq": 2,
  "updated_at": "2026-02-28T09:10:22.000Z"
}
```

### Write path

For state-changing operations (`start`, `goto`, `finish`):

1. Acquire per-run directory lock (`lock/`)
2. Read `snapshot.json`
3. Validate command
4. Append event to `events.jsonl`
5. Update `snapshot.json` (`last_seq`)
6. Release lock

### Concurrency

- Lock granularity: per `run_id` (directory-based)
- Guarantees: no duplicate seq, no interleaved writes, consistent snapshot

## CLI Commands

### `freefsm start <yaml> [--run-id <id>] [-j]`

```
$ freefsm start workflow.yaml
OK FSM initialized (run_id: a1b2c3)

Guide:
  You are in an FSM workflow.
  Use freefsm goto <State> to transition.
  Use freefsm current to check current state.

State: Plan
  Understand requirements, break into subtasks, confirm with user.

Transitions:
  plan confirmed -> Execute
  requirements unclear -> Plan
```

- Generates `run_id` (nanoid), or uses provided `--run-id`
- Validates YAML schema
- Outputs guide + initial state card + transitions
- Rejects if `run_id` already exists (`RUN_EXISTS`)

### `freefsm current --run-id <id> [-j]`

```
$ freefsm current --run-id a1b2c3

State: Execute
  Implement according to plan. Do not run tests.

Transitions:
  implementation complete -> Test
  plan incorrect -> Plan
```

- Reads snapshot, resolves state definition
- Outputs state card (state, prompt, todos, transitions)
- Errors if run not found (`RUN_NOT_FOUND`)

### `freefsm goto <state> --run-id <id> --on <label> [-j]`

```
$ freefsm goto Test --run-id a1b2c3 --on "implementation complete"
OK Execute -> Test (on: implementation complete)

State: Test
  Verify implementation correctness. Do not modify implementation code.

Transitions:
  all passing -> Review
  failures exist -> Execute
```

- `--on` is required: specifies which transition label is being taken
- Validates: label exists in current state's transitions AND maps to target state
- If target is `done`: sets `run_status=completed`, `completion_reason=done_auto`
- Errors with available transitions if illegal (`INVALID_TRANSITION`)

### `freefsm finish --run-id <id> [-j]`

```
$ freefsm finish --run-id a1b2c3
OK FSM aborted (run_id: a1b2c3)
Final state: Execute
```

- Abort-only; sets `run_status=aborted`, `completion_reason=manual_abort`
- Errors if run not active (`RUN_NOT_ACTIVE`)

**Common behavior:**

- Exit code `0` = success, `2` = failure
- `-j/--json` wraps output in `{"ok":true,"code":null,"message":"...","data":{...}}`
- `--root <path>` overrides storage root
- Errors to stderr, normal output to stdout

**Error codes:** `SCHEMA_INVALID`, `RUN_EXISTS`, `RUN_NOT_FOUND`, `RUN_NOT_ACTIVE`, `STATE_NOT_FOUND`, `INVALID_TRANSITION`, `ARGS_INVALID`

## PostToolUse Hook

### hooks.json

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "freefsm _hook post-tool-use",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Hook logic is a hidden CLI subcommand (`freefsm _hook post-tool-use`), eliminating path resolution issues when distributed via npm.

### Logic

1. Resolve session ID from environment
2. Read counter from `sessions/<session_id>.counter` (init to 0 if missing)
3. Increment counter, write back
4. If `count % 5 !== 0` -> exit, no output
5. If `count % 5 === 0` -> read snapshot + FSM, output state reminder:

```
FSM State Reminder
State: Execute
  Implement according to plan. Do not run tests.
Transitions:
  implementation complete -> Test
  plan incorrect -> Plan
```

**Design decisions:**

- Counter lives in `sessions/` (not JSONL) — it's hook-internal state, not an FSM event
- Matcher uses `""` (matches all tools) for accurate counting
- No PreToolUse validation hook in v1; transitions are validated at CLI execution time

## Skills

### `/freefsm:create [PATH]`

Interactively create an FSM workflow YAML through conversation. User describes workflows in natural language, agent generates schema-compliant YAML.

Does not depend on `freefsm` CLI. Pure conversation, agent writes YAML via Write tool.

### `/freefsm:start PATH`

Start an FSM workflow run. Generates a descriptive slug as `run_id`, calls `freefsm start`, and guides the agent into the state machine.

### `/freefsm:current`

Show current FSM state. Calls `freefsm current` and displays the state card.

### `/freefsm:finish`

Abort the current FSM run. Calls `freefsm finish` and displays the terminal summary.

### Skills design decisions

- **Hooks are always mounted, activated on demand** — hooks check for an active session/run and no-op if none exists. No dynamic install/uninstall.
- **`/freefsm:create` does not depend on CLI** — pure conversation to generate YAML
- **`goto` is not a skill** — transitions are driven by agent via CLI, not exposed as slash commands

## Plugin Structure

```
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
│   └── hooks.json
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
│   ├── fsm.ts                 # core FSM logic (load yaml, validate)
│   ├── store.ts               # storage (events, snapshot, lock, sessions)
│   ├── errors.ts              # CliError + FsmError
│   └── output.ts              # formatStateCard() + jsonEnvelope()
├── package.json
└── tsconfig.json
```

### Distribution

- **npm:** `npm i -g freefsm` installs CLI globally
- Hook commands use `freefsm _hook post-tool-use` (hidden CLI subcommand), so no path resolution issues after npm install

## Future Work (TBD)

- `strict: true` for hard todo enforcement
- `vars` for state-scoped variables
- `freefsm viz` for state graph visualization
- `freefsm log` for event history viewing
- Configurable hook reminder interval per state
- PreToolUse validation hook (reject illegal transitions before CLI execution)
