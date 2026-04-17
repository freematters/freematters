# FreeFlow

CLI-first workflow runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code**.

## Why

AI coding agents are powerful but unreliable at following multi-step workflows. The core tension:

- **Natural language prompts** are flexible but non-deterministic — agents drift from instructions, skip steps, and ignore constraints no matter how many "MUST" and "ALWAYS" directives you add.
- **Hardcoded logic** is deterministic but rigid — every workflow change requires code changes, and bugs are inevitable.

FreeFlow resolves this by separating **what the agent does** (flexible, LLM-driven) from **where the agent goes** (deterministic, workflow-enforced). The agent stays in control of reasoning and tool use within each state, but the workflow engine governs which states exist and which transitions are legal.

## Getting Started

### Prerequisites

- Node.js 18 or newer
- [Claude Code](https://claude.com/claude-code) installed and signed in
- (Optional) [Codex](https://github.com/openai/codex) — `fflow init` lays down the same skills globally for Codex users

### Install

FreeFlow installs in two steps: the Claude Code plugin (skills + hooks), then
the workflow templates you'll actually run.

```bash
# 1. Install the FreeFlow plugin into Claude Code (skills + hooks bundled)
npx fflow init

# 2. Install workflow templates (every workflow + every agent pre-selected)
npx fflow install-workflow [--local | --global] [-y]
```

`init` registers the plugin with Claude Code (skills + hooks ship inside it)
and also lays down the same skills globally for Codex via
`npx skills add -g --agent codex`. **Restart Claude Code** afterwards so the
PostToolUse hook activates.

`install-workflow` shells out to `npx skills add` with every workflow and
every agent pre-selected (`--skill '*' --agent '*'`); the skills CLI still
shows its confirmation picker so you can review what will be installed. Pass
`-y` to skip the confirmation for non-interactive runs. Use `--local` to
install workflows into the current repo (default in `-y` mode) or `--global`
to make them available everywhere.

### Your first workflow

Once installed, open a project in Claude Code and try a bundled workflow:

```
/fflow spec-gen
```

The agent enters the workflow's first state, follows the instructions in the
state card, and transitions forward only where the YAML allows. Two other
skills are useful from day one:

- `/fflow-author` — guided Q&A to create or edit a workflow YAML
- `/fflow <path>` — start any workflow (searches `./workflows/` by name, or
  takes an absolute path)

### Uninstall

```bash
npx fflow init --uninstall
```

Removes the Claude plugin + the `freeflow-local` marketplace entry and
deletes the bundled skills from the global Codex skills dir. Best-effort
cleanup — missing pieces are skipped rather than fatal.

### For Contributors

```bash
git clone https://github.com/freematters/freematters.git
cd freematters
npm install && npm run build
npm link -w packages/freeflow

fflow init
fflow install-workflow
```

## Bundled Workflows

- `spec-gen` — generate a complete specification: interactive requirements, research, design, and planning
- `spec-to-code` — implement a spec directory (from spec-gen) into working code, one plan.md step at a time
- `pr-lifecycle` — monitor a PR/MR until merged or closed: auto-fix CI, rebase, and address review threads / `@bot` mentions

Each workflow is a YAML file — inspect or edit them in the installed
skills directory (`.claude/skills/` for `--local`, `~/.claude/skills/` for
`--global`), or run `/fflow-author` to build your own.

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
