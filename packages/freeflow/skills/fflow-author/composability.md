# Workflow Schema Composability

## Versions

| Version | Adds |
|---------|------|
| `1`     | Base: `guide`, `initial`, `states` |
| `1.2`   | `workflow:` |
| `1.3`   | `subagent:` |
| `1.4`   | `extends:` (replaces `from:` and `extends_guide:`) |

Versions `1.0`–`1.3` continue to load, but `from:` and `extends_guide:` are no longer accepted at any version — use `extends:` instead.

---

## `extends:` — Whole-Workflow Inheritance (v1.4+)

Inherit an entire workflow's state graph. A child workflow may override or extend
inherited `guide:` / `prompt:` text, merge transitions, add new states, and change
`initial:` — but cannot remove inherited states.

```yaml
version: 1.4
extends: ../spec-gen/workflow.yaml   # relative path, or a registered workflow name
guide: |
  {{ super }}
  ### GitHub Override
  All artifacts posted as issue comments.

initial: create-issue                # child may override parent's initial

states:
  create-issue:                      # new state unique to the child
    prompt: |
      ## Create Issue
    transitions:
      start: requirements

  requirements:                      # override/extend an inherited state
    prompt: |
      {{ super }}
      ### GitHub Adaptation
      Post each question as an issue comment.
    transitions:
      proceed to design: design      # merged over parent's transitions map
```

**Resolution value** is `path-or-name`: tried first as a path relative to the
child workflow file, then as a registered workflow name.

**Merge rules:**
- Child **inherits all** parent states. Removing states is not supported.
- `guide:` / `prompt:`: if the child string contains `{{ super }}`, the parent
  text is substituted in place of the placeholder. Otherwise the child value
  fully replaces the parent's. If the child omits the field, the parent value
  is inherited verbatim. `{{ super }}` in a context with no parent content
  expands to an empty string.
- `transitions:`: `{ ...parent, ...child }` — child wins on label conflict.
  Omit `transitions:` to inherit as-is.
- `todos:`, `subagent:`, state-level `workflow:`: child value replaces parent
  if set; otherwise inherited.
- `initial:`: child may override.
- Transition targets must be closed after the merge — every target must refer
  to a state in the merged workflow. Validated at load time, all offenders
  reported.

**Single level, not transitive**: `extends:` resolves one parent. If A
`extends:` B and B `extends:` C, then A sees B with C already merged in — no
separate "C" identity.

**Cycle detection**: circular `extends:` chains fail at load time with the
full cycle path.

---

## `workflow:` — Composition (v1.2+)

Embed a child workflow as a single state. Child states are namespaced (`parent/child`).

```yaml
version: 1.4
states:
  spec:
    workflow: ../issue-to-spec/workflow.yaml
    transitions:
      completed: implement
  implement:
    workflow: ../spec-to-code/workflow.yaml
    transitions:
      completed: done
```

- Child states expanded as `spec/create-issue`, `spec/requirements`, etc.
- Child's `done` state gets parent's declared transitions.
- `workflow:` states cannot have `prompt` or `todos`.
- Supports arbitrary nesting (flattened at load time).
- The child workflow's `guide:` is attached as a per-state guide on the
  child's **initial** state only, and is surfaced once on first entry in a run
  (tracked via `shown_guides` in the snapshot).

---

## `subagent:` — Agent Delegation (v1.3+)

Mark a state for spawned subagent execution.

```yaml
version: 1.4
states:
  heavy-task:
    prompt: "Do something expensive."
    subagent: true
    transitions:
      complete: next-state
```

Parent spawns child agent → child works autonomously → proposes transition →
parent validates and executes `fflow goto`. Inherited via `extends:` like any
other state field.

---

## Resolution Order

1. `extends:` — merge parent workflow into child (`{{ super }}` substitution, transition merge, state inheritance).
2. `workflow:` — expand embedded sub-workflows (flattened with `parent/child` namespacing).
3. Schema validation (version gate, transition-target closure, initial-state existence).

## Search Path

Workflows referenced by name resolve: `.freeflow/workflows/<name>/` → `~/.freeflow/workflows/<name>/` → bundled. Relative paths (`./`, `../`) resolve from the referencing file.

## Key Properties

- **Load-time flattening**: all composition resolved at load, producing a flat FSM.
- **Namespace isolation**: `parent/child` naming prevents collisions for `workflow:`.
- **Circular reference detection**: both `extends:` and `workflow:` detect cycles at load time.
- **Validation errors are aggregated**: transition-target closure errors list every offender, and `extends:` lookup failures list every path/name attempted.
