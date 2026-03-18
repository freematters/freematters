# Test: freefsm run stops for user input

## Setup
- Workflow: tests/qa.fsm.yaml
- Confirm the workflow file exists at `tests/qa.fsm.yaml` in the repo root

## Steps
1. **Start embedded run**: Start the embedded freefsm run with `tests/qa.fsm.yaml`
   - Expected: The embedded run starts successfully, returning a run_id and store_root

2. **Wait for first input request**: Wait for the embedded agent to request input
   - Expected: The agent reaches the `ask-name` state and calls `request_input` with a prompt asking for the user's name

3. **Provide name input**: Send "Alice" as input when the agent asks for a name
   - Expected: The agent accepts the input and continues processing, transitioning to the next state

4. **Wait for second input request**: Wait for the embedded agent to request input again
   - Expected: The agent reaches the `ask-hobby` state and calls `request_input` with a prompt asking for a hobby

5. **Provide hobby input**: Send "painting" as input when the agent asks for a hobby
   - Expected: The agent accepts the input and continues processing

6. **Wait for completion**: Wait for the embedded agent to finish
   - Expected: The agent transitions through `summarize` → `done`, produces a summary that mentions "Alice" and "painting", and exits with code 0

7. **Verify state transitions**: Read the store's `events.jsonl` at the store_root to verify state progression
   - Expected: States visited in order are `ask-name` → `ask-hobby` → `summarize` → `done`; no state is skipped

## Expected Outcomes
- The embedded agent correctly pauses at each `request_input` call and does not advance until input is provided via `send_input`
- User-provided input ("Alice", "painting") is incorporated into the agent's responses
- The workflow runs to completion (terminal `done` state) when all required inputs are supplied
- State transitions follow the expected order without skipping

## Cleanup
- No cleanup needed — embedded runs use temporary store directories
