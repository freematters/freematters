# fflow Gateway — Summary

## Project Overview

fflow Gateway enables remote execution of fflow workflows through a three-tier architecture: CLI Client → Gateway Server → Agent Daemon. Users can run `fflow run --gateway <addr>` to execute workflows on a centralized server while maintaining the same interactive experience as local execution. The Gateway handles routing and state management while the Daemon manages agent sessions, supporting 10-20 concurrent workflows for small team use.

## Artifacts

| Artifact | Description |
|----------|-------------|
| `rough-idea.md` | Original user request for remote workflow execution |
| `requirements.md` | 7 Q&A items covering use cases, architecture, auth, storage, and testing |
| `research/01-fflow-architecture.md` | Analysis of current fflow Store/FSM/CLI architecture |
| `research/02-orchestration-patterns.md` | Survey of Temporal/Prefect/Airflow gateway patterns |
| `research/03-api-design.md` | REST/WebSocket/Unix Socket API comparison |
| `research/04-instance-management.md` | Multi-workflow lifecycle and isolation strategies |
| `design.md` | Full architecture with components, data models, and test cases |
| `plan.md` | 6-step implementation plan with dependencies and test requirements |
| `e2e.md` | 5 end-to-end test scenarios for acceptance testing |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Agent Daemon model | Decouples Gateway from agent runtime, allows flexible agent implementations |
| WebSocket for real-time | Mirrors local `fflow run` experience, enables bidirectional communication |
| API Key auth | Simple, sufficient for small team, can upgrade to JWT later |
| Shared storage by run_id | Reuses existing fflow Store, no additional infrastructure |
| 10-20 concurrent limit | Matches small team use case, single-machine deployment |

## Next Steps

1. **Run `/spec-to-code`** — Implement the 6 steps in plan.md
2. **Run `/pr`** — Create PR for review
3. **Deploy and test** — Set up Gateway + Daemon, run e2e tests
