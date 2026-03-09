---
name: freefsm:start
description: Use when the user wants to start or initialize a new FSM workflow run. Runs `freefsm start` with an auto-generated run ID and displays the initial state card.
---

# Start FSM Run

Initialize a new FSM run from a workflow YAML file.

## Usage

`/freefsm:start PATH` — where PATH is the FSM YAML file to run.

## Process

1. **Check for active run** — If there is a remembered `run_id` from a previous `/freefsm:start` in this conversation, run `freefsm current --run-id <run_id>`. If the current state is **not** `done`, prompt the user with question:
   - "You have an active workflow `<run_id>` in state `<state>`. Abort it and start a new one?"
   - Options: "Abort and start new" / "Keep it, start new anyway"
   - If the user chooses to abort, run `freefsm finish --run-id <run_id>` first, then clean up pending/in-progress tasks (set to `deleted`).
   - If the state is `done` or the run doesn't exist, skip this step silently.

2. **Resolve the workflow path** — If PATH is not provided or is just a name (no `/` or `.yaml`), search for a matching file in `./workflows/` (e.g., `code-review` resolves to `./workflows/code-review.fsm.yaml`).

3. **Generate a descriptive run ID** (required) — Use the format `<fsm-name>-$(date '+%Y%m%d%H%M%S')` where fsm-name is derived from the workflow filename and $(date) is the bash command that outputs the current date in YYYY-MM-DD format (e.g., `code-review-2024-12-19`, `plan-execute-2024-12-19`). Use lowercase letters, numbers, and hyphens. You MUST always pass `--run-id`.

4. **Run the CLI command:**

```bash
freefsm start <PATH> --run-id <fsm-name>-$(date)
```

Never omit `--run-id`. The run ID is needed for all subsequent commands.

5. **Remember the run ID** — Store the `run_id` value for use in subsequent `freefsm current --run-id <run-id>` and `freefsm goto <state> --run-id <run-id> --on <transition-label>` calls within this conversation. The `run_id` will also be used in subsequent `freefsm:current` and `freefsm:finish` calls.

6. **Flow CLI output**

`freefsm start` will output the initial state card. `freefsm goto` will output the new state card. if the target state is `done`, the workflow is completed.

The state card consists of instructions, todos and valid state transitions, follow the instructions and transition to the correct state based on the output of your actions.

**Execution model**: After every state transition, immediately execute the new state's instructions. You may summarize progress or report status, but do NOT stop between states. Keep driving the workflow forward until you reach a terminal state (a state with no transitions). Only a terminal state ends the workflow.

If the exit code of any CLI is not 0, the cli will output the error message, follow the error message on right actions to take.

## Error Handling

- **`RUN_EXISTS`** — The generated run_id is already taken. Generate a different slug and retry.
- **`SCHEMA_INVALID`** — The YAML file has validation errors. Show the error message and suggest using `/freefsm:create` to build a valid workflow.
