# FreeFSM

CLI-first FSM runtime for agent workflows. Define states and transitions in YAML; the CLI enforces valid paths while leaving in-state reasoning to the LLM.

Works with **Claude Code** and **Codex**.

## Install

### CLI

```bash
npm i -g freefsm
```

### Claude Code

```bash
claude --plugin-dir /path/to/freefsm
```

### Codex

Codex uses native skill discovery via `~/.agents/skills`.

```bash
mkdir -p ~/.agents/skills
ln -sfn /path/to/freefsm/skills ~/.agents/skills/freefsm
```

## Usage

FreeFSM is typically used through these skills:

- `/freefsm:create` — guided Q&A to create a workflow YAML
- `/freefsm:start <path>` — start a workflow run (also searches `./workflows/` by name)
- `/freefsm:current` — show current state
- `/freefsm:finish` — abort an active run

Codex skill names are the same with the leading `$` instead of `/`.

#### Codex Limitations

- **No hooks.** Codex does not support PostToolUse hooks. The automatic state reminder every 5 tool calls is not available. The agent must rely on the skill instructions to periodically run `freefsm current` itself.
- **No PreToolUse validation.** Illegal transitions are caught by the CLI at execution time, not before. This is the same behavior as Claude Code v1 (PreToolUse hook is also not used in v1).

In practice, the CLI still enforces valid transitions — the agent just won't get periodic nudges to stay in the FSM workflow.

## Examples

See [examples/](examples/) for sample workflows and [docs/](docs/) for the design spec.

## License

MIT
