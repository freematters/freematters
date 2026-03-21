# Progress

## Step 1: 重组 workflow 目录结构、更新代码与文档
- **Files changed**: `resolve-workflow.ts`, 8 workflow directories restructured, 2 skill directories renamed, `AGENTS.md`, `CLAUDE.md`, `README.md`, `install.ts`, `docs/design.md`, e2e test plans, `.github/workflows/code-review.yml`
- **What was built**: Restructured all workflows from flat `<name>.workflow.yaml` to `<name>/workflow.yaml` directory format with co-located scripts/resources. Updated resolve-workflow.ts search logic, renamed skills (`/fflow:start` → `/fflow`, `/fflow:create` → `/fflow-create`), updated all path references and documentation.
- **Tests**: 111 passing (all existing tests updated for new structure), biome lint/format clean
- **Notes**: Sub-agent needed `npm run build` before CLI integration tests could pass (dist/ not committed). No spec deviations.

## Step 2: Integration Test
- **Files changed**: `src/__tests__/resolve-workflow.integration.test.ts` (new)
- **What was built**: 7 integration tests across 3 groups: resolve-workflow + loadFsm cross-component validation (4 tests), search priority end-to-end (1 test), validate all 8 bundled workflows (2 tests).
- **Tests**: 118 passing (111 existing + 7 new), biome lint/format clean
- **Notes**: No spec deviations.
