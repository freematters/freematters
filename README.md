# FreeMatters

Monorepo for FreeMatters — agent-native developer tools.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@freematters/freeflow`](packages/freeflow/) | CLI-first workflow runtime for AI coding agents | [![npm](https://img.shields.io/npm/v/@freematters/freeflow)](https://www.npmjs.com/package/@freematters/freeflow) |
| [`@freematters/codoc`](packages/codoc/) | Real-time collaborative markdown editing between AI agents and humans | [![npm](https://img.shields.io/npm/v/@freematters/codoc)](https://www.npmjs.com/package/@freematters/codoc) |

## Quick Start

### freeflow

```bash
npm install -g @freematters/freeflow
fflow install claude    # or: fflow install codex
```

See [packages/freeflow/README.md](packages/freeflow/README.md) for full documentation.

### codoc

```bash
npm install -g @freematters/codoc
codoc install claude
```

See [packages/codoc/AGENTS.md](packages/codoc/AGENTS.md) for full documentation.

## Development

```bash
git clone https://github.com/freematters/freematters.git
cd freematters
npm install
npm run build         # build all packages
npm test              # test all packages
npm run check         # biome lint/format
```

### freeflow

```bash
npm run build -w packages/freeflow
npm run test -w packages/freeflow
```

### codoc

```bash
npm --prefix packages/codoc/frontend install   # install frontend deps
npm run build -w packages/codoc                # tsc backend + vite frontend
npm run test -w packages/codoc                 # 202 unit/integration tests
```

## License

MIT
