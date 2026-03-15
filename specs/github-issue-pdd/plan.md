# Implementation Plan: Issue Bot

## Checklist
- [x] Step 1: Create `issue-bot.fsm.yaml` with all states and transitions
- [x] Step 2: Implement `create-issue` state prompt (issue creation + initial comment)
- [x] Step 3: Implement ETag polling pattern and comment filtering in `requirements` state
- [x] Step 4: Implement `research` and `checkpoint` state prompts
- [x] Step 5: Implement `design`, `plan`, and `e2e-test-design` state prompts
- [x] Step 6: Implement `done` state prompt (label, summary, status update)
- [x] Step 7: Add guide rules (polling, comment format, minimize API, creator-only filtering)
- [ ] Step 8: Integration test against testbed

---

## Step 1: Create `issue-bot.fsm.yaml` with all states and transitions

**Objective**: Establish the FSM skeleton with all 8 states and correct transitions matching `pdd.fsm.yaml` flow.

**Test Requirements**:
- `freefsm validate freefsm/workflows/issue-bot.fsm.yaml` passes
- All states exist: `create-issue`, `requirements`, `research`, `checkpoint`, `design`, `plan`, `e2e-test-design`, `done`
- Transition graph matches design.md §3 state diagram

**Implementation Guidance**:
- Create `freefsm/workflows/issue-bot.fsm.yaml` with `version: 1`
- Add all 8 states with placeholder prompts (e.g., `prompt: "TODO"`)
- Wire transitions exactly as in design.md §3:
  - `create-issue` → requirements | research
  - `requirements` → checkpoint | research
  - `research` → checkpoint | requirements
  - `checkpoint` → design | requirements | research
  - `design` → plan | requirements
  - `plan` → e2e-test-design | design
  - `e2e-test-design` → done | done (skip) | e2e-test-design (revision)
  - `done` → {} (terminal)

**Integration Notes**: This is the foundation. All subsequent steps replace placeholder prompts.

**Demo**: Run `freefsm validate freefsm/workflows/issue-bot.fsm.yaml` — exit code 0. Run `freefsm start freefsm/workflows/issue-bot.fsm.yaml --run-id test-issue-bot` — shows initial state card with `create-issue` state.

---

## Step 2: Implement `create-issue` state prompt

**Objective**: The first real state — creates a GitHub issue and establishes the interaction context.

**Test Requirements**:
- Run the workflow, verify `gh issue create` is called with correct body structure (rough idea + status checklist per design.md §5.1)
- Verify the bot asks user to choose: requirements or research

**Implementation Guidance**:
- Write the `create-issue` prompt instructing the agent to:
  1. Parse the user's prompt for repo (e.g., `owner/repo`) and idea description
  2. Create issue via `gh issue create --repo {repo} --title {title} --body {body}`
  3. Body follows design.md §5.1 template (rough idea + status checklist with all items unchecked)
  4. Remember the issue number and issue creator from the output
  5. Post an initial comment welcoming the user and asking: start with requirements or research?
  6. Poll for user's reply (introduce the ETag polling pattern here)

**Integration Notes**: This state establishes `repo`, `issue_number`, and `issue_creator` that all subsequent states depend on.

**Demo**: Start the workflow with a prompt like "create an issue on freematters/testbed about adding dark mode". Verify issue is created on GitHub with correct body structure.

---

## Step 3: Implement ETag polling and `requirements` state prompt

**Objective**: Core interaction loop — one question per comment, poll for answer, summarize at end.

**Test Requirements**:
- Bot posts a question as a comment, polls for reply, processes only creator's reply
- After requirements complete, a `## requirements.md` summary comment is posted
- Non-creator comments are ignored

**Implementation Guidance**:
- Write the `requirements` prompt instructing the agent to:
  1. Post one question as an issue comment via `gh issue comment`
  2. Poll for new comments using the ETag pattern from design.md §4.2 (1s interval)
  3. Filter: only process comments where `author.login` matches issue creator
  4. Append Q&A to internal tracking (agent memory)
  5. Repeat until agent believes requirements are sufficient
  6. Post a `## requirements.md` summary comment with all Q&A consolidated
  7. Update issue body status: check off "gathering requirements"
  8. Present transition options: checkpoint or research

**Integration Notes**: The ETag polling pattern established here will be reused by all states that need user input. Reference design.md §4.2 for the bash pattern.

**Demo**: Run the workflow to `requirements` state. Verify bot posts question on the issue, waits for reply, processes it, posts next question. Post a comment from a different user — verify it's ignored.

---

## Step 4: Implement `research` and `checkpoint` state prompts

**Objective**: Research produces artifact comments; checkpoint summarizes and navigates.

**Test Requirements**:
- Research posts `## research/<topic>.md` comments
- Checkpoint reads all prior comments, summarizes, presents options
- User can navigate back to requirements or forward to design

**Implementation Guidance**:
- `research` prompt:
  1. Propose research topics as a comment, poll for user input
  2. Investigate topics (web search, codebase exploration)
  3. Post each finding as a `## research/<topic-name>.md` comment
  4. Update issue body status: check off "research"
  5. Present transition options: checkpoint or requirements
- `checkpoint` prompt:
  1. Read all artifact comments on the issue to build a summary
  2. Post a summary comment listing decisions made, findings, and gaps
  3. Present numbered options as a comment: proceed to design / back to requirements / more research
  4. Poll for user's choice

**Integration Notes**: Research may be visited multiple times. Each visit can produce additional `## research/<topic>.md` comments. Checkpoint should handle variable numbers of artifacts.

**Demo**: Navigate to research, verify topic comments are posted. Navigate to checkpoint, verify summary is accurate and options are presented.

---

## Step 5: Implement `design`, `plan`, and `e2e-test-design` state prompts

**Objective**: The output-producing states that generate the spec artifacts.

**Test Requirements**:
- Design posts `## design.md` comment, iterates on feedback
- Plan posts `## plan.md` comment, updates issue body with task checklist
- E2E test design offers skip option, posts `## e2e.md` if chosen
- Artifact updates minimize old comment and post new one

**Implementation Guidance**:
- `design` prompt:
  1. Read all prior artifact comments for context
  2. Produce design document following PDD design template
  3. Post as `## design.md` comment
  4. Poll for feedback; if user wants changes, minimize old comment (design.md §4.3 minimize API), post updated version
  5. Update issue body status: check off "design"
  6. Transitions: plan or requirements (gaps)
- `plan` prompt:
  1. Read design comment for context
  2. Produce implementation plan following PDD plan template
  3. Post as `## plan.md` comment
  4. Update issue body: add plan steps as task checklist (design.md §5.1)
  5. Update issue body status: check off "plan"
  6. Poll for approval; iterate if needed (minimize + repost)
  7. Transitions: e2e-test-design or design (revision)
- `e2e-test-design` prompt:
  1. Ask user: design E2E tests or skip? (as comment, poll for reply)
  2. If skip → transition to done
  3. If yes → produce E2E test design, post as `## e2e.md` comment
  4. Update issue body status: check off "e2e-test-design"
  5. Poll for approval; iterate if needed
  6. Transitions: done or e2e-test-design (revision)

**Integration Notes**: The minimize-and-repost pattern for artifact updates applies to all three states. The plan state is unique in also updating the issue body with a task checklist.

**Demo**: Walk through design → plan → e2e-test-design. Verify each artifact comment is posted. Request a revision to design — verify old comment is minimized and new one posted. Verify plan checklist appears in issue body.

---

## Step 6: Implement `done` state prompt

**Objective**: Finalize the issue — label, status update, summary.

**Test Requirements**:
- `spec-ready` label is added to the issue
- All status checklist items are checked
- A summary comment is posted

**Implementation Guidance**:
- `done` prompt:
  1. Add `spec-ready` label via `gh issue edit {n} --repo {repo} --add-label spec-ready`
  2. Update issue body: check off all status items including "spec-ready"
  3. Post a summary comment listing all artifact comments with links
  4. Report completion to the user

**Integration Notes**: This is the terminal state. After this, the freefsm workflow ends.

**Demo**: Verify issue has `spec-ready` label, all status checkboxes are checked, and summary comment lists all artifacts.

---

## Step 7: Add guide rules

**Objective**: Add the `guide` section with cross-state rules for polling, comment formatting, minimize API, and creator filtering.

**Test Requirements**:
- `freefsm validate` still passes after adding guide
- Guide text covers: ETag polling pattern, comment title format, minimize API usage, creator-only filtering, status checklist updates

**Implementation Guidance**:
- Add `guide: |` section to the YAML with rules that apply across ALL states:
  1. **Polling**: Use ETag-based polling at 1s intervals (include the bash pattern from design.md §4.2)
  2. **Comment format**: Artifact comments must use `## <filename>` title format
  3. **Minimize API**: When updating an artifact, minimize the old comment with `OUTDATED` classifier before posting new one (include GraphQL mutation from design.md §4.3)
  4. **Creator filtering**: Only process comments from the issue creator
  5. **Status updates**: Update issue body status checklist when completing each phase
  6. **User-driven flow**: Present numbered options at transitions, poll for user's choice

**Integration Notes**: Guide rules complement state prompts. They should not duplicate state-specific instructions.

**Demo**: Read the full YAML. Verify guide covers all cross-cutting concerns. Run `freefsm validate` — passes.

---

## Step 8: E2E test against testbed

**Objective**: End-to-end validation of the complete workflow using the E2E test design from `e2e.md`.

**Test Requirements**:
- Full workflow run against `freematters/testbed` produces a valid spec issue
- All acceptance criteria from design.md §7 are verified
- All E2E scenarios from e2e.md §2 pass

**Implementation Guidance**:
- Follow the E2E test scenario in `specs/github-issue-pdd/e2e.md` §2
- Run the verification commands from e2e.md §3
- Use the debugging guide from e2e.md §4 if any step fails

**Integration Notes**: This validates the entire workflow end-to-end. Refer to `e2e.md` for detailed steps, verification commands, and debugging procedures.

**Demo**: The testbed issue is a complete spec with all artifacts as comments, plan checklist in body, `spec-ready` label, and all status items checked.
