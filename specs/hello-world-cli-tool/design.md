
## 1. Overview

A minimal CLI tool (`hello`) that accepts a name argument and prints a greeting.

## 2. Components

### CLI Entry Point (`src/cli.ts`)
- Uses `commander` for argument parsing
- Required positional argument: `<name>`
- Optional flag: `--uppercase` / `-u` (converts greeting to uppercase)

### Greeting Module (`src/greet.ts`)
- `greet(name: string, options?: { uppercase?: boolean }): string`
- Returns `"Hello, <name>!"` or `"HELLO, <NAME>!"` if uppercase is true

## 3. Acceptance Criteria

- Given name "World", output is "Hello, World!"
- Given name "World" with --uppercase, output is "HELLO, WORLD!"
- Given no name, prints usage help and exits with code 1
