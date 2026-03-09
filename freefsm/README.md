# FreeFSM

CLI-first FSM runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code** and **Codex**.

## Install

```bash
npm i -g freefsm

# Claude Code — registers skills + PostToolUse hook
freefsm install claude

# Codex — links skills (no hook support)
freefsm install codex
```

## Usage

FreeFSM is typically used through these skills:

- `/freefsm:create` — guided Q&A to create a workflow YAML
- `/freefsm:start <path>` — start a workflow run (also searches `./workflows/` by name)
- `/freefsm:current` — show current state
- `/freefsm:finish` — abort an active run

Codex skill names use `$` instead of `/`.

## Bundled Workflows

- `pdd` — Plan-Driven Development: interactive requirements, research, design, and planning
- `spec-to-code` — implements a spec directory (from PDD) into working code via TDD
- `mr-lifecycle` — merge request lifecycle management

Start a bundled workflow by name:

```
/freefsm:start pdd
```

## License

MIT
