# Test: Error handling for invalid transitions and missing states

## Setup
- Ensure fflow CLI is built and available at `dist/cli.js`
- Create a temporary directory for run storage
- Create a 2-state workflow YAML file (start -> done) with only one valid transition

## Steps
1. **Start workflow**: Run `fflow start simple.workflow.yaml --run-id test-errors` to initialize
   - Expected: Run initializes successfully in "start" state
2. **Invalid transition label**: Run `fflow goto done --run-id test-errors --on "nonexistent"` with a label that does not exist
   - Expected: Command exits with non-zero exit code and an INVALID_TRANSITION error
3. **Invalid target state**: Run `fflow goto nowhere --run-id test-errors --on "next"` targeting a state that does not exist
   - Expected: Command exits with non-zero exit code and an error indicating invalid transition or state not found
4. **Missing run ID**: Run `fflow current --run-id nonexistent-run` for a run that was never started
   - Expected: Command exits with non-zero exit code and a RUN_NOT_FOUND error
5. **Verify state unchanged after errors**: Run `fflow current --run-id test-errors` to confirm state was not corrupted
   - Expected: Current state is still "start" — failed transitions do not alter state

## Expected Outcomes
- Invalid transition labels are rejected with descriptive error messages
- Invalid target states are rejected with descriptive error messages
- Querying a nonexistent run produces a clear RUN_NOT_FOUND error
- Failed transitions do not corrupt the workflow state
- All error responses include appropriate error codes

## Cleanup
- Remove the temporary run storage directory
- Remove the temporary workflow YAML file
