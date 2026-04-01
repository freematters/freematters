---
name: fflow-author
description: Create or edit FreeFlow workflow files.
---

# Create Workflow

Primary goal: co-create a workflow with the user interactively. The user knows what they
want to achieve — your job is to help structure it as a minimal, effective workflow.
You MUST NOT make users feel like they are filling a schema.

## Background (internal — do not expose to user)

This skill does NOT call the `fflow` CLI. It generates YAML and saves it with the Write tool.

FreeFlow is a CLI-first workflow runtime for agent workflows.
The YAML definition is authoritative for allowed transitions at runtime.
Each state provides guidance (`prompt`, optional `todos`) and named transition labels to next states.

Core runtime flow:
- `fflow start <path>` initializes a run at the configured initial state.
- `fflow goto <target> --run-id <id> --on <label>` validates exact transition label/target match, then advances state.

### Key design principles

**Every state transition is a context boundary.** The agent loses working memory when
transitioning between states. More states = more context loss. Fewer states = better coherence.

**The `guide` field persists across ALL states.** Rules that apply everywhere belong in
`guide`, not repeated in each state prompt. Keep `guide` concise and high-level — only
cross-cutting constraints and conventions. Detailed instructions belong in each state's
`prompt`. Never duplicate content between `guide` and state prompts.

**State prompts describe WHAT, not HOW.** The agent already knows how to code, research,
write tests, etc. Prompts add value by providing domain context, constraints, and success
criteria the agent wouldn't otherwise know. Don't micro-manage.

**Transition labels are outcome contracts**, not action descriptions. They describe what
happened ("tests pass", "user approves", "gaps found") not what to do ("run tests",
"ask user", "go back").

## When to create a state

Create a separate state ONLY when one or more of these apply:

1. **Context isolation** — a step involves enough work that keeping it in the same state
   would cause the agent to drift or lose focus on the overall workflow.
2. **Branching** — there are multiple possible outcomes that lead to genuinely different
   next steps (not just success/failure of the same task).
3. **Cycles / loops** — a step may need to repeat (e.g., implement → review → fix → review).
4. **Role change** — the agent switches from one mode to another (e.g., researcher → implementer)
   and needs different context framing.
5. **Human gate** — a hard checkpoint where the user must approve before proceeding,
   and the approval outcome determines the next path.

If none of these apply, keep it in one state. A single-state workflow is perfectly valid —
it's just a structured prompt with a clean start/done lifecycle.

## Process

1. **Discover the workflow**

   Ask these one at a time (each depends on the previous):

   1. **Purpose**: What outcome should this workflow produce? Encourage the user to describe
      their current human workflow — they can paste existing docs, notes, or step-by-step descriptions.
   2. **Heavy lifting**: What parts of the workflow involve the most work? These are automation
      opportunities. Ask the user to think about which parts would benefit from being separate
      states — but push back if a proposed state doesn't meet the criteria above.
   3. **Decision points**: Are there moments where human approval or input is required?
      These become either hard todos within a state or transition gates between states.

2. **Model the workflow**

   - Create the YAML at user-specified path, or default to `./workflows/<name>.workflow.yaml`.
     Start with only `guide:`, `version:`, `initial:`, `states:` with state names
     (blank prompts and transitions). Do not validate yet.
   - Create a TODO/Task for each state to fill collaboratively.
   - For each state, propose the prompt and transitions. Ask the user to review.
     - Put cross-cutting rules in `guide`, not in individual state prompts.
     - Keep state prompts focused on WHAT to achieve and constraints, not HOW to do it.
     - Use outcome-based transition labels ("user approves", "tests pass") not action labels
       ("run tests", "ask user").
   - Ask about must-do todos for each state.
   - Update the YAML after each approval.
   - You MUST work with the user to fill all states before moving on.

3. **Iterate**

   Ask the user to review the workflow YAML and iterate on changes — either by editing
   the file directly or through conversation.

4. **Validate before saving**

   - Ensure YAML passes the internal validation checklist (below).
   - Challenge unnecessary states: "Could this be folded into the previous state?"
   - Verify transition labels describe outcomes, not actions.
   - Ensure prompts are self-contained and agent-agnostic (work across Claude, Codex, etc.).
   - Ensure at least one rework/failure path when appropriate.

4.5. **Generate SKILL.md**

   After validation succeeds, generate a `SKILL.md` file in the same directory as the
   workflow YAML. This makes the workflow installable as an agent skill.

   **How to derive the fields:**
   - `{name}`: the workflow directory name (e.g., if the workflow is at
     `workflows/spec-gen/workflow.yaml`, the name is `spec-gen`).
   - `{description}`: derive from the entire `guide` field of the workflow YAML — read the
     full guide and write a concise one-line summary that captures the workflow's purpose.
     If `guide` is empty or missing, use `"Run the {name} workflow"`.
   - `{title}`: convert the name to title case, replacing hyphens with spaces
     (e.g., `spec-gen` -> `Spec Gen`).

   **Write this exact template** to `SKILL.md` in the workflow directory:

   ```markdown
   ---
   name: {name}
   description: {description}
   ---

   # {title}

   Run `/fflow {name}` with any arguments passed to this skill.
   ```

5. **Present results in user's language**

   - Summarize as phases and decision points.
   - Show a one-line flow (e.g., `gather → design → implement → done`).
   - Show saved file path.
   - Show YAML only if user asks.

## Cross-Agent Authoring Rules

Default to agent-agnostic workflows:

- Make prompts self-contained: assumptions, required outputs, decision criteria.
- Put universal rules in `guide`, not in state prompts.
- Don't reference agent-specific tools or features in prompts unless necessary.

### Heading levels in prompts

State prompts are rendered under `### Instructions:` in the markdown workflow format,
which is itself under `## State: xxx`. To avoid heading conflicts, use these levels
inside prompts:

- `####` for top-level sections within a state prompt
- `**bold text**` for sub-sections and emphasis
- Never use `##` or `###` inside prompts — those levels are reserved for the markdown format structure

This ensures the markdown renders correctly when the workflow is converted to `.workflow.md`.

## Workflow Reuse

When the user wants to build on an existing workflow or share structure across workflows,
read `composability.md` (in this skill directory) for full syntax
and merge rules for `from:`, `extends_guide`, `workflow:`, and `subagent:`.

## Internal Validation Checklist (do not expose unless asked)

- `version: 1.3` (always use latest version)
- `guide` is present and contains cross-cutting rules
- one valid `initial` state exists
- terminal `done` state exists with `transitions: {}`
- non-`done` states have non-empty transitions
- transition targets point to existing states
- transition labels describe outcomes, not actions
- state names match `[A-Za-z_-][A-Za-z0-9_-]*`
- if `todos` are used, they are non-empty unique strings
- no state prompt repeats rules already in `guide`
- if `from:` is used, the referenced workflow and state exist
- if `extends_guide:` is used, the referenced workflow exists and has a `guide` field
- SKILL.md exists alongside workflow.yaml with correct `name` (matching directory name) and `description` (derived from guide)
