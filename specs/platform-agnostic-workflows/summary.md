# Summary: Platform-Agnostic Workflow Consolidation

## Project Overview

Consolidate 8 platform-specific (GitHub/GitLab) workflow variants and 3 lite variants
into 4 unified, platform-agnostic workflows. Platform differences are handled via
conditional branches in YAML prompts. Python scripts remain separate per platform.
Lite mode becomes a `--lite` flag instead of separate workflows.

## Artifacts

| Artifact | Description |
|----------|-------------|
| [rough-idea.md](rough-idea.md) | Original consolidation idea and current state |
| [requirements.md](requirements.md) | 9 Q&A entries covering platform handling, naming, lite mode, migration |
| [design.md](design.md) | Architecture, 4 components (pr-lifecycle, issue-to-spec, issue-to-pr, spec-gen), data models, integration tests, e2e scenarios |
| [plan.md](plan.md) | 6-step implementation plan with dependency graph |
| [e2e.md](e2e.md) | 3 e2e test scenarios: GitHub issue-to-pr, GitLab issue-to-pr, spec-gen lite mode |

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Platform conditionals in YAML prompts | Consistent with existing spec-to-code pattern; keeps single source of truth per workflow |
| Keep Python scripts separate per platform | Scripts have significant API differences; merging adds complexity without reducing duplication meaningfully |
| Lite as mode flag, not separate workflow | Eliminates 3 workflow directories; differences are small (2 states) and fit naturally as conditionals |
| Scripts in `scripts/` subdirectory | Unified workflow needs scripts from both platforms; `scripts/` keeps them organized under one directory |
| Direct deletion, no compatibility period | Internal tooling with no external consumers; clean break is simpler |

## Next Steps

1. Run `/spec-to-code ./specs/platform-agnostic-workflows/` to implement the plan
2. After implementation, run e2e tests on `freematters/testbed` (GitHub) and `ran.xian/testproj` (GitLab)
3. Clean up test PRs/MRs and issues after e2e verification
