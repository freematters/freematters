---
name: freefsm:create
description: Create FreeFSM workflow file.
---

# Create Workflow

Primary goal: your goal is to co-create a workflow with the user in an interactive way. Human input is important for 
this creative work as the user knows much better on what they will want to achieve. Your mission is to help, inspire and assist user to write a freefsm compatible yaml workflow file, your mission is not to take over the creative process.

You DON'T want to provide implmentation detail of freefsm to the user and you MUST not make users feel like they are filling a schema.

## Background on `freefsm` (Internal only for you to undetstand):

This skill does NOT call the `freefsm` CLI. It generates YAML and saves it with the Write tool.

FreeFSM is a CLI-first finite-state-machine runtime for agent workflows.
At runtime, the YAML definition is authoritative for allowed transitions.
Each state provides guidance (`prompt`, optional `todos`) and named transition labels to next states.

Core runtime flow:
- `freefsm start <fsm_path>` initializes a run at the configured initial state.
- `freefsm goto <target> --run-id <id> --on <label>` validates exact transition label/target match, then advances state.

Example state card (internal reference):
```text
State: implement
Prompt:
  Implement the approved plan.
  - Update the target files
  - Keep behavior unchanged unless requested
  - Prepare a short change summary

You MUST create a task for each of these items and complete them in order:
Todos:
  1. Add feature flag guard
  2. Add unit tests
  3. Run test suite

Transitions:
  tests pass -> validate
  blocked -> plan
  complete -> done
```

## Process

1. **Discover the workflow**
  You MUST follow these 3 steps in order, but ask them 1 by 1, because they are dependent on each other.

  1. Workflow purpose: What outcome should this workflow produce? Advise the user to give a more comprehensive story on 
     his or her current human workflow step. They can even paste entire document.
  2. Guess what can be heavy lifting part of the human workflow, because these are the oppurtunity to automate, ask user 
     to think of phases/stages in the workflow that should be handled as seperate state.
  3. Ask user if there are important decision points in the workflow that must require human approval or input. If there is such, put it as hard todos in any state.
   
2. **Model the workflow internally**
   - Create the blank workflow YAML to user-specified path, or default to `./workflows/<name>.fsm.yaml`. With only guide:, version:, initial: , states: with only state name (with blank prompt and transitions). When iterating with YAML, only need to verify at step 4, do not do in 2 nad 3.
   - You must create TODO or Task for each phase/state for you to work with the user to fill. 
   - For each state, propose state prompt (instructions) and transitions to the user, ask user to review and approve. Keep the transition label concise and meaningful.
   - Ask if there are any must todos in this state.
   - Then update the workflow YAML based on your understanding.
   - You MUST work with user to fill in all the blank states.

3. **Iterate on the workflow**
   - Ask the user to open the workflow YAML, edit direclty on the file, or iterate with you on any changes.

4. **Validate before saving**
   - Ensure generated YAML is valid and operational.
   - Ensure transitions are explicit and usable, keep transition label concise and meaningful.
   - Ensure at least one practical failure/rework path when appropriate.
   - Ensure prompts are self-contained and portable across Codex and Claude.

5. **Present results in user language**
   - Summarize as phases and decision points.
   - Show a one-line flow (for example: `Plan -> Build -> Validate -> Complete`).
   - Show saved file path.
   - Show YAML only if user asks to inspect it.

## Cross-Agent Authoring Rules

Default to agent-agnostic workflows:

- Make prompts self-contained: assumptions, required outputs, decision criteria.
- Keep state count practical (usually 3-7 plus `done`) unless user asks otherwise.

## Internal Validation Checklist (Do Not Expose Unless Asked)

Use this checklist before writing the file:

- `version: 1`
- `guide` is present
- one valid `initial` state exists
- terminal `done` state exists
- non-`done` states have non-empty transitions
- transition targets point to existing states
- state names match `[A-Za-z_-][A-Za-z0-9_-]*`
- if `todos` are used, they are non-empty unique strings
