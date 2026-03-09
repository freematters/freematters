---
name: freefsm:current
description: Use when the user wants to check the current FSM state, see available transitions, or review their workflow progress. Runs `freefsm current` and displays the state card.
---

# Show Current FSM State

Display the current state of an active FSM run.

## Usage

`/fsm:current` — uses the run ID from the most recent `/fsm:start` in this conversation.

## Process

1. **Retrieve the run ID** — Use the `run_id` remembered from the previous `/fsm:start` call in this conversation.

2. **Run the CLI command:**

```bash
freefsm current --run-id <run_id>
```

3. **Display the output** — The CLI prints the state card with:
   - Current state name
   - State prompt (instructions)
   - Todo items (if any)
   - Available transitions (label → target state)

## Error Handling

- **`RUN_NOT_FOUND`** — The run doesn't exist. The user may need to start a workflow first with `/fsm:start`.
- **No run_id in context** — Ask the user which run to query, or suggest `/fsm:start` to begin a new workflow.
