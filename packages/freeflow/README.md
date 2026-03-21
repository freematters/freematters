# FreeFlow

CLI-first workflow runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code** and **Codex**.

## Why

AI coding agents are powerful but unreliable at following multi-step workflows. The core tension:

- **Natural language prompts** are flexible but non-deterministic — agents drift from instructions, skip steps, and ignore constraints no matter how many "MUST" and "ALWAYS" directives you add.
- **Hardcoded logic** is deterministic but rigid — every workflow change requires code changes, and bugs are inevitable.

FreeFlow resolves this by separating **what the agent does** (flexible, LLM-driven) from **where the agent goes** (deterministic, workflow-enforced). The agent stays in control of reasoning and tool use within each state, but the workflow engine governs which states exist and which transitions are legal.

## Install

Tell this to your coding agent:

```
Read https://github.com/freematters/freematters/blob/main/packages/freeflow/README.md to install freeflow
```

Or install manually:

```bash
npm install -g @freematters/freeflow

# Claude Code — registers skills + PostToolUse hook
fflow install claude

# Codex — links skills (no hook support)
fflow install codex
```

### For Contributors

```bash
git clone https://github.com/freematters/freematters.git
cd freematters
npm install && npm run build
npm link -w packages/freeflow

fflow install claude
```

## Usage

FreeFlow is typically used through these skills:

- `/fflow-create` — guided Q&A to create a workflow YAML
- `/fflow <path>` — start a workflow run (also searches `./workflows/` by name)
- `/fflow:e2e-run` — run e2e agent tests

Codex skill names use `$` instead of `/`.

## Bundled Workflows

- `spec-gen` — generates a complete specification: interactive requirements, research, design, and planning
- `spec-to-code` — implements a spec directory (from spec-gen) into working code via TDD
- `mr-lifecycle` — merge request lifecycle management

Start a bundled workflow by name:

```
/fflow spec-gen
```

## How It Works

A workflow is a YAML file that defines states, transitions, and per-state prompts. The agent sees the current state's prompt and available transitions — it reasons freely within each state, but can only move where the workflow allows.

### Example 1: Bug fix (simple, linear)

```yaml
version: 1
guide: "Fix a bug with a test-first approach"
initial: reproduce
states:
  reproduce:
    prompt: "Write a failing test that reproduces the bug."
    transitions:
      test written: fix
  fix:
    prompt: "Fix the code to make the test pass. Run the full test suite."
    transitions:
      tests pass: done
      tests fail: fix
  done:
    prompt: "Summarize what was wrong and how you fixed it."
    transitions: {}
```

### Example 2: Code review (branching)

```yaml
version: 1
guide: "Review a PR for bugs, security, and style"
initial: analyze
states:
  analyze:
    prompt: |
      Read the full diff. Categorize each issue as blocker, major, or minor.
      If no issues found, transition directly to done.
    transitions:
      found issues: feedback
      looks good: done
  feedback:
    prompt: |
      Post a review comment for each issue. Use GitHub review threads.
      Request changes if any blockers exist, otherwise approve.
    transitions:
      review posted: done
  done:
    prompt: "Post a summary comment with issue counts by severity."
    transitions: {}
```

### Example 3: Feature implementation (multi-phase with iteration)

```yaml
version: 1
guide: "Implement a feature from spec to merged PR"
initial: plan
states:
  plan:
    prompt: |
      Read the spec. Break the work into incremental steps.
      Write a plan.md with checkboxes for each step.
    transitions:
      plan ready: implement
  implement:
    prompt: |
      Work through plan.md one checkbox at a time.
      Write tests before implementation. Run tests after each change.
      Check off each item as you complete it.
    transitions:
      all done: verify
      blocked: plan
  verify:
    prompt: |
      Run the full test suite, linter, and type checker.
      Fix any failures before proceeding.
    transitions:
      all pass: pr
      failures: implement
  pr:
    prompt: "Create a PR with a summary of changes and test plan."
    transitions:
      pr created: done
  done:
    prompt: "Report the PR URL."
    transitions: {}
```

### Three mechanisms enforce the workflow

1. **Skills invoke the CLI** — `/fflow` loads the YAML, validates the schema, and enters the initial state. The agent sees a state card with the current prompt and available transitions.
2. **CLI enforces transitions** — `fflow goto fix --on "test written"` validates the transition against the YAML before committing. Illegal transitions are rejected.
3. **Hooks inject reminders** — a PostToolUse hook runs `fflow current` every 5 tool calls, re-injecting the state card into the agent's context. This counteracts context drift in long conversations.

All state changes are recorded as an append-only event log (JSONL), with a snapshot for fast reads. Runs are isolated by ID with directory-based file locking for concurrent safety.

## License

MIT
