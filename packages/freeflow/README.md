# FreeFlow

[![npm](https://img.shields.io/npm/v/@freematters/freeflow)](https://www.npmjs.com/package/@freematters/freeflow)

CLI-first workflow runtime for AI coding agents. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code** and **Codex**.

## Why

AI coding agents are powerful but unreliable at following multi-step workflows. The core tension:

- **Natural language prompts** are flexible but non-deterministic — agents drift, skip steps, and ignore constraints.
- **Hardcoded logic** is deterministic but rigid — every workflow change requires code changes.

FreeFlow resolves this by separating **what the agent does** (flexible, LLM-driven) from **where the agent goes** (deterministic, FSM-enforced). The agent reasons freely within each state, but the FSM governs which transitions are legal.

## Install

Tell your coding agent:

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

FreeFlow integrates with your agent through skills:

| Skill | Description |
|-------|-------------|
| `/fflow:create` | Guided Q&A to create a workflow YAML |
| `/fflow:start <path>` | Start a workflow run (searches `./workflows/` by name) |
| `/fflow:current` | Show current state and available transitions |
| `/fflow:finish` | Abort an active run |

Codex uses `$fflow:start` instead of `/fflow:start`.

## Bundled Workflows

| Workflow | Description |
|----------|-------------|
| `pdd` | Plan-Driven Development — interactive requirements, research, design, and planning |
| `spec-to-code` | Implements a spec directory (from PDD) into working code via TDD |
| `pr-lifecycle` | PR/MR lifecycle — monitors CI, fixes failures, handles review feedback |
| `code-review` | Automated code review with parallel security, performance, and quality agents |
| `release` | Semantic version bump, changelog, tag, and publish |

Start by name:

```
/fflow:start pdd
```

## How It Works

A workflow is a YAML file defining states, transitions, and per-state prompts:

```yaml
version: 1
guide: "Code review workflow"
initial: analyze
states:
  analyze:
    prompt: "Read the diff and identify issues."
    transitions:
      found_issues: feedback
      looks_good: done
  feedback:
    prompt: "Post review comments on each issue."
    transitions:
      done: done
  done:
    prompt: "Summarize the review."
    transitions: {}
```

Three mechanisms enforce the workflow:

1. **Skills invoke the CLI** — `/fflow:start` loads the YAML, validates the schema, and enters the initial state. The agent sees a state card with the current prompt and available transitions.

2. **CLI enforces transitions** — `fflow goto feedback --on found_issues` validates the transition against the YAML before committing. Illegal transitions are rejected with structured errors.

3. **Hooks inject reminders** — a PostToolUse hook runs `fflow current` every 5 tool calls, re-injecting the state card into the agent's context. This counteracts context drift in long conversations.

## Writing Workflows

Workflow files use the `.workflow.yaml` extension:

- `version: 1` — required
- `initial` — must reference an existing state
- `done` — terminal state with `transitions: {}`
- All transition targets must reference existing states

States can include `prompt` (agent instructions), `transitions` (label → target), `todo` (checklist), and `tools` (shell commands).

Use `/fflow:create` for guided workflow creation.

## License

MIT
