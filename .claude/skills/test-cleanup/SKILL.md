---
name: test-cleanup
description: Review and remove redundant, low-value, heavily-mocked tests that don't verify real behavior. Use when you want to clean up test files — specify scope in natural language.
---

# Test Cleanup

Remove low-value tests from a codebase. Three phases: discover, review (parallel), execute (parallel).

## Input

The user provides a natural language scope description, optionally followed by `AUTO`.

- **Normal mode** (no `AUTO`): pause after Phase 2 review to ask the user for confirmation before executing deletions.
- **AUTO mode**: skip all confirmation prompts — proceed directly from Phase 2 review to Phase 3 execution, and after Phase 3 completes, invoke the `/pr` skill to create a PR.

## Testing Principles

These rules define what is "low-value" and should be deleted:

| Layer | Purpose | Mock policy | Keep when... |
|-------|---------|-------------|--------------|
| **Unit** | Complicated component logic, corner cases | Minimal mocks for direct deps only | Tests non-trivial logic, edge cases, or tricky algorithms |
| **Integration** | Cross-component interaction | May mock external services (network, DB) | Tests real interaction between 2+ internal components |
| **E2E** | Full lifecycle, external service interaction | No mocks at all | Tests real user-facing flows end to end |

### Delete Criteria

A test should be **deleted** if it matches ANY of:

1. **Mock-heavy unit test** — mocks dominate the test; the test verifies mock wiring, not real logic
2. **Trivial unit test** — tests a simple getter/setter/pass-through with no branching or edge cases
3. **Redundant coverage** — the same behavior is already tested by a higher-level integration or e2e test
4. **Mock-heavy "integration" test** — claims to be integration but mocks out every collaborator, making it effectively a unit test that tests nothing real
5. **Snapshot-only test** — asserts only on a snapshot with no behavioral assertions
6. **Test that validates framework behavior** — tests that the framework (e.g., vitest, express) works, not that your code works

### Keep Criteria

Do NOT delete tests that:

- Test genuinely complex logic (state machines, parsers, serializers, validators)
- Cover important corner cases or error paths that are hard to trigger via integration tests
- Are the only test covering a specific behavior
- Test cross-component contracts (even if they use some mocks for external deps)

## Phase 1: Discover

Based on the user's natural language description, find the target test files.

- Use Glob to find test files matching the user's scope (e.g., `**/*.test.ts`, specific directory, specific files)
- List all discovered files and their count
- Proceed to Phase 2

## Phase 2: Review (Parallel Agents)

### Batching Strategy

Instead of one agent per file, batch files into groups for balanced workload:

1. **Measure**: Get the line count of each discovered test file (use `wc -l`)
2. **Target batch size**: ~5 files per agent (adjust if total files < 10 — use fewer agents with more files each)
3. **Balance by length**: Sort files by line count descending, then assign each file to the batch with the smallest current total line count (greedy bin-packing). This ensures each agent reviews roughly the same amount of code, not just the same number of files.
4. **Create TODOs**: One TODO per batch (e.g., "Review batch 1: store.test.ts, utils.test.ts, ..."). Mark `in_progress` when its agent starts and `completed` when it returns.

Dispatch one Agent per batch. All agents run in parallel.

Each review agent receives this prompt template (note: the agent reviews ALL files in its batch):

```
You are reviewing a test file for low-value tests that should be deleted.

## Testing Principles

| Layer | Purpose | Mock policy |
|-------|---------|-------------|
| Unit | Complicated component logic, corner cases | Minimal mocks |
| Integration | Cross-component interaction | May mock external services |
| E2E | Full lifecycle | No mocks |

## Delete if ANY match:
1. Mock-heavy unit test — mocks dominate, tests mock wiring not real logic
2. Trivial unit test — simple getter/setter/pass-through, no branching
3. Redundant coverage — same behavior tested at higher level
4. Mock-heavy "integration" test — mocks everything, tests nothing real
5. Snapshot-only test — no behavioral assertions
6. Tests framework behavior, not application code

## Keep if ANY match:
- Genuinely complex logic (state machines, parsers, validators)
- Important corner cases hard to trigger otherwise
- Only test covering a specific behavior
- Cross-component contract tests

## Task

For EACH file in your batch, do the following:

1. Read the test file: {test_file_path}
2. Read the source file(s) it tests to understand what the code actually does
3. For EACH describe/test block, evaluate against the criteria above
4. Return a structured assessment per file:

### {test_file_path}

For each test block you recommend deleting, provide:
- The describe/test name (full nesting path)
- Which delete criterion it matches (1-6)
- One-line reason

For each test block you recommend keeping, provide:
- The describe/test name
- One-line reason why it's valuable

File summary: total tests, delete count, keep count.

## Files to review

{file_list_with_paths}

IMPORTANT: Be aggressive about deletion. The goal is fewer, better tests.
Do NOT write any code. Research only.
```

After all review agents complete:

1. Collect all deletion recommendations
2. Present a consolidated summary:
   - Per file: how many tests to delete vs keep, with reasons
   - Total across all files
3. **Normal mode**: Ask the user to confirm before proceeding to Phase 3
4. **AUTO mode**: Skip confirmation, proceed directly to Phase 3

## Phase 3: Execute (Parallel Agents)

After user confirms, batch files for execution using the same bin-packing strategy as Phase 2 (~5 files per agent, balanced by line count). Dispatch one Agent per batch. All agents run in parallel.

**Before dispatching agents**, create a TODO per batch (e.g., "Execute batch 1: store.test.ts, utils.test.ts, ..."). Mark `in_progress` when its agent starts and `completed` when it returns.

Each execution agent receives this prompt template:

```
You are deleting low-value tests from multiple test files.

## Files and tests to DELETE

{per_file_deletion_lists}

## Instructions

For EACH file in your batch:

1. Read the file
2. Remove each listed describe/test block completely
3. Clean up:
   - Remove unused imports that were only used by deleted tests
   - Remove unused mock setup (vi.mock, jest.mock, manual mocks) that was only used by deleted tests
   - Remove unused helper functions/fixtures only used by deleted tests
   - Remove empty describe blocks if all their children were deleted
4. Do NOT modify any test you are not deleting
5. Do NOT add new tests
6. Run the test file to verify remaining tests still pass: npm test -- {test_file_path}
7. If tests fail, investigate and fix (likely a missing import or setup that was shared)
```

After all execution agents complete:

1. Run the full test suite to verify nothing is broken
2. Report results: files modified, tests deleted, test suite status

## Phase 4: PR (AUTO mode only)

If running in AUTO mode, after Phase 3 succeeds:

1. Invoke the `/pr` skill to create a PR for the cleanup changes
