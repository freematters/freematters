---
name: e2e-run
description: Use when running e2e agent tests with freefsm verify — covers CLI usage, how verification works, interpreting results, and debugging failures.
---

# Running E2E Agent Tests

## Overview

`freefsm verify` executes a structured markdown test plan by launching a verifier agent that controls an embedded Claude Code agent. It can test **any agent behavior** — FSM workflows, slash commands, coding tasks, or multi-turn conversations.

## Quick Reference

```bash
freefsm verify <plan.md> --test-dir <path> [--model <model>] [--verbose] [-j/--json]
```

| Flag | Description |
|------|-------------|
| `<plan.md>` | Path to test plan markdown file |
| `--test-dir <path>` | Required. Output directory for test artifacts (auto-created) |
| `--model <model>` | Claude model override for the verifier agent |
| `--verbose` | Show tool calls and agent messages in output |
| `-j/--json` | Output results as JSON envelope |

Exit codes: `0` pass, `2` fail.

## How Verification Works

```
freefsm verify plan.md --test-dir ./out
  └─ Launches verifier agent (via Agent SDK)
       └─ Reads test plan
       └─ Uses MCP tools to control embedded agent:
            ├─ run_agent(prompt) — start a Claude Code session with any prompt
            ├─ wait(timeout)    — get agent output from current turn
            └─ send(text)       — send follow-up message for next turn
       └─ Judges each step PASS/FAIL
       └─ Writes test-report.md
```

The verifier agent runs a workflow (`verifier.fsm.yaml`): setup → execute → report → done.

### MCP Tools

The verifier has three tools to control the embedded agent:

- **`run_agent(prompt, model?)`** — Start an embedded Claude Code session. The prompt can be anything: a slash command, natural language task, etc. Only one session at a time.
- **`wait(timeout?)`** — Wait for the embedded agent to finish its current turn. Returns `{ output }` or `{ type: "timeout" }`. Default timeout: 120s.
- **`send(text)`** — Send a follow-up message to start a new turn. Must call after `wait()`.

## Output

Results are written to `--test-dir/test-report.md` with:

- Overall verdict: PASS or FAIL
- Per-step verdicts with evidence
- Unexpected observations
- Failure details for debugging

### Verbose Mode

Use `--verbose` to see real-time output with color-coded streams:

- `[verifier]` (green) — verifier agent output
- `[embedded]` (cyan, indented) — embedded agent output
- `[input]` (magenta) — messages sent to embedded agent

## Process

1. If the user specifies a test plan file, run it directly.
2. If no test plan file is specified, write a test plan based on the user's intent to `./e2e/`, then run the generated plan.

### Single test

```bash
freefsm verify e2e/simple-workflow.md --test-dir ./out/simple
```

### With model override

```bash
freefsm verify e2e/my-test.md --test-dir ./out --model claude-sonnet-4-20250514
```

### Debugging a failure

```bash
# Run with verbose to see full agent interaction
freefsm verify e2e/failing-test.md --test-dir ./out --verbose

# Check the report
cat ./out/test-report.md
```

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Timeout on `wait()` | Agent takes longer than expected | Increase timeout in Timeout Strategy section of test plan |
| Verifier misinterprets step | Ambiguous Background or Expected | Make Background more detailed, Expected more specific |
| Agent doesn't follow prompt | Prompt too vague | Be explicit in Setup agent prompt |
| `run_agent` fails | Session already active | Only one embedded agent session at a time |
| Test flaky across runs | Non-deterministic agent behavior | Add more specific expected criteria, use model override for consistency |

## Writing Test Plans

See the **e2e-gen** skill for the full guide on writing test plan markdown files.
