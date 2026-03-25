# Summary: Simplify FreeFlow Workflow Run

## What we're building

Make `/fflow` lightweight by default — agent reads rendered markdown and self-manages
state transitions without CLI state tracking or hooks. Full mode (`--full`) preserves
current behavior for when event sourcing and hook reminders are needed.

## Artifacts

| File | Description |
|------|-------------|
| [rough-idea.md](rough-idea.md) | Original user input |
| [requirements.md](requirements.md) | Q&A requirements record (15 questions) |
| [design.md](design.md) | Architecture, components, interfaces, testing |
| [plan.md](plan.md) | 5-step implementation plan |
| [e2e.md](e2e.md) | 10 end-to-end test scenarios |

## Key decisions

1. **`/fflow` = lightweight by default.** `/fflow --full` for CLI+hook mode.
2. **`fflow render`** — new command: YAML → resolved markdown. Replaces `fflow markdown convert`.
3. **State card simplification** — guide + reminders only in `fflow start`. `goto` first-visit = prompt only. Revisit = lite card with `fflow current` hint.
4. **`visited_states` always tracked** — not just in `--lite` mode.
5. **YAML input only** for `fflow render` — errors on markdown.

## Next steps

Start implementation following `plan.md` steps 1–5.
