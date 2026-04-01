---
name: fflow
description: Start a workflow run. Default uses fflow start with CLI tracking. Use --lite for lite mode, --markdown for prompt-only mode.
---

# Start Workflow Run

Initialize a new workflow run from a workflow YAML file.

## Usage

- `/fflow PATH` — normal mode (default). Uses `fflow start` with full CLI tracking.
- `/fflow --lite PATH` — lite mode. Uses `fflow start --lite` (simplified cards on revisits).
- `/fflow --markdown PATH` — markdown-only mode. Uses `fflow render` to inject the full workflow as a prompt. No CLI state tracking or hooks.

## Mode Detection

1. If args contain `--markdown`: use **markdown mode** (see below).
2. If args contain `--lite`: use **lite mode** (see below).
3. Otherwise: use **normal mode** (see below).

Strip the mode flag from args before extracting PATH.

---

## Common Steps (all modes)

### 1. Check for active run

If there is a remembered `run_id` from a previous `/fflow` in this conversation, run `fflow current --run-id <run_id>`. If the current state is **not** `done`, prompt the user:
- "You have an active workflow `<run_id>` in state `<state>`. Abort it and start a new one?"
- Options: "Abort and start new" / "Keep it, start new anyway"
- If the user chooses to abort, run `fflow finish --run-id <run_id>` first.
- If the state is `done` or the run doesn't exist, skip this step silently.

### 2. Generate a run ID

Use the format `<workflow-name>-$(date '+%Y%m%d%H%M%S')` where workflow-name is derived from the workflow filename. Use lowercase letters, numbers, and hyphens.

---

## Normal Mode (`/fflow PATH`)

Full CLI-tracked mode with event sourcing and hooks.

### Process

1. Complete the **Common Steps** above.

2. **Run the CLI command:**

```bash
fflow start <PATH> --run-id <run-id>
```

Never omit `--run-id`. PATH can be a workflow name (e.g. `spec-gen`) or a full path. The CLI resolves it automatically.

3. **Remember the run ID** — Store the `run_id` value for use in subsequent `fflow current --run-id <run-id>` and `fflow goto <state> --run-id <run-id> --on <transition-label>` calls within this conversation.

4. **Flow CLI output**

> **WARNING — DO NOT TRUNCATE CLI OUTPUT**
>
> `fflow start`, `fflow goto`, and `fflow current` output **state cards** that contain critical workflow instructions. You MUST read the **complete, untruncated** output of these commands. NEVER pipe them through `tail`, `head`, or any other tool that truncates output. NEVER use a line-limit or byte-limit on their output. Truncating the output will cause you to miss **guide rules**, **state instructions**, and **transition definitions**, which will lead to incorrect workflow execution.

`fflow start` will output the initial state card. `fflow goto` will output the new state card. If the target state is `done`, the workflow is completed.

The state card consists of instructions, todos and valid state transitions. Follow the instructions and transition to the correct state based on the output of your actions.

**Execution model**: After every state transition, immediately execute the new state's instructions. You may summarize progress or report status, but do NOT stop between states. Keep driving the workflow forward until you reach a terminal state (a state with no transitions). Only a terminal state ends the workflow.

**Before ending a turn**: You MUST run `fflow current --run-id <run_id>` before ending your turn to check if there is remaining work in the current state. Only end your turn if the current state has no actionable work left or requires user input. This prevents accidentally dropping tasks mid-state.

If the exit code of any CLI is not 0, the CLI will output the error message. Follow the error message on right actions to take.

---

## Lite Mode (`/fflow --lite PATH`)

Same as normal mode but with `--lite` flag. Revisited states show simplified cards.

### Process

1. Complete the **Common Steps** above.

2. **Run the CLI command:**

```bash
fflow start <PATH> --run-id <run-id> --lite
```

3. Follow the same **Flow CLI output** instructions as normal mode above.

---

## Markdown Mode (`/fflow --markdown PATH`)

The agent reads the full workflow once and self-manages state transitions — no CLI calls after the initial render.

### Process

1. Complete the **Common Steps** above.
2. Run:

```bash
fflow render <PATH>
```

This outputs the full resolved workflow as markdown to stdout.

3. Read the **complete, untruncated** output. This is the entire workflow specification.

4. You are now running a workflow. The full workflow is rendered above. Follow these rules:

   - **Start at the initial state** (the first state in the document).
   - **Read the state's instructions** and execute them fully.
   - **Check transitions**: after completing a state's work, evaluate which transition condition is met and move to that target state.
   - **Track your current state yourself** — there are no CLI commands to call.
   - **Keep driving forward**: after every state transition, immediately execute the new state's instructions. Do NOT stop between states.
   - **Terminal state**: a state with no transitions ends the workflow. Only stop when you reach a terminal state.
   - **Guide rules**: if the workflow has a guide section, follow those rules throughout all states.

5. Remember the run ID for reference, but do not use it for CLI state tracking.

---

## `workflow_dir` — Workflow Directory

The CLI commands (`fflow start`, `fflow current`, `fflow goto`) include a `workflow_dir`
field in their output. In markdown mode (`fflow render`), it appears as an HTML comment:
`<!-- workflow_dir: /path -->`. This is the directory containing the workflow YAML file.

Use `workflow_dir` from CLI output whenever workflow prompts reference files relative to
the workflow directory (e.g., `{workflow_dir}/../references/github-cli.md`).

## Error Handling

- **`RUN_EXISTS`** — The generated run_id is already taken. Generate a different slug and retry.
- **`SCHEMA_INVALID`** — The YAML file has validation errors. Show the error message and suggest using `/fflow-author` to build a valid workflow.
