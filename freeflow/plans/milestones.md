# Implementation Milestones

## M1: Project scaffold & FSM schema loader

Set up TypeScript project, YAML loading, and schema validation.

**Outcome:** `loadFsm(path)` returns a validated FSM object or throws with `SCHEMA_INVALID`. All validation rules enforced. Unit tests pass for valid/invalid YAML inputs.


**Files:** `package.json`, `tsconfig.json`, `src/fsm.ts`

**Ref:** [design-primary.md §3.1](../docs/design-primary.md#31-fsm-schema)

---

## M2: Storage layer

Implement directory layout, file lock, event append, and snapshot read/write.

**Outcome:** `Store` class can create a run directory, append events with monotonic `seq`, update snapshots atomically under file lock, and read snapshots back. Concurrent write test shows no corruption.

**Files:** `src/store.ts`

**Ref:** [design-primary.md §5](../docs/design-primary.md#5-storage-spec) (§5.3–§5.7)

---

## M3: `start` command

Initialize a new run: validate schema, create run directory, write `fsm.meta.json`, append `start` event, write initial snapshot, output state card.

**Outcome:** `fflow start <path> [--run-id <id>] [-j]` works end-to-end. Auto-generates `run_id` when omitted. Rejects duplicate `run_id`. Human-readable and JSON output match spec.

**Files:** `src/commands/start.ts`, `src/cli.ts`, `bin/fflow`

**Ref:** [design-primary.md §3.3 start](../docs/design-primary.md#start), [§3.4 start validation](../docs/design-primary.md#34-validation-order--error-precedence)

---

## M4: `current` command

Read snapshot + resolve state definition from FSM.

**Outcome:** `fflow current --run-id <id> [-j]` outputs `state`, `prompt`, `todos`, `transitions`. JSON mode additionally includes `run_id`, `run_status`. Errors on missing run.

**Files:** `src/commands/current.ts`

**Ref:** [design-primary.md §3.3 current](../docs/design-primary.md#current), [§5.6](../docs/design-primary.md#56-read-path)

---

## M5: `goto` command

Validate transition, append event, update snapshot, output new state card. Handle `done` state (set `run_status=completed`, `completion_reason=done_auto`).

**Outcome:** `fflow goto <target> --run-id <id> --on <label> [-j]` works. Invalid transitions rejected with available transitions in stderr (and structured data in `-j`). `goto done` completes the run.

**Files:** `src/commands/goto.ts`

**Ref:** [design-primary.md §3.3 goto](../docs/design-primary.md#goto), [§3.4 goto validation](../docs/design-primary.md#34-validation-order--error-precedence), [§3.2 lifecycle](../docs/design-primary.md#32-run-lifecycle)

---

## M6: `finish` command

Abort an active run: append `finish` event, set `run_status=aborted`.

**Outcome:** `fflow finish --run-id <id> [-j]` outputs terminal summary. JSON includes `run_status=aborted`, `completion_reason=manual_abort`. Rejects if run not active.

**Files:** `src/commands/finish.ts`

**Ref:** [design-primary.md §3.3 finish](../docs/design-primary.md#finish), [§3.4 finish validation](../docs/design-primary.md#34-validation-order--error-precedence)

---

## M7: PostToolUse reminder hook

Periodic FSM state reminder injected every 5 tool turns.

**Outcome:** `hooks/hooks.json` declares PostToolUse hook. `src/hooks/post-tool-use.ts` reads counter, increments, and emits state reminder on every 5th call. No-ops when no active run.

**Files:** `hooks/hooks.json`, `src/hooks/post-tool-use.ts`

**Ref:** [design-primary.md §4 PostToolUse reminder](../docs/design-primary.md#4-integration-spec)

---

## M8: Skills (create, start, current, finish)

Skill SKILL.md files that wrap CLI commands for Claude Code slash-command integration.

**Outcome:** `/fsm:create`, `/fsm:start`, `/fsm:current`, `/fsm:finish` work as described. `create` is pure conversation (no CLI dependency). Others invoke CLI and format output.

**Files:** `skills/{create,start,current,finish}/SKILL.md`

**Ref:** [design-primary.md §4 Integration Spec](../docs/design-primary.md#4-integration-spec)
