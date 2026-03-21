import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { runCore } from "../commands/run.js";

const DONE_ONLY_FSM = `
version: 1
initial: done
states:
  done:
    prompt: "Say hello"
    transitions: {}
`;

let tmp: string;
let fsmPath: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freeflow-model-test-"));
  fsmPath = join(tmp, "done-only.workflow.yaml");
  writeFileSync(fsmPath, DONE_ONLY_FSM);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("fflow run --model", () => {
  test("haiku model is passed to Claude session", async () => {
    const root = join(tmp, "store");
    const { runId, isError } = await runCore({
      fsmPath,
      root,
      model: "haiku",
      logFn: () => {},
    });

    expect(isError).toBe(false);

    // The session.jsonl symlink should exist in the run directory
    const sessionLog = join(root, "runs", runId, "session.jsonl");
    expect(existsSync(sessionLog)).toBe(true);

    // Parse JSONL and find assistant messages with model field
    const lines = readFileSync(sessionLog, "utf-8").trim().split("\n");
    const models = lines
      .map((line) => {
        try {
          const obj = JSON.parse(line);
          return obj?.message?.model ?? obj?.data?.model ?? null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m: string) => m.includes("haiku"))).toBe(true);
  }, 120_000);
});
