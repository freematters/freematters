import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the Agent SDK before importing anything that uses it
const mockQueryResults: Array<{ type: string; [key: string]: unknown }> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    return (async function* () {
      for (const msg of mockQueryResults) {
        yield msg;
      }
    })();
  }),
  createSdkMcpServer: vi.fn(() => ({ __mock: true })),
  tool: vi.fn((name: string, desc: string, schema: unknown, handler: unknown) => ({
    name,
    desc,
    schema,
    handler,
  })),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { EmbeddedRun } from "../../e2e/embedded-run.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-embedded-run-"));
  mockQueryResults.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writeTerminalFsm(dir: string): string {
  const fsmPath = join(dir, "terminal.fsm.yaml");
  writeFileSync(
    fsmPath,
    `version: 1
initial: done
guide: "Terminal workflow"
states:
  done:
    prompt: "All done"
    transitions: {}
`,
  );
  return fsmPath;
}

describe("EmbeddedRun", () => {
  test("start() launches an Agent SDK session", async () => {
    const fsmPath = writeTerminalFsm(tmp);
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();
    expect(query).toHaveBeenCalled();
  });

  test("populates runId and storeRoot", async () => {
    const fsmPath = writeTerminalFsm(tmp);
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();
    expect(run.getRunId()).toBeTruthy();
    expect(run.getStoreRoot()).toBe(tmp);
  });

  test("turn_complete contains agent result text", async () => {
    const fsmPath = writeTerminalFsm(tmp);
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Final answer",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    const msg = await run.getBus().waitForMessage(5000);
    expect(msg.type).toBe("turn_complete");
    expect(msg.output).toContain("Final answer");
  });

  test("store files are created", async () => {
    const fsmPath = writeTerminalFsm(tmp);
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();
    await run.getBus().waitForMessage(5000);

    const runId = run.getRunId();
    expect(existsSync(join(tmp, "runs", runId, "snapshot.json"))).toBe(true);
    expect(existsSync(join(tmp, "runs", runId, "events.jsonl"))).toBe(true);
  });

  test("error produces turn_complete with error message", async () => {
    const run = new EmbeddedRun("/nonexistent.yaml", { root: tmp });
    await run.start();

    const msg = await run.getBus().waitForMessage(5000);
    expect(msg.type).toBe("turn_complete");
    expect(msg.output).toContain("[embedded error]");
  });
});
