---
name: e2e-gen
description: Use when writing or generating e2e agent test plans for fflow verify — covers test plan format, parser rules, setup configuration, and how to describe agent interactions.
---

# Writing E2E Agent Test Plans

## Overview

`fflow verify` is a generic e2e testing framework built on the **verifier–executor model**
(see `packages/freeflow/docs/e2e-testing-design.md`):

- **Verifier** — the outer agent. Reads the test plan, launches the executor, provides input
  via `send()`, observes output via `wait()`, and judges pass/fail.
- **Executor** — the inner agent. Operates the software under test. It acts as the universal
  adapter — it can start servers, run CLI commands, interact with UIs, call APIs.

Everything is agent. The executor IS the user of the software.

Test plans should be written to `./e2e/` by convention (e.g. `./e2e/my-feature.md`),
or to `./specs/<slug>/e2e.md` when part of a spec-gen/spec-to-code workflow.

## Before Writing: Explore the Codebase

Before generating a test plan, you MUST explore the project for:

1. **Existing test infrastructure** — look for test directories, test configs, CI scripts,
   existing e2e tests, and testing frameworks already in use.
2. **How to build and run the software** — check README, CLAUDE.md/AGENTS.md, package.json,
   Makefile, etc. for build commands, dev servers, and test commands.
3. **Environment requirements** — env vars, services (databases, APIs), fixtures, seed data.
4. **Existing e2e test plans** in `./e2e/` — follow their patterns and conventions.

This exploration informs the Setup section and ensures the executor knows how to operate
the software correctly.

## Test Plan Format

The parser enforces this structure:

```markdown
# Test: <Descriptive Name>

<Brief description of what this test verifies.>

## Background

<Explain what the executor agent is expected to do — behavior, expected input/output.
The verifier agent does NOT know the internals. This section is critical.>

## Setup

The verifier executes this section BEFORE launching the executor.

- Executor prompt: <the initial prompt sent to the executor agent via run_agent()>
- <prerequisites — files to create, build steps, env setup, services to start, etc.>

The executor prompt MUST include enough context for the executor to operate the software:
- What the software is and how to use it
- Relevant skills, commands, or workflows available
- Environment details (working directory, config files, available tools)
- What the executor should NOT do (e.g., "do not modify production data")

## Steps
1. **<Step Name>**: <What to do — observe output, provide input, verify behavior>
   - Expected: <What the executor agent should do>
2. **<Step Name>**: <Description>
   - Expected: <Expected behavior>

## Expected Outcomes
- <High-level outcome when all steps pass>

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Agent startup / initial output | 60s |
| Simple state transition | 30s |
| Agent processing with tool calls | 60-120s |

## Cleanup

The verifier executes this section AFTER all steps complete (pass or fail).
Cleanup MUST ensure no leftover side effects:

- Kill any processes started during the test (servers, watchers, background jobs)
- Remove created files, directories, and temp data
- Tear down any services or containers started in Setup
- Reset environment variables modified during the test
- Remove any database entries or state created during the test
```

### Parser Rules

- `## Steps` and `## Expected Outcomes` are **required**
- Steps must be numbered (`1.`, `2.`, etc.)
- Step names must be **bold** followed by `:` — e.g. `1. **Start workflow**: ...`
- Each step needs `- Expected:` on the next line
- `## Background`, `## Timeout Strategy`, `## Cleanup` are optional but recommended

## Setup Section: Configuring the Executor

The Setup section tells the verifier how to prepare the environment and launch the executor.
The executor prompt is the single most important element — it determines whether the executor
can successfully operate the software.

### Executor Prompt Best Practices

The executor is a full Claude Code session with no prior context. The prompt must be
self-contained:

```markdown
# Good — executor has full context
- Executor prompt: |
    You are testing a CLI tool called `fflow`. The CLI is built at `packages/freeflow/dist/cli.js`.
    Start a workflow by running: node packages/freeflow/dist/cli.js start workflows/simple.workflow.yaml --run-id test-1
    Then transition through all states until done.

# Bad — executor has no idea what to do
- Executor prompt: `/fflow simple.workflow.yaml`
```

For simple cases (skills, slash commands) a short prompt is fine. For complex software,
include operating instructions.

### Prerequisites

List anything the verifier needs to prepare before launching the executor:

- **Build steps**: `npm run build`, compile commands — run these BEFORE `run_agent()`
- **Files to create**: test fixtures, config files, seed data
- **Services to start**: dev servers, databases, mock APIs — start and verify they're ready
- **Environment**: env vars to set, working directory requirements
- **Dependencies**: tools that must be installed, packages to verify

### Examples by Software Type

#### Workflow Tests

```markdown
## Setup
- Ensure fflow CLI is built: `npm run build` in `packages/freeflow/`
- Executor prompt: `/fflow path/to/workflow.workflow.yaml`
```

#### CLI Tool Tests

```markdown
## Setup
- Build the CLI: `npm run build`
- Create test input file at `/tmp/test-input.json` with: `{"key": "value"}`
- Executor prompt: |
    Run the CLI tool: node dist/cli.js process /tmp/test-input.json --format yaml
    Report the output and exit code.
```

#### Web Application Tests

```markdown
## Setup
- Install dependencies: `npm install`
- Start dev server: `npm run dev` (verify port 3000 is listening)
- Executor prompt: |
    A web application is running at http://localhost:3000.
    Use curl or fetch to interact with the API endpoints.
    Test the user registration flow: POST /api/register, then GET /api/profile.

## Cleanup
- Stop the dev server (kill the process on port 3000)
- Remove any test database entries
```

#### Multi-Turn Conversation Tests

Start with an initial prompt, then use `send()` in steps to continue:

```markdown
## Setup
- Create `src/main.ts` with a function that needs refactoring
- Executor prompt: `Help me refactor the function in src/main.ts`

## Steps
1. **Initial analysis**: Wait for executor to analyze the code
   - Expected: Executor identifies the function and suggests refactoring approach
2. **Approve refactoring**: Send "yes, go ahead with that approach" to the executor
   - Expected: Executor applies the refactoring and shows the diff
```

## Writing Good Test Plans

### Background Section

The most important section. The verifier has no prior knowledge. Explain:

- What the executor is expected to do when given the prompt
- What input the executor might request (so the verifier knows when to `send()`)
- What output the executor produces at each stage
- For workflows: states, transitions, and expected behavior per state

### Steps Describe Interactions, Not CLI Commands

Steps tell the verifier how to interact with the executor via `wait()` and `send()`:

```markdown
# Good — describes agent interaction
1. **Start the workflow**: Start the executor and wait for initial output
   - Expected: Executor initializes in "gather" state and asks for user input
2. **Provide input**: Send "my-project" when the executor asks for a project name
   - Expected: Executor acknowledges the name and transitions to "generate" state

# Bad — describes CLI commands
1. **Start the workflow**: Run `fflow start my.workflow.yaml --run-id test`
   - Expected: Exit code 0
```

### Expected Should Be Specific

```markdown
# Good
- Expected: Output includes today's date in YYYY-MM-DD format

# Bad
- Expected: Should work correctly
```

### Cleanup Should Be Thorough

The shared sandbox persists across tests. Leftover processes, files, or state from one
test can cause the next test to fail or behave unexpectedly.

```markdown
# Good — explicit cleanup
## Cleanup
- Kill the dev server: `kill $(lsof -ti:3000)` or equivalent
- Remove test fixtures: `rm -rf /tmp/test-workspace`
- Remove created database: `dropdb test_db`

# Bad — no cleanup or vague
## Cleanup
- Clean up test files
```

## Examples

### Workflow Test

```markdown
# Test: Simple workflow lifecycle

## Background

The simple workflow has two states: "start" and "done".
From "start", the executor should transition to "done" via the "next" transition.
The workflow completes when reaching "done" (terminal state with no transitions).

## Setup
- Executor prompt: `/fflow e2e/simple.workflow.yaml`

## Steps
1. **Start workflow**: Wait for the executor to initialize
   - Expected: Run initializes successfully in "start" state
2. **Verify completion**: Wait for the executor to transition through the workflow
   - Expected: Executor reaches "done" state and workflow completes

## Expected Outcomes
- Workflow starts in initial state and transitions to done
- The full lifecycle works end-to-end
```

### General Agent Behavior (Non-Workflow)

```markdown
# Test: Agent creates a file with correct content

## Background

When asked to create a greeting module, the executor should use the Write tool
to create a TypeScript file that exports a greet function. This tests basic
agent file creation behavior, not a workflow.

## Setup
- Executor prompt: `Create a file src/greet.ts that exports a function greet(name: string): string which returns "Hello, <name>!"`

## Steps
1. **Wait for executor to create file**: Wait for the executor to complete
   - Expected: Executor uses the Write tool to create src/greet.ts
2. **Verify file content**: Send "Read src/greet.ts and show me the content"
   - Expected: File contains a greet function that takes a name parameter and returns a greeting string

## Expected Outcomes
- src/greet.ts is created with the correct function signature
- The function returns the expected greeting format

## Cleanup
- Remove src/greet.ts
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Skipping codebase exploration | MUST explore existing tests, build setup, and env before writing |
| Missing Background section | Always explain expected behavior — verifier has no context |
| Executor prompt lacks context | Include how to build, run, and operate the software |
| Steps reference CLI directly | Describe agent interactions via wait/send, not shell commands |
| Vague expected outcomes | Be specific: what text, what state, what behavior |
| No timeout guidance | Add Timeout Strategy table — prevents flaky hangs |
| Steps not numbered | Parser requires `1.`, `2.`, etc. |
| Step name not bold | Must use `**Name**:` format |
| Missing `- Expected:` line | Each step requires expected on the next line |
| Assuming verifier knows the executor | Background must explain what the executor does |
| No cleanup or vague cleanup | List every process, file, and service to tear down |
| Leftover processes after test | Always kill servers/watchers started in Setup |
