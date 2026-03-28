# Test: Platform-agnostic issue-to-pr (GitHub fast-forward)

Verify that the unified issue-to-pr workflow auto-detects GitHub, runs through
issue-to-spec (fast-forward) → spec-to-code → pr-lifecycle on freematters/testbed.

## Background

The unified issue-to-pr workflow replaces the old `issue-to-pr` + `gitlab-issue-to-mr`
pair. It auto-detects the platform from the argument format and git remote, then uses
platform-specific API calls and scripts accordingly.

This test exercises the **GitHub path** in fast-forward mode. The feature is intentionally
trivial (a greet function) to keep implementation fast while exercising the full pipeline.

Key phases:
1. **start**: Detect GitHub from `freematters/testbed` argument
2. **issue-to-spec** (fast-forward): Create issue, Q&A, generate spec via GitHub issue comments
3. **decide**: Choose "fast forward" for semi-auto with gates
4. **confirm-implement**: Verifier posts "go" on issue
5. **spec-to-code**: Implement in issue mode
6. **confirm-pr**: Verifier posts "submit" on issue
7. **pr-lifecycle**: Create PR linked to issue

The executor should:
- Clone freematters/testbed to a temp directory
- Run the unified issue-to-pr workflow
- Navigate spec generation in fast-forward mode
- Wait at gates for verifier to approve via issue comments

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Clone testbed: `git clone https://github.com/freematters/testbed.git /tmp/platform-agnostic-gh-testbed`
- Executor prompt: |
    You are testing the unified issue-to-pr workflow on GitHub. Your working directory is /tmp/platform-agnostic-gh-testbed.

    Start by running: /fflow packages/freeflow/workflows/issue-to-pr/workflow.yaml

    The idea: "Add a greet module to freematters/testbed. Create src/greet.py with a
    function greet(name: str) -> str that returns 'Hello, <name>!' and add
    tests/test_greet.py with basic tests."

    The repo is freematters/testbed.

    When prompted for where to start in spec-gen, choose "requirements clarification".
    Answer each question briefly — this is a trivial greet utility. No e2e tests needed.
    When offered transition options after requirements, choose "fast forward".
    When asked about execution mode (full auto / fast forward / stop here), choose "fast forward" (option 2).

    At the confirm-implement gate, wait for the user to reply "go" on the issue.
    At the confirm-pr gate, wait for the user to reply "submit" on the issue.

    IMPORTANT: You are running from the freematters monorepo root. Use the local fflow binary.

## Steps

1. **Start workflow**: Wait for the executor to initialize and detect platform
   - Expected: Executor enters `start` state, detects GitHub platform from `freematters/testbed`, transitions to `spec/create-issue`

2. **Issue creation**: Wait for the executor to create a GitHub issue on freematters/testbed
   - Expected: Executor creates issue with title, status checklist, and welcome comment

3. **Requirements and spec generation**: Wait for Q&A and fast-forward spec generation
   - Expected: Executor posts questions, records answers, generates design and plan in fast-forward mode

4. **Decide gate**: Wait for the executor to choose fast-forward mode
   - Expected: Executor reaches decide state and chooses "fast forward"

5. **Confirm-implement gate**: Wait for the executor to post confirmation request on the issue
   - Expected: Executor posts "Ready to implement" comment and polls for approval
   - Action: Post "go" as a comment on the issue to approve implementation
   - Expected: Executor detects approval and transitions to implement

6. **Implementation**: Wait for the executor to implement the greet feature
   - Expected: Executor runs spec-to-code, creates feature branch, implements src/greet.py and tests/test_greet.py, pushes

7. **Confirm-pr gate**: Wait for the executor to post implementation summary on the issue
   - Expected: Executor posts summary and polls for approval
   - Action: Post "submit" as a comment on the issue to approve PR
   - Expected: Executor detects approval and transitions to submit-pr

8. **PR creation**: Wait for the executor to create a pull request
   - Expected: PR is created on freematters/testbed, linked to the source issue via "Closes #N"

## Expected Outcomes

- Platform detected as "github" without explicit specification
- A GitHub issue is created on freematters/testbed with spec artifacts as comments
- The agent pauses at confirm-implement and confirm-pr gates, waiting for issue comments
- A feature branch with src/greet.py and tests/test_greet.py is created
- A PR is created and linked to the issue
- All platform-specific operations use `gh` CLI and `poll_issue.py` / `poll_pr.py` scripts

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow init + issue creation | 120s |
| Requirements + spec gen (fast-forward) | 300s |
| Decide gate | 60s |
| Confirm-implement polling | 120s |
| Implementation (sub-agents) | 600s |
| Confirm-pr polling | 120s |
| PR creation | 120s |

## Cleanup

- Close the test PR if still open: `gh pr close --repo freematters/testbed <branch> --delete-branch`
- Close the test issue: `gh issue close --repo freematters/testbed <number>`
- Remove the cloned repo: `rm -rf /tmp/platform-agnostic-gh-testbed`
- Clean up freeflow run directory: `rm -rf $HOME/.freeflow/runs/issue-to-pr-*`

---

# Test: Platform-agnostic issue-to-pr (GitLab fast-forward)

Verify that the unified issue-to-pr workflow auto-detects GitLab, runs through
issue-to-spec (fast-forward) → spec-to-code → pr-lifecycle on ran.xian/testproj.

## Background

Same unified issue-to-pr workflow, but this test exercises the **GitLab path**. The
workflow detects GitLab from the argument format or git remote, then uses `glab` CLI
and `poll_issue_gl.py` / `poll_mr_gl.py` scripts.

Key phases (same structure, different platform APIs):
1. **start**: Detect GitLab from argument or git remote
2. **issue-to-spec** (fast-forward): Create issue, Q&A via issue notes
3. **decide**: Choose "fast forward"
4. **confirm-implement**: Verifier posts "go" on issue
5. **spec-to-code**: Implement in issue mode
6. **confirm-mr**: Verifier posts "submit" on issue
7. **pr-lifecycle**: Create MR linked to issue

The executor should:
- Work from the ran.xian/testproj clone
- Run the unified issue-to-pr workflow with GitLab project reference
- The workflow should detect GitLab and use `glab` CLI throughout

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Verify `glab` CLI is authenticated: `glab auth status`
- Ensure `GITLAB_TOKEN` is set: `export GITLAB_TOKEN=$(grep 'gitlab_token:' ~/.metabit/mg/config.yml | awk '{print $2}')`
- Clone testproj: `git clone https://gitlab.corp.metabit-trading.com/ran.xian/testproj.git /tmp/platform-agnostic-gl-testproj`
- Executor prompt: |
    You are testing the unified issue-to-pr workflow on GitLab. Your working directory is /tmp/platform-agnostic-gl-testproj.

    Start by running: /fflow packages/freeflow/workflows/issue-to-pr/workflow.yaml

    The idea: "Add a greet module to ran.xian/testproj. Create src/greet.py with a
    function greet(name: str) -> str that returns 'Hello, <name>!' and add
    tests/test_greet.py with basic tests."

    The project is ran.xian/testproj on gitlab.corp.metabit-trading.com.

    When prompted for where to start in spec-gen, choose "requirements clarification".
    Answer each question briefly — this is a trivial greet utility. No e2e tests needed.
    When offered transition options after requirements, choose "fast forward".
    When asked about execution mode (full auto / fast forward / stop here), choose "fast forward" (option 2).

    At the confirm-implement gate, wait for the user to reply "go" on the issue.
    At the confirm-mr gate, wait for the user to reply "submit" on the issue.

    IMPORTANT: You are running from the freematters monorepo root. Use the local fflow binary.

## Steps

1. **Start workflow**: Wait for the executor to initialize and detect platform
   - Expected: Executor enters `start` state, detects GitLab platform from project reference or git remote, transitions to `spec/create-issue`

2. **Issue creation**: Wait for the executor to create a GitLab issue on ran.xian/testproj
   - Expected: Executor creates issue with title and status checklist via `glab` API

3. **Requirements and spec generation**: Wait for Q&A and fast-forward spec generation
   - Expected: Executor posts questions as issue notes, records answers, generates design and plan in fast-forward mode

4. **Decide gate**: Wait for the executor to choose fast-forward mode
   - Expected: Executor reaches decide state and chooses "fast forward"

5. **Confirm-implement gate**: Wait for the executor to post confirmation request as issue note
   - Expected: Executor posts "Ready to implement" note and polls for approval
   - Action: Post "go" as a note on the issue to approve implementation
   - Expected: Executor detects approval and transitions to implement

6. **Implementation**: Wait for the executor to implement the greet feature
   - Expected: Executor runs spec-to-code, creates feature branch, implements, pushes

7. **Confirm-mr gate**: Wait for the executor to post implementation summary as issue note
   - Expected: Executor posts summary note and polls for approval
   - Action: Post "submit" as a note on the issue to approve MR
   - Expected: Executor detects approval and transitions to submit-mr

8. **MR creation**: Wait for the executor to create a merge request
   - Expected: MR is created on ran.xian/testproj, linked to the source issue via "Closes #N"

## Expected Outcomes

- Platform detected as "gitlab" without explicit specification
- A GitLab issue is created on ran.xian/testproj with spec artifacts as notes
- The agent pauses at confirm-implement and confirm-mr gates, waiting for issue notes
- A feature branch with src/greet.py and tests/test_greet.py is created
- An MR is created and linked to the issue
- All platform-specific operations use `glab` CLI and `poll_issue_gl.py` / `poll_mr_gl.py` scripts

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Workflow init + issue creation | 120s |
| Requirements + spec gen (fast-forward) | 300s |
| Decide gate | 60s |
| Confirm-implement polling | 120s |
| Implementation (sub-agents) | 600s |
| Confirm-mr polling | 120s |
| MR creation | 120s |

## Cleanup

- Close the test MR if still open: `export GITLAB_TOKEN=$(grep 'gitlab_token:' ~/.metabit/mg/config.yml | awk '{print $2}') && MR_IID=$(glab api projects/ran.xian%2Ftestproj/merge_requests --hostname gitlab.corp.metabit-trading.com | jq '[.[] | select(.state=="opened")] | .[0] | .iid') && glab api -X PUT "projects/ran.xian%2Ftestproj/merge_requests/$MR_IID" --hostname gitlab.corp.metabit-trading.com -f state_event=close`
- Close the test issue: find the issue IID and close via `glab api -X PUT "projects/ran.xian%2Ftestproj/issues/$IID" --hostname gitlab.corp.metabit-trading.com -f state_event=close`
- Remove the cloned repo: `rm -rf /tmp/platform-agnostic-gl-testproj`
- Clean up freeflow run directory: `rm -rf $HOME/.freeflow/runs/issue-to-pr-*`

---

# Test: spec-gen lite mode

Verify that spec-gen with --lite flag produces simplified design (4 sections) and
plan (1 step) artifacts.

## Background

The unified spec-gen workflow now supports a `--lite` mode that was previously a
separate `spec-gen-lite` workflow. In lite mode:
- Design has exactly 4 sections: Overview, Goal & Constraints, Architecture & Components, E2E Testing
- Plan has exactly 1 step covering all implementation
- The design approaches step is skipped

The executor runs `spec-gen` in fast-forward mode with lite enabled on a trivial feature
idea, then the verifier checks the output artifacts.

## Setup

- Ensure fflow CLI is built: run `npm run build` in `packages/freeflow/`
- Create a temp workspace: `mkdir -p /tmp/spec-gen-lite-test`
- Executor prompt: |
    You are testing spec-gen in lite mode. Your working directory is /tmp/spec-gen-lite-test.

    Start by running: /fflow spec-gen

    The idea: "A CLI tool called `greet` that takes a name argument and prints 'Hello, <name>!'.
    It should support a --shout flag to uppercase the output."

    When prompted for where to start, choose "requirements clarification".
    Answer each question briefly — this is extremely simple. No e2e tests needed.
    When offered transition options after requirements, choose "fast forward".

    NOTE: This is running in lite mode. Design should have exactly 4 sections. Plan should have exactly 1 step.

    IMPORTANT: You are running from the freematters monorepo root. Use the local fflow binary.

## Steps

1. **Start workflow**: Wait for the executor to create the project structure
   - Expected: Executor creates specs/<slug>/ directory with rough-idea.md and requirements.md

2. **Requirements**: Wait for the executor to complete Q&A and choose fast-forward
   - Expected: Executor asks a few questions, records answers, chooses fast forward

3. **Design generation**: Wait for the executor to generate design.md
   - Expected: Executor writes design.md in lite format

4. **Verify design format**: Send "Read specs/<slug>/design.md and list the top-level section headings"
   - Expected: Exactly 4 sections: Overview, Goal & Constraints, Architecture & Components, E2E Testing. No Error Handling or separate Data Models section.

5. **Plan generation**: Wait for the executor to generate plan.md
   - Expected: Executor writes plan.md with single step

6. **Verify plan format**: Send "Read specs/<slug>/plan.md and count the number of steps in the checklist"
   - Expected: Exactly 1 step: "Step 1: Implement the feature" (or similar). No multi-step breakdown.

7. **Completion**: Wait for the executor to generate summary.md and complete
   - Expected: Executor creates summary.md and reaches done state

## Expected Outcomes

- design.md has exactly 4 top-level sections (no Error Handling, no separate Data Models)
- plan.md has exactly 1 implementation step with sub-items referencing design components
- All standard spec-gen artifacts are produced (rough-idea.md, requirements.md, design.md, plan.md, summary.md)
- Fast-forward mode skips intermediate approvals

## Timeout Strategy

| Phase | Suggested wait timeout |
|-------|----------------------|
| Project creation | 30s |
| Requirements Q&A | 120s |
| Design generation | 120s |
| Plan generation | 60s |
| Summary and completion | 60s |

## Cleanup

- Remove the temp workspace: `rm -rf /tmp/spec-gen-lite-test`
- Remove specs directory if created in cwd: `rm -rf specs/greet*`
- Clean up freeflow run directory: `rm -rf $HOME/.freeflow/runs/spec-gen-*`
