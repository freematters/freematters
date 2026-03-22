# Review Round 1

## Verdict: PASS (with minor fixes)

| Severity | Count |
|----------|-------|
| 🔴 Major | 0 |
| 🟠 Medium | 2 |
| 🟡 Minor | 4 |

## 🟠 Medium

1. **`alreadyVisited` mutable closure in goto.ts** — `let` variable mutated inside `withLock` callback, read outside. Should return it from the callback instead.
2. **`updateMeta` double-write in start.ts** — `initRun` writes meta, then `updateMeta` re-reads and re-writes to add `lite: true`. Should pass `lite` into the initial meta object.

## 🟡 Minor (not fixing)

1. Duplicated `formatDuration` logic in goto.ts — pre-existing, not introduced by this PR
2. `formatLiteCard` missing `fsmGuide` parameter — design explicitly notes generic form suffices
3. `uniqueRunId` helper duplicated across test files — cosmetic
4. `visited_states`/`lite` not exposed in JSON output — not in requirements
