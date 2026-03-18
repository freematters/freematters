# Summary: Embedded E2E Verification for freefsm

## Project Overview

Replace the generic `freefsm e2e verify` with a specialized implementation that runs `freefsm run` as an embedded agent inside the verifier process. The verifier agent communicates with the embedded agent through a promise-based message bus, enabling it to detect `request_input` prompts and provide autonomous input based on test plan context. This solves the inability to test interactive `freefsm run` workflows requiring multi-turn user input.

## Artifacts

| File | Description |
|------|-------------|
| `specs/freefsm-verify-e2e/rough-idea.md` | Original user input |
| `specs/freefsm-verify-e2e/requirements.md` | 9 Q&A rounds capturing design decisions |
| `specs/freefsm-verify-e2e/design.md` | Authoritative spec: architecture, components, data models, acceptance criteria |
| `specs/freefsm-verify-e2e/plan.md` | 6-step incremental implementation plan |
| `specs/freefsm-verify-e2e/summary.md` | This summary |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Embedded agent** (in-process, not subprocess) | Avoids fragile stdio piping; direct message bus is simpler and more reliable |
| **Promise-based MessageBus** | Node.js native async/await; `request_input` blocks on a Promise that `resolveInput` fulfills |
| **Blocking `wait(timeout)` tool** | Verifier agent is MCP tool-driven; blocking tool returns when action is needed, no polling |
| **Autonomous input from test plan** | Verifier derives input from test steps/goal, not from reading the workflow source |
| **Minimal observability** (what a human sees) | `wait()` returns assistant text and `request_input` prompts only; store files available post-run for deeper inspection |
| **Color-coded + indented logging** | Three streams (`[embedded]` cyan indented, `[verifier]` green, `[input]` magenta) visually distinguishable on stderr |
| **Replace existing verify** | One approach is simpler to maintain; same CLI interface preserved |
| **Test plan format unchanged** | `Setup/Steps/Expected Outcomes/Cleanup`; workflow path inferred from Setup section |

## Next Steps

1. Run `/spec-to-code` on `specs/freefsm-verify-e2e/` to implement the plan
2. Start with Step 1 (MessageBus) — standalone module, no dependencies
3. Core E2E flow is available by Step 3 (verifier tools wired up)
