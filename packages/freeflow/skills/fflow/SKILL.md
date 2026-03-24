---
name: fflow
description: Use when the user wants to start or initialize a new workflow run. Runs `fflow start` with an auto-generated run ID and displays the initial state card.
---

# Start Workflow Run

Initialize a new workflow run from a workflow YAML file.

## Usage

`/fflow PATH` — where PATH is the workflow YAML file to run.

### Lite mode

If the user requests lite mode (e.g., `/fflow --lite PATH` or "start in lite mode"),
add `--lite` to the `fflow start` command. In lite mode, re-entered states show only
transitions and todos instead of the full prompt, reducing token cost. The agent can
call `fflow current` to retrieve full instructions when needed.

## Process

1. **Check for active run** — If there is a remembered `run_id` from a previous `/fflow` in this conversation, run `fflow current --run-id <run_id>`. If the current state is **not** `done`, prompt the user with question:
   - "You have an active workflow `<run_id>` in state `<state>`. Abort it and start a new one?"
   - Options: "Abort and start new" / "Keep it, start new anyway"
   - If the user chooses to abort, run `fflow finish --run-id <run_id>` first, then clean up pending/in-progress tasks (set to `deleted`).
   - If the state is `done` or the run doesn't exist, skip this step silently.

2. **Generate a descriptive run ID** (required) — Use the format `<workflow-name>-$(date '+%Y%m%d%H%M%S')` where workflow-name is derived from the workflow filename and $(date) is the bash command that outputs the current date in YYYY-MM-DD format (e.g., `code-review-2024-12-19`, `plan-execute-2024-12-19`). Use lowercase letters, numbers, and hyphens. You MUST always pass `--run-id`.

3. **Run the CLI command:**

```bash
fflow start <PATH> --run-id <workflow-name>-$(date) [--lite]
```

Never omit `--run-id`. The run ID is needed for all subsequent commands. PATH can be a workflow name (e.g. `spec-gen`) or a full path. The CLI resolves it automatically.

4. **Remember the run ID** — Store the `run_id` value for use in subsequent `fflow current --run-id <run-id>` and `fflow goto <state> --run-id <run-id> --on <transition-label>` calls within this conversation. The `run_id` will also be used in subsequent `fflow:current` and `fflow:finish` calls.

5. **Flow CLI output**

> **WARNING — DO NOT TRUNCATE CLI OUTPUT**
>
> `fflow start`, `fflow goto`, and `fflow current` output **state cards** that contain critical workflow instructions. You MUST read the **complete, untruncated** output of these commands. NEVER pipe them through `tail`, `head`, or any other tool that truncates output. NEVER use a line-limit or byte-limit on their output. Truncating the output will cause you to miss **guide rules**, **state instructions**, and **transition definitions**, which will lead to incorrect workflow execution.

`fflow start` will output the initial state card. `fflow goto` will output the new state card. if the target state is `done`, the workflow is completed.

The state card consists of instructions, todos and valid state transitions, follow the instructions and transition to the correct state based on the output of your actions.

**Execution model**: After every state transition, immediately execute the new state's instructions. You may summarize progress or report status, but do NOT stop between states. Keep driving the workflow forward until you reach a terminal state (a state with no transitions). Only a terminal state ends the workflow.

**Before ending a turn**: You MUST run `fflow current --run-id <run_id>` before ending your turn to check if there is remaining work in the current state. Only end your turn if the current state has no actionable work left or requires user input. This prevents accidentally dropping tasks mid-state.

If the exit code of any CLI is not 0, the cli will output the error message, follow the error message on right actions to take.

## Error Handling

- **`RUN_EXISTS`** — The generated run_id is already taken. Generate a different slug and retry.
- **`SCHEMA_INVALID`** — The YAML file has validation errors. Show the error message and suggest using `/fflow-author` to build a valid workflow.
