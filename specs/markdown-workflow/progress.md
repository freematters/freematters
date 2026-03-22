# Progress: Markdown Workflow Format

## Step 2: Markdown Serializer
- **Files changed**: `src/markdown-serializer.ts` (new), `src/__tests__/markdown-serializer.test.ts` (new)
- **What was built**: `serializeMarkdown(fsm)` function that converts an `Fsm` object to `.workflow.md` format with YAML frontmatter, mermaid state diagram, guide, and state sections.
- **Tests**: 12 tests added, all passing
- **Notes**: State-level guide prepended to Instructions with `---` separator. Terminal states show `(none)` in transitions.

## Step 3: YAML Serializer
- **Files changed**: `src/yaml-serializer.ts` (new), `src/__tests__/yaml-serializer.test.ts` (new)
- **What was built**: `serializeYaml(fsm)` function that converts an `Fsm` object to YAML format using `js-yaml` dump with block scalar style for multi-line content.
- **Tests**: 9 tests added, all passing
- **Notes**: Optional fields (guide, allowed_tools, todos, per-state guide) omitted when absent. Round-trip verified.

## Step 6: Workflow Resolution
- **Files changed**: `src/resolve-workflow.ts` (modified), `src/__tests__/resolve-workflow.test.ts` (new)
- **What was built**: Updated `probeDir()` to discover `.workflow.md` files and throw `WORKFLOW_AMBIGUOUS` when both formats exist. Added `.workflow.md` to `hasWorkflowExtension()`.
- **Tests**: 5 tests added, all passing (+ 8 existing pass)
- **Notes**: YAML checked first, then MD. Flat filename regex updated for `.workflow.md`.

## Step 1: Markdown Parser
- **Files changed**: `src/markdown-parser.ts` (new), `src/__tests__/markdown-parser.test.ts` (new), `package.json` (deps added)
- **What was built**: `parseMarkdownWorkflow(content)` that produces the same raw doc shape as `yamlLoad()`. Parses frontmatter, guide, states (instructions/todos/transitions), `<freeflow>` tags.
- **Tests**: 14 tests added (11 valid cases, 3 error cases), all passing
- **Notes**: Added `unified`, `remark-parse`, `remark-frontmatter`, `yaml`, `@types/mdast` deps. Supports both `→` and `->` separators.

## Step 7: Skills (fix + convert)
- **Files changed**: `skills/markdown-fix/SKILL.md` (new), `skills/markdown-convert/SKILL.md` (new)
- **What was built**: Two agent skills — `/fflow markdown fix` (format spec + validation checklist + fix instructions) and `/fflow markdown convert` (CLI usage + verification steps + edge cases).
- **Tests**: None (agent-driven skills)
- **Notes**: Fix skill contains the canonical format spec for the agent to validate against.

## Step 4: Loader Integration
- **Files changed**: `src/fsm.ts` (modified), `src/__tests__/fsm.test.ts` (added tests), `src/__tests__/fixtures/` (3 new fixtures)
- **What was built**: Wired `parseMarkdownWorkflow()` into `loadFsmInternal()` with extension-based format detection. Cross-format `from:` references work in both directions.
- **Tests**: 4 tests added, all passing (209 total)
- **Notes**: Created test fixtures for MD-only, MD→YAML refs, and YAML→MD refs.
