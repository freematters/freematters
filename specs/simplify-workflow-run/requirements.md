# Requirements

### Q1: What does "run without the fflow tool" mean concretely?

Currently, the `/fflow` skill drives workflows by calling `fflow start`, `fflow goto`, and `fflow current` via the CLI. The PostToolUse hook fires reminders every 5 tool calls.

When you say "optionally run without the fflow tool," do you mean:
1. The agent reads the workflow markdown directly and follows the instructions as a prompt — no CLI calls, no state tracking, no event sourcing
2. The skill still uses the CLI under the hood, but the user doesn't need `fflow` installed (e.g., the skill embeds the workflow content inline)
3. Something else?

**A1:** Option 1 — no CLI at all. The agent reads the workflow markdown and follows it as a prompt. No state tracking, no event sourcing.

### Q2: How should state transitions work without the CLI?

Without `fflow goto`, the agent has no external validation of transitions. Should the agent simply:
1. **Self-manage** — read all states from the markdown, track which state it's in mentally, and follow the transition rules on its own (pure prompt-driven)
2. **Linear execution** — flatten the workflow into a sequential prompt (ignore the state machine, just follow instructions top-to-bottom)
3. Something else?

**A2:** Option 1 — self-manage. Agent reads all states and tracks transitions on its own from the prompt.

### Q3: What should the entry point look like for this "no-CLI" mode?

Currently users invoke `/fflow spec-gen`. In the no-CLI mode, how does the workflow get fed to the agent?
1. **The `/fflow` skill itself** handles it — detects no CLI available (or a flag like `--no-cli`), reads the markdown, and dumps the full workflow as a prompt
2. **A new, separate skill** (e.g., `/fflow-lite`) that only reads and injects the markdown
3. **User manually** reads the workflow file and pastes/pipes it
4. Something else?

**A3:** Single `/fflow` skill with three modes:
- `/fflow` (default) — lightweight. `fflow render` resolves YAML → markdown, skill injects as prompt. No CLI state tracking, no hook. Agent self-manages.
- `/fflow --lite` — same as default but passes `--lite` to `fflow start` for shorter initial output.
- `/fflow --full` — current behavior: CLI state tracking (`start`/`goto`/`current`), event sourcing, PostToolUse hook.

### Q4: How should `/fflow` (lightweight) handle workflow composition?

Current workflows use `from:` and `workflow:` directives for composition (inheriting states from other workflows, nesting sub-workflows). These are resolved by the CLI's FSM loader. Without the CLI, should `/fflow`:
1. **Pre-resolve via CLI** — still call `fflow` once to resolve/flatten the workflow into a single markdown, then run prompt-only from there
2. **Only support simple workflows** — no composition support in lightweight mode; error or warn if the workflow uses `from:`/`workflow:`
3. **Resolve in the skill** — the skill itself reads and merges referenced files

**A4:** Option 1 — use the CLI once to resolve/flatten the workflow, then run prompt-only from the flattened output.

### Q5: What output format should the CLI produce for the flattened workflow?

The CLI needs a new command or flag to dump the resolved workflow as a single prompt-ready document. Should this be:
1. **`fflow render <workflow>`** — a new command that outputs the full resolved workflow as markdown (guide + all states with instructions/transitions)
2. **`fflow start --dry-run`** — reuse the start command but just print the resolved content without creating a run
3. Something else?

**A5:** `fflow render <workflow>` — new command that resolves composition and outputs the full workflow as a single markdown document. This also replaces `fflow markdown convert` (the existing YAML↔markdown conversion command).

### Q6: Should `fflow render` support both YAML and markdown input?

Currently `fflow markdown convert` handles YAML→MD and MD→YAML. If `render` replaces it:
1. **Render always outputs markdown** — accepts both YAML and MD input, always produces a single resolved markdown prompt
2. **Bidirectional** — keeps the YAML↔MD conversion ability via a flag (e.g., `fflow render --format yaml|md`)
3. **Markdown only** — only accepts markdown workflows, YAML conversion is dropped entirely

**A6:** YAML input only. Outputs resolved markdown. Supports workflow path resolution (same as `fflow start` — name or path). Flags:
- Default: stdout
- `--replace`: overwrites the source YAML file with a `.md` file in the same location
- `-o <path>`: writes to a specific file

### Q7: When `--replace` is used, should it delete the original YAML file or keep both?

1. **Delete YAML, write MD** — the `.yaml` file is removed, replaced by `.md` in the same directory
2. **Keep both** — write the `.md` alongside the `.yaml`

**A7:** Revised approach:
- `fflow render <workflow>`: outputs rendered markdown to **stdout** by default
- `-o <path>`: writes to a specific file
- `--save`: writes `.md` alongside the `.yaml` (same directory, same basename), does NOT delete the YAML

### Q8: For the `/fflow` lightweight skill, after `fflow render` dumps the markdown, how should the skill feed it to the agent?

The skill gets the rendered markdown (all states, guide, transitions in one document). Should it:
1. **Inject the entire markdown as the skill prompt** — the agent reads it all at once and self-manages state transitions
2. **Inject only the guide + current state** — the skill parses the markdown and feeds one state at a time, prompting the agent to declare transitions
3. Something else?

**A8:** Option 1 — inject the entire rendered markdown as the skill prompt. The agent reads it all at once and self-manages transitions.

### Q9: Should the existing `fflow markdown convert` command be removed entirely, or kept as a deprecated alias?

`fflow render` subsumes its functionality (YAML→MD). Options:
1. **Remove** `fflow markdown convert` entirely
2. **Deprecate** — keep it but print a warning pointing to `fflow render`

**A9:** Remove `fflow markdown convert` entirely.

### Q10: What about the existing markdown workflows (`.workflow.md` files)?

Some workflows already exist as markdown. Should `fflow render` error on markdown input, or pass it through (resolve composition and output)?
1. **Error** — only YAML input accepted, markdown workflows are already in the target format
2. **Pass-through** — accept markdown too, resolve any composition, output the fully resolved markdown

**A10:** Error — only YAML input accepted.

### Q11: Do you want e2e tests for this feature?

The fflow e2e framework runs a verifier + executor agent pair. For this feature, possible scenarios:
- `fflow render` resolves a YAML workflow with composition and outputs correct markdown
- `/fflow` skill reads rendered markdown and drives a simple workflow to completion without CLI

E2e tests are slow (two agent sessions per run). Is it worth it here, or are unit tests sufficient?
1. **Yes, e2e tests** — cover both `fflow render` and the lightweight `/fflow` skill
2. **Unit tests only** — test render output and skill behavior with standard tests
3. **E2e for render only** — the CLI command is the riskiest part

**A11:** Yes, e2e tests covering both `fflow render` and the lightweight `/fflow` skill.

### Q12: Which parts of the state card output feel redundant or bloated?

Currently `fflow start` and `fflow goto` output state cards that include:
- The full **guide** (workflow-level rules) — repeated on every state transition
- **State name** and **instructions** (the prompt)
- **Todos** (if present)
- **Transitions** (valid next states)
- **Reminders** (e.g., "execute now", "don't truncate output")

Currently the workflow guide and fflow reminders are repeated in every `formatStateCard` (start + goto), `formatLiteCard`, and `formatReminder` (hook).

**A12:** Simplify state card output:
- **Workflow guide** (`guide:` from YAML): only output in `fflow start`, not in `goto`/`current`/reminders
- **fflow fixed reminders** ("execute now", "don't truncate", "don't stop between states"): only output in `fflow start`, not repeated in `goto`/`current`/reminders
- `goto` and `current` output only: state name, instructions, todos, transitions

### Q13: Should `--lite` mode behavior change too?

Currently `--lite` on re-entered states shows only transitions and todos (no full prompt). With the simplified state cards, `goto` already won't repeat guide/reminders. Should `--lite` remain as-is (skip full prompt on revisited states), or is it now redundant?
1. **Keep `--lite`** — still useful for skipping the full prompt on revisited states, reducing tokens further
2. **Remove `--lite`** — simplified cards are already lean enough

**A13:** Remove `--lite` as a separate flag. Instead, make the simplified behavior the default for `goto`: skip the full prompt on all states (not just revisited ones), and add a reminder like "Run `fflow current` to review full instructions if you forget." This is effectively `--lite` always-on for `goto`.

### Q14: To confirm the new `goto` output model — should `goto` always be lite (no prompt), or only skip the prompt on revisited states?

1. **Always lite** — `goto` never includes the full prompt, always says "run `fflow current` if you need instructions"
2. **Lite on revisit only** — first visit to a state via `goto` still shows the full prompt, revisits are lite

**A14:** Option 2 — lite on revisit only. First visit via `goto` shows the full prompt. Revisits show lite card with "run `fflow current` to review full instructions if you forget." This becomes the default `goto` behavior (no flag needed). `--lite` flag on `fflow start` is kept as-is — it still controls whether the initial state card is full or lite.

### Q15: What about the PostToolUse hook reminder format?

Currently the hook reminder also includes the guide + reminders. With the new model:
- Guide: only in `fflow start`
- Reminders: only in `fflow start`
- Hook reminder should contain: ???

What should the hook reminder include?
1. **Minimal** — just state name + todos + transitions (same as current lite card)
2. **Remove hook reminders entirely** — `/fflow-full` still has hooks for state tracking but no periodic reminders
3. **Keep as-is** — hook reminders are separate from the card simplification

**A15:** Keep hook reminders as-is. Not part of this simplification.