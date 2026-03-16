# Hello World CLI — Progress

## Step 1: Create CLI entry point with argument parsing
- **Files changed**: `hello-world-cli/package.json`, `hello-world-cli/tsconfig.json`, `hello-world-cli/biome.json`, `hello-world-cli/src/cli.ts`, `hello-world-cli/src/__tests__/cli.test.ts`
- **What was built**: Project scaffolding (TypeScript, vitest, biome, commander) and a CLI entry point that accepts a required `<name>` argument and prints "Hello, <name>!". Shows usage help and exits with code 1 when no args are given.
- **Tests**: 2 tests added, all passing
- **Notes**: Used `showHelpAfterError(true)` and `exitOverride()` in commander to get the desired behavior of printing usage on missing args with exit code 1. Followed conventions from the existing `freefsm` package (ESM, biome config, vitest, same tsconfig settings).

## Step 2: Add greeting logic and tests
- **Files changed**: `hello-world-cli/src/greet.ts` (new), `hello-world-cli/src/__tests__/greet.test.ts` (new), `hello-world-cli/src/cli.ts` (modified)
- **What was built**: Extracted greeting logic into a dedicated `greet()` function in `src/greet.ts`. Updated CLI entry point to import and use `greet()` instead of inline template literal.
- **Tests**: 2 tests added (total 4), all passing
- **Notes**: No deviations from spec. Straightforward extraction — no workarounds needed.

## Step 3: Add --uppercase flag
- **Files changed**: `hello-world-cli/src/greet.ts` (modified), `hello-world-cli/src/cli.ts` (modified), `hello-world-cli/src/__tests__/greet.test.ts` (modified)
- **What was built**: Added optional `--uppercase` / `-u` flag to the CLI and extended `greet()` to accept an options object with `uppercase` property, converting the greeting to uppercase when set.
- **Tests**: 2 tests added (total 6), all passing
- **Notes**: No deviations from spec. Biome auto-formatted the `greet()` function signature onto a single line.
