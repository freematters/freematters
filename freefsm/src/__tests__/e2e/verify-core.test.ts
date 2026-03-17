import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TranscriptEntry } from "../../e2e/transcript-logger.js";

// Mock the Agent SDK query function
const mockMessages: Array<{ type: string; [key: string]: unknown }> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    // Return an async iterable that yields mockMessages
    return (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    })();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((name: string, desc: string, schema: unknown, handler: unknown) => ({
    name,
    desc,
    schema,
    handler,
  })),
}));

// Import after mocking
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TestPlan } from "../../e2e/parser.js";
import { buildVerifySystemPrompt, verifyCore } from "../../e2e/verify-runner.js";

const SAMPLE_PLAN: TestPlan = {
  name: "Basic workflow test",
  setup: ["Install freefsm", "Create temp dir"],
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
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verify-core-"));
  mockMessages.length = 0;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}

describe("buildVerifySystemPrompt", () => {
  test("includes the test plan name in the system prompt", () => {
    const prompt = buildVerifySystemPrompt(SAMPLE_PLAN);
    expect(prompt).toContain("Basic workflow test");
  });

  test("includes all test steps in the system prompt", () => {
    const prompt = buildVerifySystemPrompt(SAMPLE_PLAN);
    expect(prompt).toContain("Start workflow");
    expect(prompt).toContain("Transition");
    expect(prompt).toContain("freefsm start workflow.yaml");
    expect(prompt).toContain("freefsm goto done --on next");
  });

  test("includes expected outcomes in the system prompt", () => {
    const prompt = buildVerifySystemPrompt(SAMPLE_PLAN);
    expect(prompt).toContain("Workflow completes successfully");
  });

  test("includes setup and cleanup instructions", () => {
    const prompt = buildVerifySystemPrompt(SAMPLE_PLAN);
    expect(prompt).toContain("Install freefsm");
    expect(prompt).toContain("Remove temp dir");
  });
});

describe("verifyCore — agent execution loop", () => {
  test("creates transcript.jsonl and api.jsonl in test-dir", async () => {
    // Simulate agent producing an assistant message then a result
    mockMessages.push({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Executing step 1..." }],
      },
      uuid: "msg-1",
      session_id: "sess-1",
      parent_tool_use_id: null,
    });
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "All steps completed",
      duration_ms: 3000,
      duration_api_ms: 2000,
      is_error: false,
      num_turns: 2,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-2",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    expect(existsSync(join(tmp, "transcript.jsonl"))).toBe(true);
    expect(existsSync(join(tmp, "api.jsonl"))).toBe(true);
  });

  test("transcript.jsonl contains entries from agent messages", async () => {
    mockMessages.push({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Running setup steps..." }],
      },
      uuid: "msg-1",
      session_id: "sess-1",
      parent_tool_use_id: null,
    });
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 1000,
      duration_api_ms: 800,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.005,
      usage: { input_tokens: 50, output_tokens: 25, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-2",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    const entries = readJsonl<TranscriptEntry>(join(tmp, "transcript.jsonl"));
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // Should have the assistant message logged
    const assistantEntry = entries.find((e) =>
      e.content.includes("Running setup steps"),
    );
    expect(assistantEntry).toBeDefined();
  });

  test("calls query with system prompt containing the test plan", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    expect(query).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.systemPrompt).toContain("Basic workflow test");
    expect(callArgs.options?.systemPrompt).toContain("Start workflow");
  });

  test("query is called with bypassPermissions mode", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.permissionMode).toBe("bypassPermissions");
    expect(callArgs.options?.allowDangerouslySkipPermissions).toBe(true);
  });
});
