# FreeFlow

Monorepo for FreeFlow — agent-native developer tools.

## Packages

| Package | Description |
|---------|-------------|
| [freeflow](packages/freeflow/) | CLI-first workflow runtime for agent workflows |

## Local Commands

| Command | Expands to |
|---------|------------|
| `/spec-gen` | `/fflow spec-gen` |
| `/spec-to-code` | `/fflow spec-to-code` |
| `/pr` | `/fflow pr-lifecycle` |
| `/release` | `/fflow release` |
| `/idea-to-pr` | `/fflow idea-to-pr` |

## Build & Test

```bash
npm install           # install all workspaces
npm run build         # build all packages
npm test              # test all packages
npm run check         # biome lint/format
```

## Development

- Always use the local build (`node packages/freeflow/dist/cli.js`) instead of the globally installed `fflow` when developing. The global binary points to the main repo and may not reflect worktree changes. Run `npm run build` in `packages/freeflow/` first.

## Conventions

- Each package is self-contained under `packages/` with its own build, test, and lint setup
- Package-level `AGENTS.md` (symlinked as `CLAUDE.md`) contains package-specific instructions
- Shared configs (`tsconfig.base.json`, `biome.json`) live at repo root
- No cross-package imports — packages communicate via CLI or file protocols only
