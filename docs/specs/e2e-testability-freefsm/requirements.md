
### Overview

A general-purpose, agent-driven e2e testing framework that ships with fflow. An AI agent executes natural-language test plans against real infrastructure, observes effects, and produces structured logs for debugging.

### CLI Interface

Two sub-commands under `fflow e2e`:

| Command | Purpose |
|---------|---------|
| `fflow e2e gen` | Generate a test plan from a workflow or prompt |
| `fflow e2e verify` | Execute a test plan using an agent and produce a test report |

### `fflow e2e verify`

- Loads a `verifier.workflow.yaml` workflow internally to drive the verification process
- Accepts a test plan file (structured markdown) as input
- **`--test-dir <path>`** — required output directory for all artifacts
- Uses real fflow integration (e.g., `fflow run` or `fflow:start` skill) to execute workflows under test
- The agent follows the test plan steps, interacts with external services, and determines pass/fail

### `fflow e2e gen`

- Generates a structured markdown test plan from a workflow definition or user prompt
- Output is a `.md` file in the test plan format (see below)

### Test Plan Format

Structured markdown with these sections:

| Section | Purpose |
|---------|---------|
| `## Setup` | Prerequisites, environment, fixtures |
| `## Steps` | Ordered test steps with actions to perform |
| `## Expected Outcomes` | Natural language descriptions of what success looks like |
| `## Cleanup` | Teardown actions after the test |

### Verification Model

- **Agent judgment** — the agent evaluates pass/fail based on natural language expected outcomes
- No machine-parseable assertions; the agent interprets expected outcomes and compares against observed reality
- The agent collects evidence (command outputs, API responses, file contents) to support its judgment

### Output Artifacts (`--test-dir`)

| Artifact | Description |
|----------|-------------|
| Full transcript with timestamps | Complete log of agent actions and observations |
| Claude API JSONL | Raw API request/response log for reproducibility |
| `test-report.md` | Summary report with per-step pass/fail verdicts and evidence |

### Scope

- **General-purpose** — not tightly coupled to fflow; can test any CLI/workflow tool
- Ships bundled with fflow but architecturally independent
- `verifier.workflow.yaml` is bundled in fflow's `workflows/` directory

### Non-Functional Requirements

- Logs must be detailed enough for a follow-up agent to reproduce and debug failures
- Must work with real external services (GitHub API, etc.) — no mocking
