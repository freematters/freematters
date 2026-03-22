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
