# Test: Configure skill enables/disables hook via settings.json

## Setup
- Build fflow from source: `cd packages/freeflow && npm run build`
- Create a temporary directory for freeflow root: `FREEFLOW_ROOT=$(mktemp -d)`
- Ensure `$FREEFLOW_ROOT/settings.json` does NOT exist initially

## Steps
1. **Verify hook is disabled by default**: Run `node packages/freeflow/dist/cli.js _hook post-tool-use` with a valid PostToolUse JSON payload on stdin and `FREEFLOW_ROOT` set to the temp dir. The hook should produce no output (no reminder), confirming it's disabled by default.
   - Expected: No output on stdout (empty response), exit code 0

2. **Enable the hook via settings**: Write `{"hooks":{"postToolUse":true}}` to `$FREEFLOW_ROOT/settings.json`
   - Expected: File is created successfully

3. **Verify hook is now active**: Run the same `fflow _hook post-tool-use` command with a valid payload (including a session bound to an active run at counter=4 so it triggers a reminder).
   - Expected: stdout contains JSON with `hookSpecificOutput` and `additionalContext` fields (a reminder)

4. **Disable the hook via settings**: Update `$FREEFLOW_ROOT/settings.json` to `{"hooks":{"postToolUse":false}}`
   - Expected: File updated successfully

5. **Verify hook is disabled again**: Run the same hook command with the same payload setup.
   - Expected: No output on stdout (empty response), exit code 0

## Expected Outcomes
- When `settings.json` is absent, the hook produces no output (disabled by default)
- When `hooks.postToolUse` is `true`, the hook produces reminders as normal
- When `hooks.postToolUse` is `false`, the hook produces no output
- The settings file controls hook behavior without any code changes or restarts

## Cleanup
- Remove the temporary `FREEFLOW_ROOT` directory
