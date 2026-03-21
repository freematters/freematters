# Test: Simple workflow lifecycle

## Setup
- Ensure fflow CLI is built and available at `dist/cli.js`
- Create a temporary directory for run storage
- Create a minimal 2-state workflow YAML file (start -> done)

## Steps
1. **Start workflow**: Run `fflow start simple.workflow.yaml --run-id test-simple` to initialize a new run
   - Expected: Run initializes successfully in "start" state with exit code 0
2. **Check current state**: Run `fflow current --run-id test-simple` to verify initial state
   - Expected: Current state is "start" with valid state card output
3. **Transition to done**: Run `fflow goto done --run-id test-simple --on "next"` to transition
   - Expected: State transitions to "done" with exit code 0
4. **Verify final state**: Run `fflow current --run-id test-simple` to confirm final state
   - Expected: Current state is "done"

## Expected Outcomes
- Workflow starts in the initial state defined in the workflow YAML
- Transition from start to done completes without error
- Current state reflects each transition accurately
- The full start -> goto -> done lifecycle works end-to-end

## Cleanup
- Remove the temporary run storage directory
- Remove the temporary workflow YAML file
