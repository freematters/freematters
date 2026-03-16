# Implementation Summary: `freefsm run`

## Overview

Added a `freefsm run <workflow.fsm.yaml>` command that launches a Claude Agent SDK session to autonomously execute FSM workflows. The agent receives state instructions via in-process MCP tools (`fsm_goto`, `fsm_current`) and can request human input via a `request_input` tool that reads from stdin. Workflow authors can optionally restrict the agent's tool access via an `allowed_tools` field in the YAML schema.

## Steps Completed

| Step | Title | Commit |
|------|-------|--------|
| 1 | Add dependencies (@anthropic-ai/claude-agent-sdk, zod) | `9255fc8` |
| 2 | Implement run command with minimal agent loop | `11a2eb4` |
| 3 | Add FSM MCP tools (fsm_goto, fsm_current) | `8d0abaa` |
| 4 | Add request_input MCP tool (stdin-based) | `ee543dd` |
| 5 | Add allowed_tools YAML schema extension | `8d209e2` |
| 6 | Integration testing and cleanup | `ed1c407` |
| fix | Address review issues (round 1) | `8254338` |

## Test Summary

- **127 tests** total (41 new across 5 test files)
- All passing, zero regressions
- Build (`tsc`) and lint (`biome check`) clean
- Coverage: unit tests for all tool handlers, system prompt construction, schema validation; integration tests for full workflow execution with Store artifact verification

## Files Created/Modified

| File | Description |
|------|-------------|
| `freefsm/src/commands/run.ts` | New — run command with Agent SDK session, MCP server, and all tool handlers |
| `freefsm/src/cli.ts` | Modified — registered `run` subcommand |
| `freefsm/src/fsm.ts` | Modified — added `allowed_tools?: string[]` to Fsm interface + validation |
| `freefsm/src/__tests__/run.test.ts` | New — 9 unit tests for run command initialization |
| `freefsm/src/__tests__/mcp-tools.test.ts` | New — 12 unit tests for fsm_goto and fsm_current |
| `freefsm/src/__tests__/request-input.test.ts` | New — 5 unit tests for request_input |
| `freefsm/src/__tests__/run-integration.test.ts` | New — 10 integration tests for end-to-end workflow |
| `freefsm/package.json` | Modified — added dependencies |

## How to Run

```bash
# Build
cd freefsm && npm run build

# Run tests
npm test

# Execute a workflow
freefsm run workflows/pdd.fsm.yaml
freefsm run workflows/pdd.fsm.yaml --run-id my-custom-id
```

## Remaining Work

- **Manual testing**: Run with a real FSM YAML and live Agent SDK to verify agent follows state instructions correctly
- **Known limitations**: `request_input` creates a new readline per call (fine for v1 sequential use); no cost/turn limits; no session resume across process restarts
- **Future enhancements** (out of scope for v1): MCP elicitation support, per-state allowed tools, `maxTurns`/`maxBudgetUsd` limits
