# Summary — mr-lifecycle v2

## Project Overview

Redesign of the mr-lifecycle FSM workflow to replace the `!fix` mechanism with a unified `@bot` interaction model, separate review-thread resolve responsibility (mr-lifecycle only comments, code-review pipeline resolves), simplify the state machine (merge two polling states into one `poll`), and add guardrails (blocker-only auto-fix, 3-round limit). Also introduces `/bot-review` as the manual trigger for code-review after initial PR creation.

## Artifacts

| File | Description |
|------|-------------|
| `specs/mr-lifecycle-v2/rough-idea.md` | Original user input |
| `specs/mr-lifecycle-v2/requirements.md` | Q&A record (24 questions) |
| `specs/mr-lifecycle-v2/design.md` | Authoritative design spec — requirements, architecture, components, data models, acceptance criteria |
| `specs/mr-lifecycle-v2/plan.md` | 7-step incremental implementation plan |
| `specs/mr-lifecycle-v2/manual-e2e.md` | Manual E2E testing guide (13 scenarios) |
| `specs/mr-lifecycle-v2/summary.md` | This summary |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Replace `!fix` with `@bot` | More flexible — supports both conversation and code changes. Eliminates dedup issues. |
| `[from bot]` prefix for dedup | mr-lifecycle posts as user identity, so prefix is the only reliable signal for dedup. |
| Only auto-fix blocker, skip major | Major findings are often subjective; auto-fixing risks churn. |
| 3-round auto-fix limit | Prevents infinite fix loops. `@bot` requests are exempt. |
| mr-lifecycle never resolves threads | Resolve is the reviewer's decision. Code-review pipeline handles it (taq-runner pattern). |
| Merge into single `poll` state | Two polling states were redundant. One state monitors all events. |
| Extract rebase from polling | Polling only detects; rebase goes through normal check → fix → push flow. |
| `/bot-review` via `issue_comment` | GitHub has no custom slash commands. `issue_comment` event is the standard approach. |
| Code-review auto on PR open only | Avoids noisy re-reviews on every push. Subsequent reviews are manual. |
| User priority over bot review | mr-lifecycle is the author's assistant; user is the owner. |

## Next Steps

1. Execute `plan.md` steps 1–7 in order
2. Each step modifies `mr-lifecycle.fsm.yaml` and/or `code-review.fsm.yaml`
3. Final validation via `manual-e2e.md` scenarios on a real PR
