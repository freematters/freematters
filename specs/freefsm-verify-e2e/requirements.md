# Requirements — freefsm-verify-e2e

### Q1: What does "specialized for freefsm" mean to you?

Currently `freefsm e2e verify` is a generic framework — it takes any markdown test plan and has a Claude agent execute it autonomously. What specific freefsm-aware capabilities are you looking for? For example:

1. **Built-in freefsm assertions** — the verifier agent gets MCP tools that understand freefsm concepts (state transitions, run status, FSM schema validation) instead of relying on generic bash commands
2. **Pre-built test plan templates** — ship test plans that cover freefsm's own commands (`start`, `goto`, `current`, `finish`) so users can dogfood out of the box
3. **Structured freefsm output parsing** — the verifier automatically parses `freefsm` CLI output (state cards, JSON mode) and validates structure, not just text matching
4. **Something else entirely**

**A:** The core problem is verifying `freefsm run` workflows that require user input. The verifier needs to:
- Detect when `freefsm run` is waiting for user input (not just hanging)
- Provide that input as the "user" to drive the workflow forward
- Observe the live logs of the running `freefsm run` process (stdout/stderr and Claude JSONL logs)

### Q2: How should the verifier know what input to provide and when?

When `freefsm run` pauses for user input, the verifier agent needs to decide what to type. Options:

1. **Test plan prescribes inputs** — each step in the markdown plan specifies both the expected prompt and the input to provide (e.g., "When asked 'Where to start?', respond with '1'")
2. **Agent decides autonomously** — the verifier agent reads the FSM workflow being tested, understands the expected interaction, and decides what input makes sense based on the test scenario
3. **Hybrid** — test plan provides high-level intent (e.g., "choose requirements path"), agent figures out the exact input

**A:** Agent decides autonomously — but it does NOT read the workflow being tested. Instead, it derives the correct input from the test plan's steps and goal. The test plan provides enough context for the verifier to figure out what to type.

### Q3: How does `freefsm run` currently signal it's waiting for user input?

I see `freefsm run` uses the Claude Agent SDK. When the agent needs user input, does it:

1. Write a specific marker/prompt to stdout (e.g., a line ending with `?` or a specific prefix)
2. Simply block on stdin after the agent produces a `result` message
3. Use some other mechanism (e.g., a file-based signal, a specific exit code)

I need to understand the current mechanism so the verifier can detect the "waiting" state reliably.

**A:** Yes, `request_input` MCP tool writes prompt to stderr and blocks on stdin. That's the signal.

**Design decision:** The verifier should run an **embedded** `freefsm run` (in-process, not subprocess), and provide MCP tools for the verifier agent to communicate with the embedded agent. Inspired by the Freeman evaluator pattern (`~/Code/freeman/freeman/evaluator/`):

- A message bus replaces stdin/stdout for the embedded run
- Verifier MCP tools:
  - `wait(timeout)` — blocks until the embedded agent produces an assistant message or calls `request_input`, returns the output
  - `send_input(text)` — sends input to the embedded agent (answers `request_input`)
- The verifier can also observe logs (stderr-equivalent + Claude API JSONL) from the embedded run

### Q4: What level of observability should `wait()` provide?

Options:
1. Just `request_input` prompt + assistant text result (what a human user sees)
2. All agent messages (assistant text, tool calls, tool results)
3. All of above + raw API logs

**A:** Option 1 — minimal. The verifier only sees what a human user would see: `request_input` prompts and assistant text output.

### Q5: Should the verifier be able to read embedded run's log files?

**A:** Yes. The verifier should be able to read log files (events.jsonl, snapshot.json, etc.) and use them to write the test report.

### Q6: How should this relate to the existing `freefsm e2e verify` command?

Options:
1. Replace it
2. New subcommand
3. Same command, auto-detect

**A:** Option 1 — replace it. The new embedded approach becomes the only `freefsm e2e verify`.

### Q7: Test plan format — does the existing markdown format need to change?

Options:
1. Add a `## Workflow` section
2. Pass workflow path as CLI argument
3. Infer from Setup section

**A:** Option 3 — infer from Setup. The Setup section already describes how to start the run, the verifier parses it to find the FSM workflow path.

### Q8: Scope — what's the MVP?

Proposed:
1. Embedded `freefsm run` with message bus replacing stdin
2. Verifier MCP tools: `wait(timeout)`, `send_input(text)`
3. Log access to embedded run's store files
4. Replace existing `freefsm e2e verify`
5. Test plan format unchanged

**A:** Add requirement: `freefsm e2e verify` should log all embedded agent output (without tool calls) and verifier agent output (without tool calls) and verifier's input to stderr, visually distinguishable between the three streams.

### Q9: Visual distinction for log streams?

Options:
1. Color-coded prefixes
2. Indentation-based
3. Both

**A:** Both — color prefixes + indentation for embedded agent output.
