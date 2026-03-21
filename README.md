# FreeFlow

Monorepo for FreeFlow — agent-native developer tools.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@freematters/freeflow`](packages/freeflow/) | CLI-first workflow runtime for AI coding agents | [![npm](https://img.shields.io/npm/v/@freematters/freeflow)](https://www.npmjs.com/package/@freematters/freeflow) |

## Quick Start

```bash
npm install -g @freematters/freeflow
fflow install claude    # or: fflow install codex
```

See [packages/freeflow/README.md](packages/freeflow/README.md) for full documentation.

## Development

```bash
git clone https://github.com/freematters/freematters.git
cd freematters
npm install
npm run build
npm test
npm run check         # biome lint/format
```

## License

MIT
