# Workflow Schema Composability

## Versions

| Version | Adds |
|---------|------|
| `1`     | Base: `guide`, `initial`, `states` |
| `1.1`   | `from:`, `extends_guide` |
| `1.2`   | `workflow:` |
| `1.3`   | `subagent:` |

---

## `from:` — State Inheritance (v1.1+)

Inherit prompt, todos, transitions from another workflow's state.

```yaml
states:
  requirements:
    from: "../spec-gen/workflow.yaml#requirements"
    prompt: |
      {{base}}
      ### GitHub Adaptation
      Post each question as an issue comment.
    append_todos:
      - "Update issue status checklist"
```

**Merge rules:**
- `prompt`: replaces base; `{{base}}` inserts base prompt inline
- `transitions`: child merged over base (child wins conflicts)
- `todos`: child replaces base; omit to inherit
- `append_todos`: appends to inherited todos
- `subagent`: inherited if not set locally

---

## `extends_guide` — Guide Inheritance (v1.1+)

Inherit the `guide:` field from another workflow. Often paired with `from:`.

```yaml
version: 1.1
extends_guide: ../spec-gen/workflow.yaml
guide: |
  {{base}}
  ### GitHub Override
  All artifacts posted as issue comments.
```

`{{base}}` inserts base guide. Without it, replaces entirely. Omit `guide:` to inherit as-is.

---

## `workflow:` — Composition (v1.2+)

Embed a child workflow as a single state. Child states are namespaced (`parent/child`).

```yaml
version: 1.2
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
- Child's `done` state gets parent's declared transitions
- `workflow:` states cannot have `prompt`, `todos`, `from:`
- Supports arbitrary nesting (flattened at load time)
- Child's `guide:` propagated as per-state guide overrides

---

## `subagent:` — Agent Delegation (v1.3+)

Mark a state for spawned subagent execution.

```yaml
version: 1.3
states:
  heavy-task:
    prompt: "Do something expensive."
    subagent: true
    transitions:
      complete: next-state
```

Parent spawns child agent → child works autonomously → proposes transition → parent validates and executes `fflow goto`. Inherited via `from:`.

---

## Resolution Order

1. `workflow:` — expand nested workflows
2. `from:` — resolve state inheritance
3. `extends_guide` — merge guide inheritance
4. Schema validation

## Search Path

Workflows referenced by name resolve: `.freeflow/workflows/<name>/` → `~/.freeflow/workflows/<name>/` → bundled. Relative paths (`./`, `../`) resolve from the referencing file.

## Key Properties

- **Load-time flattening**: all composition resolved at load, producing a flat FSM
- **Namespace isolation**: `parent/child` naming prevents collisions
- **Circular reference detection**: all mechanisms detect cycles at load time
