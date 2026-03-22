# Implementation Summary — issue-to-pr workflow

## Overview

Created the `issue-to-pr` workflow — a pure YAML composition that connects GitHub issues to merged pull requests. It composes three existing sub-workflows (`github-spec-gen`, `spec-to-code`, `pr-lifecycle`) with inline gate states for mode-dependent user confirmation via issue polling. Supports two modes: full-auto (no stops) and fast-forward (polls at gates).

## Steps Completed

| Step | Title | Commit |
|------|-------|--------|
| 1 | Create the issue-to-pr workflow YAML | `0453516` |
| 2 | Validate schema loads and expands correctly | `8e4c58d` |

## Test Summary

- 7 new tests added (schema validation: 5, path reachability: 2)
- 195 total tests, all passing
- Lint clean (biome check)

## Files Created/Modified

| File | Description |
|------|-------------|
| `packages/freeflow/workflows/issue-to-pr/workflow.yaml` | New workflow YAML composing 3 sub-workflows with inline gate states |
| `packages/freeflow/src/__tests__/workflow-issue-to-pr.test.ts` | Schema validation and path reachability tests |

## How to Run

```bash
npm run build
npm test                           # run all tests
fflow start packages/freeflow/workflows/issue-to-pr/workflow.yaml --run-id my-run
```

## Remaining Work

- Register as a local command in CLAUDE.md (e.g., `/issue-to-pr`)
- Manual testing with a real GitHub repo to verify end-to-end flow
- Consider adding a skill file (`skills/issue-to-pr/SKILL.md`) for `/fflow issue-to-pr` invocation
