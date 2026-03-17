import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestPlan } from "./parser.js";
import type { TranscriptEntry } from "./transcript-logger.js";

export type StepVerdict = "PASS" | "FAIL";

export interface StepResult {
  step: number;
  name: string;
  verdict: StepVerdict;
  duration: number | null;
  evidence: string | null;
  judgmentContent: string | null;
}

export interface JsonReport {
  verdict: StepVerdict;
  steps_passed: number;
  steps_failed: number;
}

/**
 * Read transcript.jsonl from testDir and parse into entries.
 */
function readTranscript(testDir: string): TranscriptEntry[] {
  const path = join(testDir, "transcript.jsonl");
  let content: string;
  try {
    content = readFileSync(path, "utf-8").trim();
  } catch {
    return [];
  }
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as TranscriptEntry);
}

/**
 * Group transcript entries by step number.
 */
function groupByStep(entries: TranscriptEntry[]): Map<number, TranscriptEntry[]> {
  const groups = new Map<number, TranscriptEntry[]>();
  for (const entry of entries) {
    const existing = groups.get(entry.step) ?? [];
    existing.push(entry);
    groups.set(entry.step, existing);
  }
  return groups;
}

/**
 * Compute per-step results from transcript entries and the test plan.
 */
function computeStepResults(plan: TestPlan, entries: TranscriptEntry[]): StepResult[] {
  const groups = groupByStep(entries);
  const results: StepResult[] = [];

  for (let i = 0; i < plan.steps.length; i++) {
    const stepNum = i + 1;
    const stepEntries = groups.get(stepNum) ?? [];
    const step = plan.steps[i];

    // Find the last judgment entry for this step
    const judgments = stepEntries.filter((e) => e.type === "judgment");
    const lastJudgment = judgments.length > 0 ? judgments[judgments.length - 1] : null;

    // Determine verdict from judgment content
    let verdict: StepVerdict = "FAIL";
    let judgmentContent: string | null = null;
    let evidence: string | null = null;

    if (lastJudgment) {
      judgmentContent = lastJudgment.content;
      evidence = lastJudgment.evidence ?? null;
      // Check if content starts with or contains "PASS"
      if (/^PASS\b/i.test(lastJudgment.content)) {
        verdict = "PASS";
      }
    } else {
      judgmentContent = "No judgment — inconclusive";
    }

    // Compute duration from first to last entry timestamps for this step
    let duration: number | null = null;
    if (stepEntries.length >= 2) {
      const first = new Date(stepEntries[0].ts).getTime();
      const last = new Date(stepEntries[stepEntries.length - 1].ts).getTime();
      duration = last - first;
    } else if (stepEntries.length === 1) {
      duration = 0;
    }

    results.push({
      step: stepNum,
      name: step.name,
      verdict,
      duration,
      evidence,
      judgmentContent,
    });
  }

  return results;
}

/**
 * Format a duration in milliseconds as a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Generate a markdown test report from the transcript and test plan.
 */
export function generateReport(plan: TestPlan, testDir: string): string {
  const entries = readTranscript(testDir);
  const stepResults = computeStepResults(plan, entries);

  const allPass = stepResults.every((r) => r.verdict === "PASS");
  const overallVerdict: StepVerdict = allPass ? "PASS" : "FAIL";

  // Compute total duration from first to last transcript entry
  let totalDuration = "N/A";
  if (entries.length >= 2) {
    const first = new Date(entries[0].ts).getTime();
    const last = new Date(entries[entries.length - 1].ts).getTime();
    totalDuration = formatDuration(last - first);
  }

  const lines: string[] = [];

  // Header
  lines.push(`# Test Report: ${plan.name}`);
  lines.push(`**Date**: ${new Date().toISOString()}`);
  lines.push(`**Verdict**: ${overallVerdict}`);
  lines.push(`**Duration**: ${totalDuration}`);
  lines.push("");

  // Results table
  lines.push("## Results");
  lines.push("");
  lines.push("| Step | Name | Verdict | Duration |");
  lines.push("|------|------|---------|----------|");
  for (const result of stepResults) {
    const dur = result.duration !== null ? formatDuration(result.duration) : "N/A";
    lines.push(`| ${result.step} | ${result.name} | ${result.verdict} | ${dur} |`);
  }
  lines.push("");

  // Failures section (only if there are failures)
  const failures = stepResults.filter((r) => r.verdict === "FAIL");
  if (failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const f of failures) {
      const planStep = plan.steps[f.step - 1];
      lines.push(`### Step ${f.step}: ${f.name}`);
      if (planStep.expected) {
        lines.push(`**Expected**: ${planStep.expected}`);
      }
      lines.push(`**Observed**: ${f.judgmentContent}`);
      if (f.evidence) {
        lines.push(`**Evidence**: ${f.evidence}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate a JSON report summary.
 * Returns { verdict, steps_passed, steps_failed }.
 */
export function generateJsonReport(plan: TestPlan, testDir: string): JsonReport {
  const entries = readTranscript(testDir);
  const stepResults = computeStepResults(plan, entries);

  const stepsPassed = stepResults.filter((r) => r.verdict === "PASS").length;
  const stepsFailed = stepResults.filter((r) => r.verdict === "FAIL").length;
  const verdict: StepVerdict = stepsFailed === 0 ? "PASS" : "FAIL";

  return {
    verdict,
    steps_passed: stepsPassed,
    steps_failed: stepsFailed,
  };
}
