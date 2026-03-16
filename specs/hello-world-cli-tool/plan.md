
# Implementation Plan: Hello World CLI

## Checklist
- [x] Step 1: Create CLI entry point with argument parsing
- [x] Step 2: Add greeting logic and tests
- [x] Step 3: Add --uppercase flag

---

## Step 1: Create CLI entry point with argument parsing

**Objective**: Set up the project with TypeScript, commander, and a basic CLI that accepts a name argument.

**Test Requirements**: Test that CLI prints usage when no args given (exit code 1).

**Implementation Guidance**: Create `src/cli.ts` with commander, positional `<name>` argument.

**Demo**: `node dist/cli.js World` prints "Hello, World!"

---

## Step 2: Add greeting logic and tests

**Objective**: Extract greeting logic to `src/greet.ts` with unit tests.

**Test Requirements**: Unit test `greet("World")` returns "Hello, World!".

**Implementation Guidance**: Create `src/greet.ts` with `greet()` function. CLI calls greet and prints result.

**Demo**: `npm test` passes, `node dist/cli.js Alice` prints "Hello, Alice!"

---

## Step 3: Add --uppercase flag

**Objective**: Add optional `--uppercase` flag that converts output to uppercase.

**Test Requirements**: Unit test `greet("World", { uppercase: true })` returns "HELLO, WORLD!".

**Implementation Guidance**: Add `-u, --uppercase` option to commander. Pass to `greet()`.

**Demo**: `node dist/cli.js World -u` prints "HELLO, WORLD!"
