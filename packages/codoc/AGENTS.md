# codoc

Real-time collaborative markdown editing between AI agents and humans via structured HTML comments.

## Build & Test

```bash
npm install && cd frontend && npm install && cd ..
npm run build          # tsc backend + vite frontend
npx vitest run         # unit/integration tests
npx playwright test    # browser E2E tests
```

## Code Conventions

- ESM (`"type": "module"`), strict TypeScript
- No default parameters in functions — always explicit
- Backend: `src/` → `dist/`, Frontend: `frontend/src/` → `dist/static/`
- Shared code: `@shared` alias resolves to `src/` (frontend imports backend modules)
- vitest for tests, Playwright for browser E2E

## Plugin Install

```bash
npm link
codoc install claude   # generates hooks.json with absolute paths, registers plugin
```

Server is auto-stopped by SessionEnd hook (ref-counted across sessions). Start the server manually with `codoc server`.

## Config

`~/.codoc/config.json` must be created manually before first use. `tunnel` is required (no default):

```json
{
  "tunnel": "cloudflare",
  "port": 3000,
  "defaultName": "browser_user"
}
```

## Key Modules

- `src/presence.ts` — per-token user tracking (author, write/read mode, heartbeat)
- `src/http.ts` — HTTP routes + `/codoc.sh` remote CLI generation
- `src/ipc.ts` — Unix socket IPC with session ref-counting
- `src/comment-parser.ts` — shared between backend and frontend via `@shared` alias

## Comment Convention

A comment block (`<!-- ... -->`) applies to the line immediately above it. When adding comments, always place them directly after the line being discussed.
