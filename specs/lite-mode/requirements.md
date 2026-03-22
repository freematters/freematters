### Compiled Requirements

**Goal:** Reduce token cost when the same workflow state is re-entered during a conversation by avoiding redundant prompt injection.

**Feature: `--lite` mode for `fflow start`**

1. **`fflow start --lite`** — a new flag that persists `lite: true` in run metadata (`fsm.meta.json`). Once set, all subsequent `fflow goto` calls for that run use lite behavior automatically.

2. **Lite goto behavior** — when `fflow goto` transitions to a state that has been visited before in the current run:
   - Do NOT output the full state prompt
   - Output only: transitions and todos
   - Tell the agent it can call `fflow current` to review full instructions

3. **First visit** — when entering a state for the first time (even in lite mode), output the full state card as normal.

4. **Visit tracking** — track which states have been visited (set, not count) in the snapshot. No need to track or display visit counts.

5. **PostToolUse hook simplification** — regardless of lite mode, the hook reminder (`formatReminder()`) should only show transitions and todos. Remove the 200-char prompt excerpt from reminders entirely.

6. **`fflow current` unchanged** — always outputs the full state card (prompt + transitions + todos). This is the agent's fallback to retrieve full instructions when needed.

**Non-goals:**
- No YAML schema changes
- No cross-session resumption optimization (separate concern)
- No e2e testing — unit tests only

**Testing:**
- Unit tests for: visited-state tracking, lite card formatting, metadata persistence of `lite` flag, hook reminder simplification

---

### Q1: What triggers the "re-entry" scenario?

What exactly triggers the "re-entry" scenario you want to optimize?
1. The user's Claude Code conversation hits the context limit and a new session starts, but the workflow run is still active
2. The user voluntarily starts a new conversation and runs `/fflow` again to resume an in-progress run
3. Both of the above

**Answer:** Neither — this is about intra-conversation state re-entry. When freeflow transitions between states and a state is re-entered (e.g., requirements → research → requirements), the current behavior injects the entire state prompt again. The goal is to reduce token cost in this scenario.

### Q2: Where does the state prompt injection happen?

**Answer (self-researched):**

Two injection points:

1. **`fflow goto` CLI output (primary cost)** — `formatStateCard()` in `output.ts` always outputs the full state prompt. For `requirements` in github-spec-gen, this is ~60 lines (base prompt + GitHub adaptation). The guide is only printed on `fflow start`, not on `goto`.

2. **PostToolUse hook reminder (secondary cost)** — every 5 tool calls, `formatReminder()` re-injects a truncated version (first 200 chars of prompt + transitions). Smaller but repeated.

The `fflow goto` command has no awareness of whether a state was previously visited — it always outputs the complete `formatStateCard()`. There is no "abbreviated re-entry" mode.

**Re-entry patterns in github-spec-gen workflow:**
- `requirements` can be re-entered from: itself (revise), `research` (back to requirements), `design` (gaps found)
- `research` can be re-entered from: `requirements` (need research)
- `design` can be re-entered from: `plan` (needs design revision)

### Q3: Preferred approach direction?

Options presented:
1. Diff-based: only output what changed on re-entry
2. Abbreviated mode: detect re-entry, output short summary + ref to full prompt in context
3. Caching/dedup at CLI level: track visited states per-run, skip re-injection
4. Something else

**Answer:** Option 2 — abbreviated mode. Follow-up: "how do you construct the short summary?"

### Q3b: How to construct the abbreviated summary?

**Answer:** Add a `--lite` flag to `fflow start`. When a state is re-entered in lite mode:
- Only show transitions and todos (not the full prompt)
- Tell the agent how many times it has entered this state
- Tell it to call `fflow current` if it needs the full instructions

This is a runtime CLI-level solution — no YAML changes needed. The CLI tracks visit counts per state per run and adjusts output accordingly.

### Q4: Should lite mode also affect PostToolUse hook reminders?

Currently the hook truncates to 200 chars and fires every 5 tool calls regardless.

**Answer:** The hook should only show transitions and todos anyway — no prompt content in reminders regardless of lite mode. (This implies the hook reminder format should be simplified independently of lite mode.)

### Q5: `--lite` flag placement — on `start` or `goto`?

1. On `fflow start --lite` — persists in run metadata, all `goto` calls auto-use lite
2. On `fflow goto --lite` — per-transition control

**Answer:** Option 1 — `fflow start --lite` persists in run metadata. All subsequent `goto` calls auto-use lite mode.

### Q6: E2E testing coverage?

Options:
- Unit tests only (visit count, lite formatting, metadata)
- Unit tests + one e2e scenario (3-state workflow with loop)
- No e2e

**Answer:** Unit tests only. No e2e testing for this feature.
