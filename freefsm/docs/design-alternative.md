# FreeFSM Design Alternative

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
| Target platform        | Claude Code (v0), general-purpose later  | Hooks are essential for enforcement; Codex lacks hooks                     |
| Architecture           | CLI + Hooks                              | Simple, debuggable, no MCP overhead                                        |
| Language               | TypeScript                               | npm distribution, Claude Code plugin ecosystem, hooks script compatibility |
| State persistence      | JSONL + run_id (event sourcing)          | Append-only, audit trail, multi-run support                                |
| Todos                  | Soft constraint (warn, don't block)      | Hard enforcement deferred to future `strict: true` flag                    |
| Transitions            | Hard constraint                          | Illegal transitions rejected by PreToolUse hook before CLI execution       |
| Hook reminder interval | Every 5 tool calls (PostToolUse)         | Fixed interval, configurable later                                         |
| Scope (v0)             | `init`, `current`, `goto`, `finish` only | No `todo`, `viz`, `log`, `compile`                                         |

## Architecture

```
+---------------------------------------------+
|              Claude Code Plugin              |
|                                              |
|  skills/              hooks/                 |
|  +-- draft/           +-- hooks.json         |
|  +-- run/                                    |
|  +-- finish/           PreToolUse:           |
|                         - fsm goto: validate |
|                           transition, reject |
|                           if illegal         |
|                                              |
|                        PostToolUse:           |
|                         - every 5 tool calls |
|                           inject state       |
|                           reminder           |
|                                              |
+----------------------------------------------+
|              fsm CLI (TypeScript)             |
|                                              |
|  fsm init <yaml>     load FSM, enter initial |
|  fsm current         query current state     |
|  fsm goto <state>    validate + transition   |
|  fsm finish          end run                 |
|                                              |
+----------------------------------------------+
|              .freefsm/                        |
|  events.jsonl    <- append-only event log     |
|  active_run      <- current run_id + yaml path|
|  hook_counter    <- PostToolUse call counter   |
+----------------------------------------------+
```

**Data flow:**

1. `/fsm:run workflow.yaml` -> skill instructs agent to call `fsm init`
2. `fsm init` -> writes init event to JSONL, outputs guide + initial state prompt
3. Agent works -> PostToolUse hook every 5 tool calls injects state reminder via `fsm current`
4. Agent calls `fsm goto X` -> PreToolUse hook validates transition legality; if legal, CLI executes, writes event, outputs new state info
5. `/fsm:finish` -> outputs run summary

## FSM YAML Schema

```yaml
# guide: initial instructions for the agent entering the FSM
guide: |
  You are in an FSM workflow.
  Use fsm goto <State> --on "<condition>" to transition.
  Use fsm current to check current state.

# initial: must be a key in states
initial: Plan

# states: state definitions
states:
  Plan:
    prompt: |
      Understand requirements, break into subtasks, confirm with user before proceeding. Do not write code.
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
      no issues: Done
      has issues: Execute
      requirements misunderstood: Plan

  Done:
    prompt: |
      Output completion summary (features, test coverage, review conclusions).
    # No transitions = terminal state
```

**Schema rules:**

- `initial` must reference an existing state in `states`
- All transition target values must reference existing states in `states`
- State names must match `[A-Za-z_-][A-Za-z0-9_-]*` (no spaces)
- A state with no `transitions` (or empty) is a terminal state
- `prompt` is plain text, no template variables in v0
- `fsm init` validates the schema and rejects invalid YAML

## JSONL Event Log

**File:** `.freefsm/events.jsonl`

**Event types:**

```jsonl
{"run_id":"a1b2c3","type":"init","state":"Plan","yaml":"workflow.yaml","ts":1709100000}
{"run_id":"a1b2c3","type":"goto","from":"Plan","to":"Execute","on":"plan confirmed","ts":1709100120}
{"run_id":"a1b2c3","type":"goto","from":"Execute","to":"Test","on":"implementation complete","ts":1709100300}
{"run_id":"a1b2c3","type":"finish","state":"Done","ts":1709100500}
```

**Design decisions:**

- `run_id`: generated by `fsm init` (nanoid short ID) or provided via `--run-id` flag, shared by all events in a run
- `type`: only three values — `init`, `goto`, `finish`
- `on`: records which transition condition was used (explicitly provided via `--on` flag on `fsm goto`)
- Current state reconstruction: read last event with matching run_id, take `state` (init/finish) or `to` (goto)
- Multiple runs coexist in the same JSONL file, isolated by run_id
- After `fsm finish`, the run_id no longer accepts any operations

## CLI Commands

### `fsm init <yaml> [--run-id <id>]`

```
$ fsm init workflow.yaml
$ fsm init workflow.yaml --run-id my-session-1
```

```
OK FSM initialized (run_id: a1b2c3)

Guide:
  You are in an FSM workflow.
  Use fsm goto <State> to transition.
  Use fsm current to check current state.

State: Plan
  Understand requirements, break into subtasks, confirm with user.

Transitions:
  plan confirmed -> Execute
  requirements unclear -> Plan
```

- Generates run_id (nanoid), or uses the provided `--run-id` value
- Stores active run_id in `.freefsm/active_run` for hooks to reference
- Validates YAML schema (initial exists, transition targets exist, state names match `[A-Za-z_-][A-Za-z0-9_-]*`)
- Outputs guide + initial state prompt + transitions
- Rejects if an active run already exists; use `fsm init --force` to override a stale run

### `fsm current`

```
$ fsm current

State: Execute
  Implement according to plan. Do not run tests.

Transitions:
  implementation complete -> Test
  plan incorrect -> Plan
```

- Reconstructs current state from JSONL
- Outputs state prompt + transitions
- Errors if no active run

### `fsm goto <state> --on <condition>`

```
$ fsm goto Test --on "implementation complete"

OK Execute -> Test (on: implementation complete)

State: Test
  Verify implementation correctness. Do not modify implementation code.

Transitions:
  all passing -> Review
  failures exist -> Execute
```

- `--on` is required: explicitly specifies which transition condition is being taken
- Validates: the condition exists in current state's transitions AND points to the target state
- Writes goto event with `on` field
- Outputs new state info
- Errors with available transitions if illegal

### `fsm finish`

```
$ fsm finish

OK FSM finished (run_id: a1b2c3)
Final state: Done
Path: Plan -> Execute -> Test -> Review -> Done
```

- Writes finish event
- Outputs run summary (state path)
- Errors if no active run

**Common behavior:**

- Exit code 0 = success, non-zero = failure
- Errors to stderr, normal output to stdout

## Hooks

### hooks.json

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "fsm _hook pre-tool-use"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": ".*",
        "hooks": [
          {
            "type": "command",
            "command": "fsm _hook post-tool-use"
          }
        ]
      }
    ]
  }
}
```

Hook logic is implemented as hidden CLI subcommands (`fsm _hook pre-tool-use`, `fsm _hook post-tool-use`) rather than standalone scripts. This eliminates path resolution issues when the plugin is distributed via npm.

### PreToolUse: Reject Illegal Transitions

**Trigger:** Agent calls Bash with `fsm goto <state>`

**Logic:**

1. Read hook input JSON from stdin, extract `tool_input.command`
2. Regex match `fsm goto (\S+).*--on\s+"([^"]+)"`, extract target state and condition
3. If no active run (`.freefsm/active_run` missing) -> exit 0, pass through
4. Read JSONL to reconstruct current state
5. Read YAML to get current state's transitions
6. Validate: condition exists in transitions AND maps to target state
7. If invalid -> **exit non-zero, stderr:**

```
ERR illegal transition: Plan -> Review
Current state: Plan
Available transitions:
  plan confirmed -> Execute
  requirements unclear -> Plan
```

8. If valid -> exit 0, allow execution

**Non-`fsm goto` Bash commands pass through unconditionally.**

### PostToolUse: Periodic State Reminder

**Trigger:** Any tool call completion

**Logic:**

1. Read counter file `.freefsm/hook_counter` (init to 0 if missing)
2. Increment counter, write back
3. If `count % 5 !== 0` -> exit, no output
4. If `count % 5 === 0` -> read JSONL + YAML internally (shared library code), write to stdout as prompt injection:

```
FSM State Reminder
State: Execute
  Implement according to plan. Do not run tests.
Transitions:
  implementation complete -> Test
  plan incorrect -> Plan
```

**Design decisions:**

- Counter uses a separate file (not JSONL) — it's hook-internal state, not an FSM event
- `fsm init` resets the counter, `fsm finish` cleans it up
- PostToolUse matcher uses `.*` to match all tools for accurate counting

## Skills

### `/fsm:draft <path>`

Interactively draft an FSM workflow YAML file through conversation. Lowers the barrier — users describe workflows in natural language, agent generates the YAML.

**SKILL.md:**

```markdown
---
name: draft
description: Interactively draft an FSM workflow YAML file through conversation.
---

User wants to create an FSM workflow file: $ARGUMENTS

1. Ask the user about the workflow's goal and main steps
2. Generate an FSM yaml draft based on the conversation
3. Present to user for review
4. Modify based on feedback until user confirms
5. Write to file

Output yaml must follow FreeFSM schema:

- guide: initial instructions for the agent
- initial: initial state name
- states: each state has prompt and transitions
```

Does not depend on `fsm` CLI. Pure conversation, agent writes yaml via Write tool.

### `/fsm:run <path>`

Start an FSM workflow. Calls `fsm init` and guides the agent into the state machine.

**SKILL.md:**

```markdown
---
name: run
description: Start running an FSM workflow. Initializes the FSM and guides agent behavior.
---

Start FSM workflow: $ARGUMENTS

1. Call `fsm init $ARGUMENTS` to initialize the state machine
2. Follow the guide output by fsm init
3. Work according to the current state's prompt
4. When current state work is done, use `fsm goto <State> --on "<condition>"` to transition
5. After reaching a terminal state, call `fsm finish`
```

Hooks are not installed by the skill. They are statically declared in the plugin's `hooks/hooks.json` and always active. When no active run exists (before `fsm init`), hooks detect this and pass through without action.

### `/fsm:finish`

End the current FSM run and output a summary.

**SKILL.md:**

```markdown
---
name: finish
description: Finish the current FSM workflow run.
---

End the current FSM workflow.

1. Call `fsm finish`
2. Present the run summary to the user
```

### Skills design decisions

- **Hooks are always mounted, activated on demand** — no dynamic install/uninstall of hooks. Hooks check for an active run and no-op if none exists. Simplifies implementation, avoids runtime modification of hooks.json.
- **`/fsm:draft` does not depend on CLI** — pure conversation to generate yaml
- **`/fsm:run` is a prompt wrapper** — translates `fsm init` output into agent behavioral instructions

## Plugin Structure

```
freefsm/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── draft/
│   │   └── SKILL.md
│   ├── run/
│   │   └── SKILL.md
│   └── finish/
│       └── SKILL.md
├── hooks/
│   └── hooks.json
├── bin/
│   └── fsm
├── src/
│   ├── cli.ts                 # CLI command routing
│   ├── commands/
│   │   ├── init.ts
│   │   ├── current.ts
│   │   ├── goto.ts
│   │   └── finish.ts
│   ├── hooks/
│   │   ├── pre-tool-use.ts
│   │   └── post-tool-use.ts
│   ├── fsm.ts                 # core FSM logic (load yaml, validate, transition)
│   └── store.ts               # JSONL read/write
├── package.json
└── tsconfig.json
```

### plugin.json

```json
{
  "name": "freefsm",
  "description": "FSM-based agent workflow control for Claude Code",
  "version": "0.1.0",
  "author": {
    "name": "freefsm"
  }
}
```

### Distribution

- **Development:** `claude --plugin-dir ./freefsm` for local testing
- **npm publish:** `npm i -g freefsm` installs the CLI globally, then Claude Code `/plugin install` for plugin features
- Hook commands use `fsm _hook pre-tool-use` / `fsm _hook post-tool-use` (hidden CLI subcommands), so no path resolution issues after npm install

## Future Work (TBD)

- Codex support (orchestrator mode — FSM as outer loop calling agent)
- `strict: true` for hard todo enforcement
- `vars` for state-scoped variables
- `fsm todo done <idx>` for explicit todo tracking
- `fsm viz` for state graph visualization
- `fsm log` for event history viewing
- `fsm compile` for markdown-to-yaml conversion
- Configurable hook reminder interval per state
