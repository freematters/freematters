# Summary — issue-to-pr workflow

## Project Overview

A composition workflow that connects GitHub issues to merged pull requests. The agent creates
or attaches to a GitHub issue, gathers requirements via issue comments, generates a full spec
using `github-spec-gen`, implements via `spec-to-code` in issue mode, and submits a PR via
`pr-lifecycle`. Two modes are supported: fast-forward (semi-auto with polling gates between
phases) and full-auto (no stops). The workflow is pure YAML composition — no new TypeScript.

## Artifacts

| Artifact | Description |
|----------|-------------|
| `rough-idea.md` | Original user input describing the workflow concept |
| `requirements.md` | Q&A capturing input modes, execution modes, polling, and reuse strategy |
| `design.md` | Full design with architecture diagram, component breakdown, data models |
| `plan.md` | 2-step implementation plan: create workflow YAML + validate schema |

## Key Decisions

- **Reuse over rebuild**: Composes 3 existing sub-workflows via `workflow:` references
- **`extends_guide` from github-spec-gen**: Inherits all issue interaction patterns (polling, artifacts, comments)
- **No new TypeScript**: Pure YAML composition leveraging existing infrastructure
- **No e2e tests**: Sub-workflows have their own tests; full pipeline e2e too expensive for YAML composition
- **Two modes**: Fast-forward (polls at gates) vs full-auto (skips gates entirely)

## Next Steps

1. Create `packages/freeflow/workflows/issue-to-pr/workflow.yaml` (Step 1 of plan)
2. Write schema validation test (Step 2 of plan)
3. Register the workflow as a local command in CLAUDE.md if desired
