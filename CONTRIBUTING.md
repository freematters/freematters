# Contributing

Thanks for your interest in contributing to FreeFlow!

## Development Setup

```bash
git clone git@github.com:freematters/freematters.git
cd freematters
npm install
npm run build
npm link -w packages/freeflow  # symlinks fflow to PATH
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
├── packages/
│   ├── freeflow/        # Workflow runtime package
│   │   ├── src/           # TypeScript source
│   │   ├── skills/        # Claude Code / Codex skills
│   │   ├── hooks/         # Claude Code hooks
│   │   ├── workflows/     # Bundled workflow definitions
│   │   └── docs/          # Design docs
│   └── codoc/             # Collaborative markdown editor
├── biome.json           # Shared lint/format config
├── tsconfig.base.json   # Shared TypeScript base config
└── tsconfig.json        # Project references
```

## Deployment

Deployable packages each have their own `vercel.json` and a dedicated Vercel project with Root Directory pointing to the package path. See [docs/vercel-deploy.md](docs/vercel-deploy.md) for the full convention and how to add new deployable apps.

## Code Style

- TypeScript with strict mode
- Formatting and linting via [Biome](https://biomejs.dev/)
- Run `npm run check` to auto-fix formatting and lint issues

## Adding a Workflow

Workflow YAML files go in `packages/freeflow/workflows/`. They must pass `fflow start` validation:

- `version: 1`
- `initial` state exists
- `done` terminal state exists
- All transition targets reference existing states
- State names match `[A-Za-z_-][A-Za-z0-9_-]*`

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
