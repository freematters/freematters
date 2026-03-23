## Implementation Summary

### Overview
Added a prominent warning to the `/fflow` skill file (`packages/freeflow/skills/fflow/SKILL.md`) instructing agents to never truncate output from `fflow start`, `fflow goto`, or `fflow current` commands, preventing critical workflow instructions from being missed due to Claude Code's tool output tailing behavior.

### Steps completed

| Step | Description | Status | Commit |
|------|-------------|--------|--------|
| 1 | Implement the feature | Done | 726f94a |
| 2 | E2E test | Skipped (not required) | — |

### Test summary
No automated tests — this is a prompt-level change to a skill markdown file. Manual verification required.

### Files created/modified
- `packages/freeflow/skills/fflow/SKILL.md` — Added 4-line blockquote warning in section 5 ("Flow CLI output")

### How to run
No build or test needed. The change takes effect the next time an agent loads the `/fflow` skill.

### Remaining work
- Manual verification: run a workflow with long state cards and confirm the agent reads the full output
