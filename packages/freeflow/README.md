# FreeFlow

CLI-first workflow runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code**.

## Why

Agents drift when given long natural-language instructions; hardcoded pipelines are rigid. FreeFlow separates *what* the agent does (flexible, LLM-driven) from *where* it goes (deterministic, YAML-enforced).

## Install

Prereqs: Node.js 18+, Claude Code signed in.

```bash
npx fflow init                                        # plugin into Claude Code
npx fflow install-workflow [--local | --global] [-y]  # workflow templates
```

Restart Claude Code after `init` so the PostToolUse hook activates.
Uninstall: `npx fflow init --uninstall`.

### Contributors

```bash
git clone https://github.com/freematters/freematters.git
cd freematters && npm install && npm run build
npm link -w packages/freeflow
fflow init && fflow install-workflow
```

## Usage

Start a workflow from Claude Code:

```
/fflow spec-gen
```

- `/fflow <path>` — start any workflow by name or path
- `/fflow-author` — guided Q&A to create or edit a workflow YAML

### Bundled workflows

- `spec-gen` — generate a complete specification
- `spec-to-code` — implement a spec directory via TDD
- `mr-lifecycle` — merge request lifecycle management

## How It Works

A workflow is a YAML file of states, transitions, and per-state prompts. The agent sees the current state's prompt and available transitions; it can only move where the YAML allows.

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

Three mechanisms enforce it:

1. **Skills invoke the CLI** — `/fflow` loads the YAML and enters the initial state.
2. **CLI validates transitions** — `fflow goto fix --on "test written"` rejects illegal moves.
3. **Hooks inject reminders** — a PostToolUse hook re-injects the state card every 5 tool calls.

State changes are an append-only JSONL event log with a snapshot for fast reads.

## License

MIT
