# Requirements — issue-to-pr workflow

## Core Concept

An end-to-end workflow from GitHub issue to merged PR. The GitHub issue is the central communication channel — the agent creates/attaches to an issue, gathers requirements via issue comments, generates a spec, implements code, and submits a PR, all linked back to the issue.

## Q&A

### Q1: Issue source
**Q:** Should the workflow create a new issue or accept an existing one?
**A:** Both. Support creating a new issue from a rough idea, or attaching to an existing issue URL/number.

### Q2: Modes
**Q:** What modes should the workflow support?
**A:**
- **Fast forward** (semi-auto): Runs spec-gen in fast-forward. Stops before spec-to-code and before /pr for user confirmation via issue polling (20s interval).
- **Full auto**: Runs everything from requirements to PR submission without stops.

### Q3: Polling mechanism
**Q:** How should the agent wait for user input between phases?
**A:** In-session polling at 20-second intervals using the existing `poll_issue.py` script from github-spec-gen.

### Q4: Spec phase
**Q:** Should requirements go through full spec-gen or skip to spec-to-code?
**A:** Full spec-gen, reusing the `github-spec-gen` sub-workflow (issue-based spec generation with polling).

### Q5: Issue integration
**Q:** How should sub-workflows link to the issue?
**A:** spec-to-code runs in "issue mode" (`owner/repo#N`) which already pushes per-step, updates issue checklist, and posts progress comments. pr-lifecycle already reads `source-issue` to link PR to issue.

### Q6: Intermediate polling states
**Q:** How does the agent wait between phases?
**A:** Dedicated polling states between spec → spec-to-code and spec-to-code → pr. Agent posts a confirmation request on the issue, polls for user reply at 20s intervals. In full-auto mode, these states are skipped.

## Existing Workflow Reuse

| Sub-workflow | What it provides | Reuse strategy |
|---|---|---|
| `github-spec-gen` | Issue creation, Q&A via comments, polling, artifact comments, spec generation | Direct sub-workflow reference |
| `spec-to-code` | Issue mode implementation with per-step push and issue updates | Direct sub-workflow reference (pass `owner/repo#N`) |
| `pr-lifecycle` | PR creation, CI monitoring, review handling, merge | Direct sub-workflow reference |

## Flow

```
start (create/attach issue)
  → spec (github-spec-gen sub-workflow)
    → decide-mode (user picks fast-forward or full-auto)
      → [fast-forward] confirm-implement (poll issue for go-ahead)
      → [full-auto] skip straight through
        → implement (spec-to-code in issue mode)
          → [fast-forward] confirm-pr (poll issue for go-ahead)
          → [full-auto] skip straight through
            → submit-pr (pr-lifecycle)
              → done
```
