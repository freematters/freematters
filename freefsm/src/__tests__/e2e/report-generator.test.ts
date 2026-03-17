import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TestPlan } from "../../e2e/parser.js";
import { generateJsonReport, generateReport } from "../../e2e/report-generator.js";
import type { TranscriptEntry } from "../../e2e/transcript-logger.js";

const SAMPLE_PLAN: TestPlan = {
  name: "Basic workflow test",
  setup: ["Install freefsm"],
  steps: [
    {
      name: "Start workflow",
      action: "Run `freefsm start workflow.yaml`",
      expected: "Run initializes with start state",
    },
    {
      name: "Transition",
      action: "Run `freefsm goto done --on next`",
      expected: "State transitions to done",
    },
  ],
  expectedOutcomes: ["Workflow completes successfully"],
  cleanup: ["Remove temp dir"],
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-report-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeTranscript(entries: TranscriptEntry[]): void {
  const content = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(join(tmp, "transcript.jsonl"), content, "utf-8");
}

describe("generateReport — markdown output", () => {
  test("2 PASS steps → overall PASS, both steps shown as PASS", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "action",
        step: 1,
        content: "Running step 1",
      },
      {
        ts: "2026-03-17T12:00:02.000Z",
        type: "judgment",
        step: 1,
        content: "PASS: Run initialized correctly",
        evidence: "exit_code=0",
      },
      {
        ts: "2026-03-17T12:00:03.000Z",
        type: "action",
        step: 2,
        content: "Running step 2",
      },
      {
        ts: "2026-03-17T12:00:05.000Z",
        type: "judgment",
        step: 2,
        content: "PASS: Transition succeeded",
        evidence: "state=done",
      },
    ];
    writeTranscript(entries);

    const report = generateReport(SAMPLE_PLAN, tmp);

    expect(report).toContain("# Test Report: Basic workflow test");
    expect(report).toContain("**Verdict**: PASS");
    // Results table should list both steps as PASS
    expect(report).toContain("| 1 |");
    expect(report).toContain("| 2 |");
    expect(report).toMatch(/Start workflow.*PASS/);
    expect(report).toMatch(/Transition.*PASS/);
    // Should not have a Failures section
    expect(report).not.toContain("## Failures");
  });

  test("1 FAIL step → overall FAIL with failure details and evidence", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "action",
        step: 1,
        content: "Running step 1",
      },
      {
        ts: "2026-03-17T12:00:02.000Z",
        type: "judgment",
        step: 1,
        content: "PASS: Run initialized correctly",
      },
      {
        ts: "2026-03-17T12:00:03.000Z",
        type: "action",
        step: 2,
        content: "Running step 2",
      },
      {
        ts: "2026-03-17T12:00:08.000Z",
        type: "judgment",
        step: 2,
        content: "FAIL: Transition failed, state remained at start",
        evidence: "exit_code=2, stderr=INVALID_TRANSITION",
      },
    ];
    writeTranscript(entries);

    const report = generateReport(SAMPLE_PLAN, tmp);

    expect(report).toContain("**Verdict**: FAIL");
    expect(report).toMatch(/Start workflow.*PASS/);
    expect(report).toMatch(/Transition.*FAIL/);
    // Should have a Failures section with details
    expect(report).toContain("## Failures");
    expect(report).toContain("Step 2: Transition");
    expect(report).toContain("INVALID_TRANSITION");
  });

  test("report includes timing information per step", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "action",
        step: 1,
        content: "Running step 1",
      },
      {
        ts: "2026-03-17T12:00:02.300Z",
        type: "judgment",
        step: 1,
        content: "PASS: Step 1 passed",
      },
      {
        ts: "2026-03-17T12:00:03.000Z",
        type: "action",
        step: 2,
        content: "Running step 2",
      },
      {
        ts: "2026-03-17T12:00:08.100Z",
        type: "judgment",
        step: 2,
        content: "PASS: Step 2 passed",
      },
    ];
    writeTranscript(entries);

    const report = generateReport(SAMPLE_PLAN, tmp);

    // Should contain timing info (duration column in table)
    expect(report).toContain("Duration");
    // Step 1: 2.3s, Step 2: 5.1s
    expect(report).toContain("2.3s");
    expect(report).toContain("5.1s");
  });

  test("report includes date from first transcript entry and total duration", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "action",
        step: 1,
        content: "Running step 1",
      },
      {
        ts: "2026-03-17T12:00:10.000Z",
        type: "judgment",
        step: 1,
        content: "PASS: Done",
      },
    ];
    writeTranscript(entries);

    const report = generateReport(SAMPLE_PLAN, tmp);

    expect(report).toContain("**Date**: 2026-03-17T12:00:00.000Z");
    expect(report).toContain("**Duration**:");
  });

  test("step without judgment defaults to FAIL with inconclusive", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "action",
        step: 1,
        content: "Running step 1",
      },
      // No judgment for step 1
      {
        ts: "2026-03-17T12:00:05.000Z",
        type: "judgment",
        step: 2,
        content: "PASS: Step 2 passed",
      },
    ];
    writeTranscript(entries);

    const report = generateReport(SAMPLE_PLAN, tmp);

    expect(report).toContain("**Verdict**: FAIL");
    expect(report).toMatch(/Start workflow.*FAIL/);
    expect(report).toContain("inconclusive");
  });

  test("empty transcript produces FAIL for all steps", () => {
    writeFileSync(join(tmp, "transcript.jsonl"), "", "utf-8");

    const report = generateReport(SAMPLE_PLAN, tmp);

    expect(report).toContain("**Verdict**: FAIL");
  });
});

describe("generateJsonReport — JSON output mode", () => {
  test("returns { verdict, steps_passed, steps_failed } for all PASS", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "judgment",
        step: 1,
        content: "PASS: Step 1 passed",
      },
      {
        ts: "2026-03-17T12:00:05.000Z",
        type: "judgment",
        step: 2,
        content: "PASS: Step 2 passed",
      },
    ];
    writeTranscript(entries);

    const result = generateJsonReport(SAMPLE_PLAN, tmp);

    expect(result).toEqual({
      verdict: "PASS",
      steps_passed: 2,
      steps_failed: 0,
    });
  });

  test("returns FAIL with correct counts for mixed results", () => {
    const entries: TranscriptEntry[] = [
      {
        ts: "2026-03-17T12:00:00.000Z",
        type: "judgment",
        step: 1,
        content: "PASS: Step 1 passed",
      },
      {
        ts: "2026-03-17T12:00:05.000Z",
        type: "judgment",
        step: 2,
        content: "FAIL: Step 2 failed",
      },
    ];
    writeTranscript(entries);

    const result = generateJsonReport(SAMPLE_PLAN, tmp);

    expect(result).toEqual({
      verdict: "FAIL",
      steps_passed: 1,
      steps_failed: 1,
    });
  });
});
