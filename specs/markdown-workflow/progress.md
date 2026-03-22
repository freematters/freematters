# Progress: Markdown Workflow Format

## Step 2: Markdown Serializer
- **Files changed**: `src/markdown-serializer.ts` (new), `src/__tests__/markdown-serializer.test.ts` (new)
- **What was built**: `serializeMarkdown(fsm)` function that converts an `Fsm` object to `.workflow.md` format with YAML frontmatter, mermaid state diagram, guide, and state sections.
- **Tests**: 12 tests added, all passing
- **Notes**: State-level guide prepended to Instructions with `---` separator. Terminal states show `(none)` in transitions.
