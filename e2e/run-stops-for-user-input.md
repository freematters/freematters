# Test: freefsm run stops for user input

Verify that `freefsm run` correctly pauses at each `request_input` call, accepts user input,
incorporates it into the agent's responses, and completes the workflow.

## Background

The `tests/qa.fsm.yaml` workflow is a simple Q&A workflow with 4 states:
- **ask-name**: The agent asks the user for their name via `request_input`
- **ask-hobby**: The agent asks the user for their favorite hobby via `request_input`
- **summarize**: The agent produces a summary mentioning the user's name and hobby
- **done**: Terminal state

The agent transitions through these states in order. At each `request_input` state,
the embedded agent calls the `request_input` MCP tool, which surfaces as an
`awaiting_input` event to the verifier. The verifier must provide input via `send_input`
for the agent to continue.

Key behavior to verify: the agent does NOT skip `request_input` calls or advance
to the next state without receiving input.

## Setup
- Workflow: tests/qa.fsm.yaml
- Confirm the workflow file exists at `tests/qa.fsm.yaml` in the repo root

## Steps
1. **Start embedded run**: Start the embedded freefsm run with `/freefsm:start tests/qa.fsm.yaml`
   - Expected: The embedded run starts successfully, returning a run_id and store_root

2. **Wait for name prompt**: Wait for the embedded agent to request input
   - Expected: The agent reaches `ask-name` and calls `request_input` with a prompt asking for the user's name (e.g., "What is your name?")

3. **Provide name**: Send "Alice" as input
   - Expected: The agent accepts the input and transitions to the next state

4. **Wait for hobby prompt**: Wait for the embedded agent to request input again
   - Expected: The agent reaches `ask-hobby` and calls `request_input` with a prompt asking for a hobby (e.g., "What is your favorite hobby?")

5. **Provide hobby**: Send "painting" as input
   - Expected: The agent accepts the input and transitions to `summarize`

6. **Wait for completion**: Wait for the embedded agent to finish
   - Expected: The agent produces a summary that mentions "Alice" and "painting", transitions to `done`, and exits with code 0

## Expected Outcomes
- The embedded agent correctly pauses at each `request_input` call and does not advance until input is provided
- User-provided input ("Alice", "painting") is incorporated into the agent's summary
- The workflow runs to completion (terminal `done` state) when all required inputs are supplied
- State transitions follow the expected order without skipping

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Initial startup + first output | 60s |
| Each `request_input` prompt | 60s |
| Post-input processing + state transition | 60s |
| Final summary + completion | 120s |

Note: The agent makes Claude API calls at each state, so allow at least 60s per wait.

## Cleanup
- No cleanup needed — embedded runs use temporary store directories
