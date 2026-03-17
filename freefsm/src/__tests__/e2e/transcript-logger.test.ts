import { readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TranscriptLogger } from "../../e2e/transcript-logger.js";
import type { TranscriptEntry } from "../../e2e/transcript-logger.js";

let tmp: string;
let logger: TranscriptLogger;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-transcript-"));
  logger = new TranscriptLogger(tmp);
});

afterEach(async () => {
  await logger.close();
  rmSync(tmp, { recursive: true, force: true });
});

function readJsonl<T>(filePath: string): T[] {
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}

describe("TranscriptLogger — transcript.jsonl", () => {
  test("writes a timestamped entry to transcript.jsonl", async () => {
    logger.logTranscript({
      type: "action",
      step: 1,
      content: "Ran `freefsm start workflow.yaml`",
      evidence: "exit_code=0",
    });

    await logger.close();
    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("action");
    expect(entries[0].step).toBe(1);
    expect(entries[0].content).toBe("Ran `freefsm start workflow.yaml`");
    expect(entries[0].evidence).toBe("exit_code=0");
    // ts should be a valid ISO timestamp
    expect(new Date(entries[0].ts).toISOString()).toBe(entries[0].ts);
  });

  test("appends multiple entries to transcript.jsonl", async () => {
    logger.logTranscript({
      type: "action",
      step: 1,
      content: "First action",
    });
    logger.logTranscript({
      type: "observation",
      step: 1,
      content: "Observed result",
      evidence: "stdout: ok",
    });
    logger.logTranscript({
      type: "judgment",
      step: 1,
      content: "Step passed",
    });

    await logger.close();
    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries).toHaveLength(3);
    expect(entries[0].type).toBe("action");
    expect(entries[1].type).toBe("observation");
    expect(entries[2].type).toBe("judgment");
  });

  test("supports all entry types: action, observation, judgment, error", async () => {
    const types = ["action", "observation", "judgment", "error"] as const;
    for (const type of types) {
      logger.logTranscript({ type, step: 0, content: `${type} entry` });
    }

    await logger.close();
    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries).toHaveLength(4);
    for (let i = 0; i < types.length; i++) {
      expect(entries[i].type).toBe(types[i]);
    }
  });
});

describe("TranscriptLogger — api.jsonl", () => {
  test("writes API request/response pairs to api.jsonl", async () => {
    logger.logApi({
      direction: "request",
      data: { model: "claude-sonnet-4-20250514", messages: [] },
    });
    logger.logApi({
      direction: "response",
      data: { id: "msg_123", content: [{ type: "text", text: "Hello" }] },
    });

    await logger.close();
    const entries = readJsonl<{ ts: string; direction: string; data: unknown }>(
      join(tmp, "api.jsonl"),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].direction).toBe("request");
    expect(entries[1].direction).toBe("response");
    // Both should have timestamps
    expect(new Date(entries[0].ts).toISOString()).toBe(entries[0].ts);
    expect(new Date(entries[1].ts).toISOString()).toBe(entries[1].ts);
  });
});

describe("TranscriptLogger — SDK message processing", () => {
  test("processMessage logs assistant messages to transcript", async () => {
    // Simulate an SDKAssistantMessage-like object
    logger.processMessage({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will run the test step now." }],
      },
      uuid: "msg-1",
      session_id: "sess-1",
      parent_tool_use_id: null,
    } as never);

    await logger.close();
    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].content).toContain("I will run the test step now.");
  });

  test("processMessage logs result messages to transcript", async () => {
    logger.processMessage({
      type: "result",
      subtype: "success",
      result: "Test completed successfully",
      duration_ms: 5000,
      num_turns: 3,
      is_error: false,
      uuid: "msg-2",
      session_id: "sess-1",
    } as never);

    await logger.close();
    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    const last = entries[entries.length - 1];
    expect(last.content).toContain("Test completed successfully");
  });

  test("processMessage ignores stream_event messages (no transcript entry)", async () => {
    logger.processMessage({
      type: "stream_event",
      event: {},
      uuid: "msg-3",
      session_id: "sess-1",
      parent_tool_use_id: null,
    } as never);

    await logger.close();
    const content = readFileSync(join(tmp, "transcript.jsonl"), "utf-8").trim();
    expect(content).toBe("");
  });
});
