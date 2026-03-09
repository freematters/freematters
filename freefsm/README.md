# FreeFSM

CLI-first FSM runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code** and **Codex**.

## Why

AI coding agents are powerful but unreliable at following multi-step workflows. The core tension:

- **Natural language prompts** are flexible but non-deterministic — agents drift from instructions, skip steps, and ignore constraints no matter how many "MUST" and "ALWAYS" directives you add.
- **Hardcoded logic** is deterministic but rigid — every workflow change requires code changes, and bugs are inevitable.

FreeFSM resolves this by separating **what the agent does** (flexible, LLM-driven) from **where the agent goes** (deterministic, FSM-enforced). The agent stays in control of reasoning and tool use within each state, but the FSM governs which states exist and which transitions are legal.

## Install

Just tell your coding agent to read this [README](https://github.com/freematters/freematters/blob/main/freefsm/README.md), or run manually:

```bash
git clone https://github.com/freematters/freematters.git
cd freematters/freefsm
npm install && npm run build
npm install -g .

# Claude Code — registers skills + PostToolUse hook
freefsm install claude

# Codex — links skills (no hook support)
freefsm install codex
```

## How It Works

A workflow is a YAML file that defines states, transitions, and per-state prompts:

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
      next: done
  done:
    prompt: "Summarize the review."
    transitions: {}
```

The runtime works through three mechanisms:

1. **Skills** invoke the CLI — `/freefsm:start` loads the YAML, validates the schema, and enters the initial state. The agent sees a state card with the current prompt and available transitions.
2. **CLI enforces transitions** — when the agent calls `freefsm goto feedback --on found_issues`, the CLI validates the transition against the YAML before committing it. Illegal transitions are rejected.
3. **Hooks inject reminders** — a PostToolUse hook runs `freefsm current` every 5 tool calls, re-injecting the current state card into the agent's context. This counteracts context drift in long conversations.

All state changes are recorded as an append-only event log (JSONL), with a snapshot for fast reads. Runs are isolated by ID with directory-based file locking for concurrent safety.

## Usage

FreeFSM is typically used through these skills:

- `/freefsm:create` — guided Q&A to create a workflow YAML
- `/freefsm:start <path>` — start a workflow run (also searches `./workflows/` by name)
- `/freefsm:current` — show current state
- `/freefsm:finish` — abort an active run

Codex skill names use `$` instead of `/`.

## Bundled Workflows

- `pdd` — Plan-Driven Development: interactive requirements, research, design, and planning
- `spec-to-code` — implements a spec directory (from PDD) into working code via TDD
- `mr-lifecycle` — merge request lifecycle management

Start a bundled workflow by name:

```
/freefsm:start pdd
```

## License

MIT
