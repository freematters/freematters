# FreeFlow

Monorepo for FreeFlow — agent-native developer tools.

## Packages

| Package | Description |
|---------|-------------|
| [freeflow](packages/freeflow/) | CLI-first workflow runtime for agent workflows |

## Local Commands

| Command | Expands to |
|---------|------------|
| `/pdd` | `/fflow:start pdd` |
| `/spec-to-code` | `/fflow:start spec-to-code` |
| `/pr` | `/fflow:start pr-lifecycle` |
| `/release` | `/fflow:start release` |

## Build & Test

```bash
npm install           # install all workspaces
npm run build         # build all packages
npm test              # test all packages
npm run check         # biome lint/format
```

## Conventions

- Each package is self-contained under `packages/` with its own build, test, and lint setup
- Package-level `AGENTS.md` (symlinked as `CLAUDE.md`) contains package-specific instructions
- Shared configs (`tsconfig.base.json`, `biome.json`) live at repo root
- No cross-package imports — packages communicate via CLI or file protocols only
