# FreeMatters

Monorepo for FreeMatters — agent-native developer tools.

## Packages

| Package | Description |
|---------|-------------|
| [freeflow](packages/freeflow/) | CLI-first workflow runtime for agent workflows |
| [codoc](packages/codoc/) | Real-time collaborative markdown editing between AI agents and humans |

## Local Skills

| Skill | Description |
|-------|-------------|
| `spec-gen` | Generate a complete specification from a rough idea |
| `spec-to-code` | Implement a completed spec into working code |
| `pr-lifecycle` | Create and monitor a pull request until it is merged or closed |
| `release` | Run the release workflow |
| `spec-driven` | Run the end-to-end spec-to-implementation workflow |

## Build & Test

```bash
npm install           # install all workspaces
npm run build         # build all packages
npm test              # test all packages
npm run check         # biome lint/format
```

## Development

- Run `npm run fflow -- <args>` to build and run the local fflow CLI. This ensures you always test the development version, not the globally installed one.
- In worktrees, the global `fflow` binary points to the main repo. Always use `npm run fflow` instead.

## Conventions

- Each package is self-contained under `packages/` with its own build, test, and lint setup
- Package-level `AGENTS.md` (symlinked as `CLAUDE.md`) contains package-specific instructions
- Shared configs (`tsconfig.base.json`, `biome.json`) live at repo root
- No cross-package imports — packages communicate via CLI or file protocols only
