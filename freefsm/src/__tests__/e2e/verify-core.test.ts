import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { TranscriptEntry } from "../../e2e/transcript-logger.js";
import { readJsonl } from "./helpers.js";

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
import { buildTestPlanContext, verifyCore } from "../../e2e/verify-runner.js";

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

describe("buildTestPlanContext", () => {
  test("includes the test plan name", () => {
    const ctx = buildTestPlanContext(SAMPLE_PLAN);
    expect(ctx).toContain("Basic workflow test");
  });

  test("includes all test steps", () => {
    const ctx = buildTestPlanContext(SAMPLE_PLAN);
    expect(ctx).toContain("Start workflow");
    expect(ctx).toContain("Transition");
    expect(ctx).toContain("freefsm start workflow.yaml");
    expect(ctx).toContain("freefsm goto done --on next");
  });

  test("includes expected outcomes", () => {
    const ctx = buildTestPlanContext(SAMPLE_PLAN);
    expect(ctx).toContain("Workflow completes successfully");
  });

  test("includes setup and cleanup", () => {
    const ctx = buildTestPlanContext(SAMPLE_PLAN);
    expect(ctx).toContain("Install freefsm");
    expect(ctx).toContain("Remove temp dir");
  });
});

describe("verifyCore — new embedded approach", () => {
  test("creates transcript.jsonl and api.jsonl in test-dir", async () => {
    mockMessages.push({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Starting embedded run..." }],
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
    const assistantEntry = entries.find((e) =>
      e.content.includes("Running setup steps"),
    );
    expect(assistantEntry).toBeDefined();
  });

  test("calls query with verifier system prompt and test plan as initial message", async () => {
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
    // System prompt should explain verifier tools (start_embedded_run, wait, send_input)
    expect(callArgs.options?.systemPrompt).toContain("start_embedded_run");
    expect(callArgs.options?.systemPrompt).toContain("wait");
    expect(callArgs.options?.systemPrompt).toContain("send_input");
    // Test plan info is in the initial message (prompt)
    const prompt = callArgs.prompt as string;
    expect(prompt).toContain("Basic workflow test");
    expect(prompt).toContain("Start workflow");
  });

  test("query is called with mcpServers including freefsm-verifier", async () => {
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
    expect(callArgs.options?.mcpServers).toBeDefined();
    // The verifier MCP server should be provided (key name may vary)
    expect(callArgs.options?.mcpServers).toHaveProperty("freefsm-verifier");
  });

  test("generates test-report.md and returns VerifyCoreResult", async () => {
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

    const result = await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    // test-report.md should exist
    expect(existsSync(join(tmp, "test-report.md"))).toBe(true);
    const reportContent = readFileSync(join(tmp, "test-report.md"), "utf-8");
    expect(reportContent).toContain("# Test Report: Basic workflow test");

    // result should contain jsonReport
    expect(result.jsonReport).toBeDefined();
    expect(result.jsonReport.verdict).toBe("FAIL"); // no judgment entries → FAIL
    expect(result.jsonReport.steps_passed).toBe(0);
    expect(result.jsonReport.steps_failed).toBe(2);

    // reportPath should point to the file
    expect(result.reportPath).toBe(join(tmp, "test-report.md"));
  });

  test("query always bypasses permissions", async () => {
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

  test("query passes model when specified", async () => {
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

    await verifyCore({
      plan: SAMPLE_PLAN,
      testDir: tmp,
      model: "claude-opus-4-20250514",
    });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.model).toBe("claude-opus-4-20250514");
  });

  test("does not load verifier.fsm.yaml (no FSM-driven approach)", async () => {
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
    // System prompt should NOT contain fsm_goto (old FSM-driven approach)
    expect(callArgs.options?.systemPrompt).not.toContain("fsm_goto");
    expect(callArgs.options?.systemPrompt).not.toContain("fsm_current");
  });

  test("DualStreamLogger is used for verifier agent output", async () => {
    mockMessages.push({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Verifier is running..." }],
      },
      uuid: "msg-1",
      session_id: "sess-1",
      parent_tool_use_id: null,
    });
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

    // Capture stderr to check for DualStreamLogger output
    const stderrWrites: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });
    } finally {
      process.stderr.write = origWrite;
    }

    // Should have [verifier] prefixed output on stderr
    const verifierOutput = stderrWrites.find((s) => s.includes("[verifier]"));
    expect(verifierOutput).toBeDefined();
  });
});
