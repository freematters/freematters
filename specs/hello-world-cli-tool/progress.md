# Hello World CLI — Progress

## Step 1: Create CLI entry point with argument parsing
- **Files changed**: `hello-world-cli/package.json`, `hello-world-cli/tsconfig.json`, `hello-world-cli/biome.json`, `hello-world-cli/src/cli.ts`, `hello-world-cli/src/__tests__/cli.test.ts`
- **What was built**: Project scaffolding (TypeScript, vitest, biome, commander) and a CLI entry point that accepts a required `<name>` argument and prints "Hello, <name>!". Shows usage help and exits with code 1 when no args are given.
- **Tests**: 2 tests added, all passing
- **Notes**: Used `showHelpAfterError(true)` and `exitOverride()` in commander to get the desired behavior of printing usage on missing args with exit code 1. Followed conventions from the existing `freefsm` package (ESM, biome config, vitest, same tsconfig settings).
