# E2E Testing Design: Verifier–Executor Model

## Core Idea

`freefsm verify` is a generic end-to-end testing framework built on a two-agent architecture. Instead of maintaining separate test harnesses for different software types (Playwright for web, shell scripts for CLI, HTTP clients for APIs), it uses two agents that communicate through a shared sandbox environment:

- **Verifier** — the outer agent. Reads the test plan, provides input (like a human user), and judges whether the executor's output meets expectations.
- **Executor** — the inner agent. Receives instructions, operates the software under test, and reports results. It acts as the universal adapter — it can start servers, run CLI commands, interact with UIs, call APIs, whatever the system needs.

Everything is agent. The executor IS the user of the software.

## Architecture

```
┌─────────────────────────────────────┐
│            Verifier Agent           │
│                                     │
│  Reads test plan (markdown)         │
│  Sends input via send()             │
│  Observes output via wait()         │
│  Judges pass/fail per step          │
│  Writes test-report.md              │
├─────────────────────────────────────┤
│         Shared Sandbox (fs, env)    │
├─────────────────────────────────────┤
│            Executor Agent           │
│                                     │
│  Receives prompt + user messages    │
│  Operates the system under test     │
│  Uses tools (Read, Write, Bash...)  │
│  Reports back naturally             │
└─────────────────────────────────────┘
```

The verifier launches the executor via `run_agent(prompt)`, then interacts through `send()` and `wait()` — the same interface a human would use. The two agents share the filesystem and environment, so the verifier can inspect side effects (files created, state changes, logs) directly.

## Why This Works

**Test plans are pure intent.** A test step says "log in, create a project, verify it appears in the list" — not "click button#submit, POST /api/projects, assert 200." If the UI changes from a button to a command palette, the test plan stays the same. Only the executor adapts.

**One harness for all software types.** CLI tools, web apps, APIs, agent workflows, FSM-driven processes — the executor handles them all. No per-domain test framework needed.

**Real user simulation.** The executor encounters the software the way a user would — confusing error messages, missing feedback, broken flows. This catches integration issues scripted tests miss.

## Trade-offs

**Non-determinism.** Two runs of the same test plan may take different paths because the executor interprets instructions differently. This makes failures harder to reproduce. Mitigation: the e2e-fix workflow writes a deterministic repro shell script from the session logs.

**Cost and speed.** Every run burns two agent sessions. This is too slow for inner-loop TDD (RED-GREEN-REFACTOR). Use freefsm verify for outer-loop validation — after implementation is complete, not after each step.

**Fuzzy judgment.** "Expected: Agent creates the file with correct content" is ambiguous — what counts as "correct"? A scripted assertion is unambiguous; an LLM judge can be lenient or strict. Mitigation: write specific expectations ("file contains a function named `greet` that takes a `name` parameter").

## Where It Fits

```
Inner loop (fast, deterministic):
  Unit tests, integration tests, property-based tests
  → Run after each implementation step
  → Deterministic pass/fail

Outer loop (slow, high-fidelity):
  freefsm verify (verifier + executor)
  → Run after all steps are complete
  → Tests the full user experience
```

The two layers complement each other. Fast deterministic tests catch logic errors during development. Agent-driven acceptance tests catch integration and UX issues before shipping.

## Test Plan Format

Test plans are structured markdown that the verifier reads and executes. See the [e2e-gen skill](../../.claude/skills/e2e-gen/SKILL.md) for the full format specification.

Key sections:
- **Background** — explains expected behavior (the verifier has no prior knowledge)
- **Setup** — the prompt to launch the executor, plus prerequisites
- **Steps** — numbered interactions: what to send, what to expect
- **Expected Outcomes** — high-level success criteria

## Session Logging

Each run directory is self-contained for debugging:
- `verifier-session.jsonl` — verifier agent's full session log
- `executor-session.jsonl` — executor agent's full session log
- `<test-plan>.md` — copy of the test plan used for this run
- `events.jsonl` — FSM event history
- `snapshot.json` — final FSM state

These artifacts enable the e2e-fix workflow to diagnose failures post-hoc without re-running.
