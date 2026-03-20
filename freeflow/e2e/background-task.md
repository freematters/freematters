# Test: Background bash task workflow

## Setup
- Workflow file: `e2e/background-task.fsm.yaml`

## Steps
1. **Start the workflow**: Start an embedded agent with `/freefsm:start e2e/background-task.fsm.yaml` and wait for it to complete
   - Expected: The agent runs a background bash task (`sleep 3 && date +%Y-%m-%d`), waits for it to finish, shows the date to the user, and reaches the terminal "done" state
2. **Verify output contains today's date**: Check the agent output for today's date in YYYY-MM-DD format
   - Expected: Output includes today's date (2026-03-19)

## Expected Outcomes
- The background bash task executes asynchronously
- The agent waits for the task completion notification before proceeding
- Today's date appears in the output
- The workflow completes through run_task -> show_result -> done

## Cleanup
- None required
