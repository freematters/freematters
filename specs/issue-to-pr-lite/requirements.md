### Rough Idea

Create "Issue to PR Lite" — a lighter version of issue-to-pr with simplified spec-gen output:
- plan.md: only 2 steps (implementation + e2e test)
- design.md: simplified with fewer sections
- Rest of the workflow unchanged

### Requirements Q&A

#### Q1: Should this be a separate workflow YAML file or a mode/flag on the existing issue-to-pr?

**A:** Separate workflow YAML file.

#### Q2: Which sections should the simplified design.md keep?

**A:** Keep sections 1 (Overview), 2 (Goal & Constraints), 7 (E2E Testing). Merge sections 3 (Architecture), 4 (Components & Interfaces), 5 (Data Models), 6 (Integration Testing) into one combined section. Drop section 8 (Error Handling).

#### Q3: Should the implementation step in plan.md be monolithic or have sub-item guidance?

**A:** Option B — single "Implement the feature" step with bullet points referencing design components as guidance.

#### Q4: Should e2e tests be included for this feature?

**A:** Yes — write an e2e test plan that runs the lite workflow and verifies it produces simplified artifacts.

#### Q5: How should users invoke this workflow?

**A:** `/fflow issue-to-pr-lite` — separate workflow name.

### Summary of Requirements

1. **Implementation**: Separate workflow YAML file (`issue-to-pr-lite/workflow.yaml`), not a mode on existing workflow.
2. **Workflow name**: `issue-to-pr-lite`, invoked as `/fflow issue-to-pr-lite`.
3. **Simplified design.md** sections:
   - Overview (kept as-is)
   - Goal & Constraints (kept as-is)
   - Architecture & Components (merged from: Architecture Overview, Components & Interfaces, Data Models, Integration Testing)
   - E2E Testing (kept as-is)
   - Error Handling (dropped)
4. **Simplified plan.md**: Only 2 steps:
   - Step 1: Implement the feature (with bullet sub-items referencing design components)
   - Step 2: E2E test
5. **Other workflow phases unchanged**: Requirements gathering, research, spec-to-code, pr-lifecycle remain the same as issue-to-pr.
6. **E2E testing required**: Write a test plan that runs the lite workflow and verifies it produces simplified artifacts.
7. **Composition**: Same sub-workflow composition as issue-to-pr (github-spec-gen-lite → spec-to-code → pr-lifecycle), with a lite variant of the spec-gen sub-workflow.
