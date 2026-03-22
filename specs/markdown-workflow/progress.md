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

## Step 8: Integration Tests
- **Files changed**: `src/__tests__/markdown-roundtrip.test.ts` (new)
- **What was built**: 9 round-trip integration tests: YAML→MD→YAML (3), MD→YAML→MD (2), cross-format `from:` refs (2), complex workflow round-trips (2).
- **Tests**: 9 tests added, all passing (218 total)
- **Notes**: Uses `normalizeWhitespace()` for semantic comparison. State-level guide excluded from YAML→MD→YAML comparison (by design, it merges into Instructions).

## Step 5: Convert Command
- **Files changed**: `src/commands/markdown/convert.ts` (new), `src/__tests__/commands/markdown-convert.test.ts` (new), `src/cli.ts` (modified)
- **What was built**: `fflow markdown convert <file> [-o <output>] [-j]` CLI command. Auto-detects direction by extension, loads with `loadFsm()`, serializes to opposite format.
- **Tests**: 7 tests added, all passing (225 total)
- **Notes**: Default output: same basename with swapped extension. `ARGS_INVALID` for unsupported extensions.

## Code Review (Round 1)
- **Verdict**: PASS after fixes
- **Issues found**: 2 major, 4 medium, 4 minor
- **Fixed**: All major + all medium (6 total)
  - Added `# Workflow` h1 heading to serializer output
  - Added guard for states without prompt (workflow delegation)
  - Standardized on `js-yaml` (removed `yaml` package)
  - Removed dead `append-todos` branch in tag handler
  - Removed double `resolve()` in convert command
  - Added `workflow.yml` probing in `probeDir()`
- **Known limitations**: `from:`, `workflow:`, `extends_guide` directives are resolved by `loadFsm()` before serialization — round-trip doesn't preserve these directives (by design)
