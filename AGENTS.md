# Freematters

Monorepo for agent-native developer tools — CLI tools designed as plugins for AI coding agents (Claude Code, Codex, etc.).

## Packages

| Package | Description | Language |
|---------|-------------|----------|
| [freefsm](freefsm/) | CLI-first FSM runtime for agent workflows | TypeScript |

## Local Commands

| Command | Expands to |
|---------|------------|
| `/pdd` | `/freefsm:start pdd` |
| `/spec-to-code` | `/freefsm:start spec-to-code` |
| `/pr` | `/freefsm:start pr-lifecycle` |
| `/release` | `/freefsm:start release` |

## Conventions

- Each package is self-contained with its own build, test, and lint setup
- Package-level `AGENTS.md` (symlinked as `CLAUDE.md`) contains package-specific instructions
- No cross-package imports — packages communicate via CLI or file protocols only
