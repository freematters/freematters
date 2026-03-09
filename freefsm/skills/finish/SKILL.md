---
name: freefsm:finish
description: Use when the user wants to abort or terminate an active FSM workflow run. Runs `freefsm finish` to set the run as aborted and display a terminal summary.
---

# Finish (Abort) FSM Run

Abort an active FSM run. This sets the run status to `aborted` with reason `manual_abort`.

For normal completion, use `freefsm goto done` instead — that happens automatically when the workflow reaches its terminal state.

## Usage

`/fsm:finish` — uses the run ID from the most recent `/fsm:start` in this conversation.

## Process

1. **Retrieve the run ID** — Use the `run_id` remembered from the previous `/fsm:start` call in this conversation.

2. **Run the CLI command:**

```bash
freefsm finish --run-id <run_id>
```

3. **Clean up tasks** — After aborting, delete all pending and in-progress tasks from the task list using `TaskList` and `TaskUpdate` (set status to `deleted`). These tasks were created by the workflow and are no longer relevant.

4. **Display the output** — The CLI prints:
   - The state where the run was aborted
   - Transition history chain showing the path taken
   - Number of tasks cleaned up

## Error Handling

- **`RUN_NOT_FOUND`** — The run doesn't exist. Check the run ID.
- **`RUN_NOT_ACTIVE`** — The run is already completed or aborted. No action needed.
- **No run_id in context** — Ask the user which run to abort.
