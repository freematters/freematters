# E2E Test Plan: fflow Gateway

## Overview

This test plan verifies the fflow Gateway feature works end-to-end, from CLI client through Gateway to Agent Daemon and back.

## Setup

```bash
# Terminal 1: Start Gateway
fflow gateway --port 8080 --api-key test-key

# Terminal 2: Start Daemon
fflow daemon --gateway ws://localhost:8080/ws/daemon --api-key test-key

# Terminal 3: Run tests
export FFLOW_GATEWAY=http://localhost:8080
export FFLOW_API_KEY=test-key
```

## Test Scenarios

### Scenario 1: Basic Remote Workflow Execution

**Goal**: Verify that a workflow can be executed remotely through the Gateway.

**Steps**:
1. User runs `fflow run spec-gen --gateway http://localhost:8080 --api-key test-key`
2. **Verify**: CLI shows "Connected to gateway"
3. **Verify**: CLI shows "Creating run..."
4. **Verify**: CLI shows initial state card (same format as local)
5. User sees prompt asking for idea description
6. User types "Build a todo app"
7. **Verify**: Agent processes input and shows next state
8. User continues interacting until workflow completes
9. **Verify**: CLI shows "Workflow completed"
10. **Verify**: Gateway shows run in completed state via `fflow list --gateway`

### Scenario 2: Reconnection After Disconnect

**Goal**: Verify that clients can reconnect and continue after disconnection.

**Steps**:
1. User starts a workflow via Gateway
2. User presses Ctrl+C (disconnect)
3. **Verify**: Workflow continues running on server (check via Gateway API)
4. User runs `fflow attach <run-id> --gateway http://localhost:8080`
5. **Verify**: CLI shows buffered output since disconnect
6. **Verify**: User can continue interacting with workflow

### Scenario 3: Multiple Concurrent Workflows

**Goal**: Verify Gateway handles multiple workflows concurrently.

**Steps**:
1. Start workflow A in terminal 1
2. Start workflow B in terminal 2
3. **Verify**: Both workflows receive their respective outputs
4. Interact with workflow A
5. **Verify**: Workflow B is not affected
6. Complete both workflows
7. **Verify**: Both show as completed in Gateway

### Scenario 4: Authentication Failure

**Goal**: Verify Gateway rejects invalid API keys.

**Steps**:
1. User runs `fflow run spec-gen --gateway http://localhost:8080 --api-key wrong-key`
2. **Verify**: CLI shows "Authentication failed: Invalid API key"
3. **Verify**: No run is created in Gateway

### Scenario 5: Daemon Unavailable

**Goal**: Verify Gateway handles daemon unavailability gracefully.

**Steps**:
1. Stop the Daemon process
2. User runs `fflow run spec-gen --gateway http://localhost:8080`
3. **Verify**: CLI shows "Waiting for available daemon..."
4. Start Daemon again
5. **Verify**: Workflow starts automatically
6. **Verify**: User can interact normally

## Acceptance Criteria

- [ ] All 5 scenarios pass
- [ ] No error messages in Gateway logs during normal operation
- [ ] Reconnection works within 60 seconds of disconnect
- [ ] Concurrent workflows don't interfere with each other
