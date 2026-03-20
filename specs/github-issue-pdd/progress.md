# Issue Bot — Implementation Progress

## Step 1: Create issue-bot.workflow.yaml skeleton
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: FSM skeleton with all 8 states (create-issue, requirements, research, checkpoint, design, plan, e2e-test-design, done) and 16 transitions matching the design.md state diagram. All prompts are placeholder `"TODO"` values. Guide section is also placeholder.
- **Tests**: `fflow validate workflows/issue-bot.workflow.yaml` passes (8 states, 16 transitions, terminal state: done, has cycles as expected)
- **Notes**: Transition labels and structure mirror pdd.workflow.yaml style. The e2e-test-design state includes three transitions: approved (to done), skip (to done), and needs revision (self-loop).

## Step 2: Implement `create-issue` state prompt
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Full prompt for `create-issue` state. Instructs the agent to parse user prompt for repo and idea, create a GitHub issue via `gh issue create` with body following design.md §5.1 (rough idea + status checklist), extract and remember issue number and creator, post a welcome comment with requirements-vs-research choice, and poll for the user's reply using the ETag pattern.

## Step 3: Implement `requirements` state prompt
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Full prompt for `requirements` state. Implements the one-question-per-comment cycle: post question via `gh issue comment`, poll with ETag pattern, filter by issue creator's `user.login`, track Q&A in memory, repeat. On completion: posts `## requirements.md` summary comment, updates issue body status to check off "gathering requirements", presents transition options (checkpoint or research), polls for choice.

## Step 4: Implement `research` and `checkpoint` state prompts
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Full prompts for `research` and `checkpoint` states. Research: proposes topics as a comment, polls for user input, investigates, posts `## research/<topic-name>.md` comments with structured sections (Summary, Key Findings, Trade-offs, Recommendations, References), updates status checklist. Checkpoint: fetches all issue comments, identifies artifact comments, produces structured summary (requirements, research findings, gaps, readiness assessment), presents numbered options (design / requirements / research), polls for choice.

## Step 5: Implement `design`, `plan`, and `e2e-test-design` state prompts
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Full prompts for all three states. Design: reads all artifacts, produces `## design.md` comment with all 9 required sections (overview through appendices), supports minimize-and-repost for revisions, updates status. Plan: reads design artifact, posts `## plan.md` comment with TDD-ordered steps, updates issue body with plan task checklist, updates status, supports revision cycle. E2E: asks skip-or-design via comment poll, if yes produces `## e2e.md` with infrastructure/scenario/run/debug sections, supports revision cycle, updates status.

## Step 6: Implement `done` state prompt
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Full prompt for `done` state. Adds `spec-ready` label (creating it if needed), checks off all status items including spec-ready, compiles artifact comment links into a summary table, posts summary comment, reports completion. Issue is left open as living spec.

## Step 7: Add guide rules
- **Files changed**: fflow/workflows/issue-bot.workflow.yaml
- **What was built**: Replaced placeholder `guide: "TODO"` with comprehensive cross-state rules covering: ETag-based polling pattern (full bash script from design.md §4.2), creator-only filtering (check `user.login`), artifact comment format (`## <filename>`), minimize-and-repost pattern (GraphQL mutation from design.md §4.3), status checklist update rules, user-driven flow (numbered options + poll), agent memory tracking (repo, issue_number, issue_creator, artifact_comment_ids, current_etag), and planning-only constraint.
- **Tests**: `fflow validate workflows/issue-bot.workflow.yaml` passes (8 states, 16 transitions, terminal state: done)
