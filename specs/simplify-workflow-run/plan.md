# Implementation Plan: Simplify FreeFlow Workflow Run

## ~~Step 1: Add `fflow render` command~~ ✓

**Files:**
- Create `src/commands/render.ts`
- Edit `src/cli.ts` — register `render` subcommand

**Work:**
1. Create `render.ts` with `RenderArgs` interface
2. Implement: `resolveWorkflow()` → validate YAML extension → `loadFsm()` → `serializeMarkdown()` → output routing (stdout / `-o` / `--save`)
3. Error on `.md` input with clear message
4. Error if both `-o` and `--save` specified
5. For `--save`: derive output path as `<dir>/<basename>.workflow.md`
6. Register in `cli.ts`: `program.command("render <fsm_path>").option("-o, --output <path>").option("--save").action(render)`
7. JSON envelope support via `-j`

**Acceptance:** `npm run fflow -- render spec-gen` outputs resolved markdown to stdout.

## ~~Step 2: Simplify state card output~~ ✓

**Files:**
- Edit `src/output.ts` — add `StateCardOptions` to `formatStateCard`
- Edit `src/commands/start.ts` — pass `{ includeGuide: true, includeReminders: true }`
- Edit `src/commands/goto.ts` — pass `{ includeGuide: false, includeReminders: false }`, always track `visited_states`, use lite card on revisits
- Edit `src/store.ts` — always include `visited_states` in snapshot (not just `--lite`)

**Work:**
1. Add `StateCardOptions` parameter to `formatStateCard()` with defaults `true`
2. Wrap guide and reminder sections in conditionals
3. In `goto.ts`: always track `visited_states` in snapshot
4. In `goto.ts`: first visit → `formatStateCard(card, fsmGuide, { includeGuide: false, includeReminders: false })`
5. In `goto.ts`: revisit → `formatLiteCard(card)` with added hint
6. Update `formatLiteCard()` to include "Run `fflow current` to review full instructions if you forget."
7. `start.ts` unchanged — always includes guide + reminders

**Acceptance:** `fflow start` shows guide+reminders. `fflow goto` (first visit) shows prompt only. `fflow goto` (revisit) shows lite card.

## ~~Step 3: Remove `fflow markdown convert`~~ ✓

**Files:**
- Delete `src/commands/markdown/convert.ts`
- Edit `src/cli.ts` — remove `markdown convert` subcommand
- Remove or update `skills/markdown-convert/` skill if it exists

**Work:**
1. Remove the convert command registration from CLI
2. Delete the convert source file
3. Check if the `markdown` parent command has other subcommands; if `convert` was the only one, remove the parent too
4. Keep `markdown-parser.ts` and `markdown-serializer.ts` (used by render)

**Acceptance:** `fflow markdown convert` returns "unknown command". `fflow render` works.

## ~~Step 4: Update `/fflow` skill~~ ✓

**Files:**
- Edit `skills/fflow/SKILL.md`

**Work:**
1. Rewrite skill to support three modes:
   - Default: run `fflow render <workflow>`, inject full markdown as prompt, no further CLI calls
   - `--lite`: same as default (render + inject, shorter initial framing)
   - `--full`: current behavior (start/goto/current + hook)
2. Default mode instructions: tell agent to self-manage state transitions from the rendered markdown
3. `--full` mode: preserve existing skill logic (run tracking, goto commands, hook)
4. Document flag usage in skill header

**Acceptance:** `/fflow spec-gen` renders and injects markdown. `/fflow --full spec-gen` uses CLI.

## ~~Step 5: Write e2e test plans~~ ✓ (completed during spec phase)

**Files:**
- Create `specs/simplify-workflow-run/e2e.md`

**Work:**
1. Write test plan for `fflow render` (resolve, output, --save, error cases)
2. Write test plan for lightweight `/fflow` mode (no CLI calls, self-managed transitions)
3. Write test plan for `--full` mode (preserved behavior)
4. Write test plan for simplified state cards (guide only in start, lite on revisit)

**Acceptance:** Test plans cover all scenarios from design.md E2E Testing section.
