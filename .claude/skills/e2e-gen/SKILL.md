---
name: e2e-gen
description: Use when writing or generating e2e agent test plans for fflow verify — covers test plan format, parser rules, setup configuration, and how to describe agent interactions.
---

# Writing E2E Agent Test Plans

## Overview

`fflow verify` tests **any Claude Code agent behavior** — FSM workflows, slash commands, MCP tools, multi-turn conversations, or any agent task. This skill covers how to write the structured markdown test plans that the verifier agent reads and executes.

Test plans should be written to `./e2e/` by convention (e.g. `./e2e/my-feature.md`).

## Test Plan Format

The parser enforces this structure:

```markdown
# Test: <Descriptive Name>

<Brief description of what this test verifies.>

## Background

<Explain what the agent is expected to do — behavior, expected input/output.
The verifier agent does NOT know the internals. This section is critical.>

## Setup
- Agent prompt: <the initial prompt sent to the embedded agent via run_agent()>
- <other prerequisites — files to create, build steps, env setup, etc.>

## Steps
1. **<Step Name>**: <What to do — observe output, provide input, verify behavior>
   - Expected: <What the embedded agent should do>
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
- <Optional cleanup actions>
```

### Parser Rules

- `## Steps` and `## Expected Outcomes` are **required**
- Steps must be numbered (`1.`, `2.`, etc.)
- Step names must be **bold** followed by `:` — e.g. `1. **Start workflow**: ...`
- Each step needs `- Expected:` on the next line
- `## Background`, `## Timeout Strategy`, `## Cleanup` are optional but recommended

## Setup Section: Configuring the Embedded Agent

The Setup section tells the verifier how to launch the embedded agent. The key element is the **agent prompt** — the initial message sent to a full Claude Code session via `run_agent(prompt)`. The prompt is an arbitrary string.

### For FSM Workflow Tests

```markdown
## Setup
- Agent prompt: `/fflow:start path/to/workflow.workflow.yaml`
- Ensure fflow CLI is built: `npm run build` in `fflow/`
```

### For Slash Command / Skill Tests

```markdown
## Setup
- Agent prompt: `/my-skill some-argument`
- Ensure the skill is installed and accessible
```

### For General Agent Behavior Tests

```markdown
## Setup
- Agent prompt: `Read the file src/utils.ts and list all exported functions`
- Create test fixture file at `src/utils.ts` with known content
```

### For Multi-Turn Conversation Tests

Start with an initial prompt, then use `send()` in steps to continue:

```markdown
## Setup
- Agent prompt: `Help me refactor the function in src/main.ts`
- Create `src/main.ts` with a function that needs refactoring

## Steps
1. **Initial analysis**: Wait for agent to analyze the code
   - Expected: Agent identifies the function and suggests refactoring approach
2. **Approve refactoring**: Send "yes, go ahead with that approach" to the agent
   - Expected: Agent applies the refactoring and shows the diff
```

### Prerequisites

List anything the verifier needs to prepare before launching the agent:

- **Files to create**: test fixtures, config files, workflow YAMLs
- **Build steps**: `npm run build`, compile commands
- **Environment**: env vars, working directory requirements
- **Dependencies**: tools that must be installed

## Writing Good Test Plans

### Background Section

The most important section. The verifier agent has no prior knowledge. Explain:

- What the agent is expected to do when given the prompt
- What input the agent might request from the user
- What output the agent produces at each stage
- For FSM workflows: states, transitions, and expected behavior per state

### Steps Describe Interactions, Not CLI Commands

Steps tell the verifier how to interact with the embedded agent via `wait()` and `send()`:

```markdown
# Good — describes agent interaction
1. **Start the workflow**: Start the embedded agent and wait for initial output
   - Expected: Agent initializes in "gather" state and asks for user input
2. **Provide input**: Send "my-project" when the agent asks for a project name
   - Expected: Agent acknowledges the name and transitions to "generate" state

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

## Examples

### FSM Workflow Test

```markdown
# Test: Simple workflow lifecycle

## Background

The simple workflow has two states: "start" and "done".
From "start", the agent should transition to "done" via the "next" transition.
The workflow completes when reaching "done" (terminal state with no transitions).

## Setup
- Agent prompt: `/fflow:start e2e/simple.workflow.yaml`

## Steps
1. **Start workflow**: Wait for the embedded agent to initialize
   - Expected: Run initializes successfully in "start" state
2. **Verify completion**: Wait for the agent to transition through the workflow
   - Expected: Agent reaches "done" state and workflow completes

## Expected Outcomes
- Workflow starts in initial state and transitions to done
- The full lifecycle works end-to-end
```

### General Agent Behavior (Non-FSM)

```markdown
# Test: Agent creates a file with correct content

## Background

When asked to create a greeting module, the agent should use the Write tool
to create a TypeScript file that exports a greet function. This tests basic
agent file creation behavior, not an FSM workflow.

## Setup
- Agent prompt: `Create a file src/greet.ts that exports a function greet(name: string): string which returns "Hello, <name>!"`

## Steps
1. **Wait for agent to create file**: Wait for the agent to complete
   - Expected: Agent uses the Write tool to create src/greet.ts
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
| Missing Background section | Always explain expected behavior — verifier has no context |
| Steps reference CLI directly | Describe agent interactions via wait/send, not shell commands |
| Vague expected outcomes | Be specific: what text, what state, what behavior |
| No timeout guidance | Add Timeout Strategy table — prevents flaky hangs |
| Steps not numbered | Parser requires `1.`, `2.`, etc. |
| Step name not bold | Must use `**Name**:` format |
| Missing `- Expected:` line | Each step requires expected on the next line |
| Assuming verifier knows the agent | Background must explain what the agent does |
