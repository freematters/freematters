# Contributing

Thanks for your interest in contributing to Freematters!

## Development Setup

```bash
git clone git@github.com:freematters/freematters.git
cd freematters/freefsm
npm install
npm run build
```

## Workflow

1. Create a branch from `main`
2. Make your changes
3. Run checks locally before pushing:

```bash
npm run build
npm test
npm run check
```

4. Open a PR against `main`
5. CI must pass before merge

## Project Structure

```
freematters/
├── freefsm/           # FSM runtime package
│   ├── src/           # TypeScript source
│   ├── skills/        # Claude Code / Codex skills
│   ├── hooks/         # Claude Code hooks
│   ├── workflows/     # Bundled workflow definitions
│   └── docs/          # Design docs
└── ...                # Future packages
```

## Code Style

- TypeScript with strict mode
- Formatting and linting via [Biome](https://biomejs.dev/)
- Run `npm run check` to auto-fix formatting and lint issues

## Adding a Workflow

Workflow YAML files go in `freefsm/workflows/`. They must pass `freefsm start` validation:

- `version: 1`
- `initial` state exists
- `done` terminal state exists
- All transition targets reference existing states
- State names match `[A-Za-z_-][A-Za-z0-9_-]*`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
