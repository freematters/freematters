/**
 * Step 7 — cross-cutting integration tests for the `extends:` +
 * sub-workflow refactor.
 *
 * These tests exercise the loader and runtime together, on surfaces that
 * only make sense once every other step is in place:
 *
 *   1. Full-stack migrated workflow run (real `issue-to-spec` YAML):
 *      verify that a start + goto sequence produces cards whose prompts
 *      reflect the merged `{{ super }}` inheritance at runtime.
 *   2. Sub-workflow guide + inheritance interaction: construct three
 *      synthetic YAMLs (parent, child-with-`extends:`-and-embedded-sub,
 *      sub) and verify the workflow-level guide merges via `{{ super }}`,
 *      and the embedded sub-workflow's guide surfaces exactly once on
 *      entry to its initial state.
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { abort } from "../commands/abort.js";
import { goto } from "../commands/goto.js";
import { start } from "../commands/start.js";
import { Store } from "../store.js";
import { cleanupTempDir, createTempDir, uniqueRunId } from "./fixtures.js";

let tmp: string;

afterEach(() => {
  if (tmp) cleanupTempDir(tmp);
});

function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((str: string) => {
    writes.push(str);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return writes.join("");
}

// ─── Test 1: full-stack migrated workflow run ────────────────────

describe("extends integration — migrated issue-to-spec workflow", () => {
  test("start + goto requirements surfaces merged {{ super }} prompt", () => {
    tmp = createTempDir("ext-int-migrated");
    const root = join(tmp, "root");
    const runId = uniqueRunId("ext-int-migrated");

    // Real migrated workflow file on disk.
    const fsmPath = resolve(
      __dirname,
      "..",
      "..",
      "workflows",
      "issue-to-spec",
      "workflow.yaml",
    );

    // Start — initial state is `create-issue`.
    const startOut = captureStdout(() => {
      start({ fsmPath, runId, root, json: false });
    });
    expect(startOut).toContain("create-issue");
    // Workflow-level guide is rendered via the start header and combines the
    // parent `spec-gen` guide with the child's `{{ super }}` extension.
    // Parent marker: "Spec-Gen — generates a complete specification".
    // Child marker: "### Lite Mode".
    expect(startOut).toContain("Spec-Gen");
    expect(startOut).toContain("Lite Mode");

    // Transition via `start with requirements` -> requirements.
    const gotoOut = captureStdout(() => {
      goto({
        target: "requirements",
        runId,
        on: "start with requirements",
        root,
        json: false,
      });
    });

    // Parent prompt marker: "## Requirements Clarification".
    // Child addition (via `{{ super }}` + new content): "Issue Platform Adaptation".
    expect(gotoOut).toContain("requirements");
    expect(gotoOut).toContain("Requirements Clarification");
    expect(gotoOut).toContain("Issue Platform Adaptation");

    // Sanity: the literal `{{ super }}` placeholder must have been substituted
    // out by the loader, not leaked through to the rendered prompt.
    expect(gotoOut).not.toContain("{{ super }}");

    abort({ runId, root, json: false });
  });
});

// ─── Test 2: sub-workflow guide + inheritance interaction ────────

describe("extends integration — sub-workflow guide + child extends parent", () => {
  test("guide merges across extends; sub-workflow guide shown once on entry", () => {
    tmp = createTempDir("ext-int-sub");
    const root = join(tmp, "root");
    const runId = uniqueRunId("ext-int-sub");

    // parent.yaml — minimal workflow with only `a` and `done`. We keep parent
    // deliberately small so the child can introduce the sub-workflow as a
    // NEW state (the `extends:` overlay does not copy `workflow:` onto an
    // existing parent state, so `workflow:` only sticks on brand-new states).
    const parentYaml = `version: 1.4
guide: "parent guide"
initial: a
states:
  a:
    prompt: "prompt a"
    transitions:
      finish: done
  done:
    prompt: "parent done"
    transitions: {}
`;
    // sub.yaml — embedded sub-workflow with its own guide, two steps then done.
    const subYaml = `version: 1
guide: "sub guide here"
initial: s1
states:
  s1:
    prompt: "sub step 1"
    transitions:
      next: s2
  s2:
    prompt: "sub step 2"
    transitions:
      finish: done
  done:
    prompt: "sub done"
    transitions: {}
`;
    // child.yaml — extends parent, rewires `a` to route into new state `b`
    // which embeds the sub-workflow. Adds `b` (workflow embed) and keeps
    // the inherited `done` as the terminal. Extends the guide via {{ super }}.
    const childYaml = `version: 1.4
extends: ./parent.yaml
guide: |
  {{ super }}
  child extras
initial: a
states:
  a:
    transitions:
      next: b
  b:
    workflow: ./sub.yaml
    transitions:
      completed: done
`;
    const parentPath = join(tmp, "parent.yaml");
    const subPath = join(tmp, "sub.yaml");
    const childPath = join(tmp, "child.yaml");
    writeFileSync(parentPath, parentYaml, "utf-8");
    writeFileSync(subPath, subYaml, "utf-8");
    writeFileSync(childPath, childYaml, "utf-8");

    // Start at child's initial state `a`.
    const startOut = captureStdout(() => {
      start({ fsmPath: childPath, runId, root, json: false });
    });
    // Workflow-level guide = merge of parent guide + child extension via {{ super }}.
    expect(startOut).toContain("parent guide");
    expect(startOut).toContain("child extras");
    expect(startOut).not.toContain("{{ super }}");

    const store = new Store(root);
    const snap0 = store.readSnapshot(runId);
    expect(snap0?.state).toBe("a");
    // State `a` has no per-state guide, so shown_guides should not include it.
    expect(snap0?.shown_guides ?? []).not.toContain("a");

    // Goto into the embedded sub-workflow's initial state: composed name `b/s1`.
    // Parent state `a` has transition `next: b`; inside the composed FSM, `b`
    // becomes the sub-workflow's entry — composed name is `b/s1` and the
    // transition label is preserved.
    const gotoS1Out = captureStdout(() => {
      goto({ target: "b/s1", runId, on: "next", root, json: false });
    });
    // Sub-workflow guide surfaces exactly once here, on the child-initial entry.
    expect(gotoS1Out).toContain("sub guide here");

    // Snapshot records the composed state name in shown_guides.
    const snap1 = store.readSnapshot(runId);
    expect(snap1?.state).toBe("b/s1");
    expect(snap1?.shown_guides).toContain("b/s1");

    // Goto to sub-workflow step 2 — the sub guide MUST NOT reappear.
    const gotoS2Out = captureStdout(() => {
      goto({ target: "b/s2", runId, on: "next", root, json: false });
    });
    expect(gotoS2Out).not.toContain("sub guide here");

    // And `b/s2` has no guide of its own, so shown_guides is unchanged.
    const snap2 = store.readSnapshot(runId);
    expect(snap2?.state).toBe("b/s2");
    expect(snap2?.shown_guides).toEqual(snap1?.shown_guides);

    abort({ runId, root, json: false });
  });
});
