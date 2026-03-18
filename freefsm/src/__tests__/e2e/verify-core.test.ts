import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
import { verifyCore } from "../../e2e/verify-runner.js";

const SAMPLE_PLAN_MD = `# Test: Basic workflow test

Verify that the workflow completes.

## Setup
- Workflow: tests/qa.fsm.yaml

## Steps
1. **Start run**: Start the embedded run
   - Expected: Run starts successfully
2. **Wait for completion**: Wait for exit
   - Expected: Agent exits with code 0

## Expected Outcomes
- Workflow completes successfully

## Cleanup
- No cleanup needed
`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verify-core-"));
  mockMessages.length = 0;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("verifyCore — embedded approach", () => {
  test("passes raw markdown as initial message to query", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "PASS: All steps completed",
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

    await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });

    expect(query).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(query).mock.calls[0][0];
    // Raw markdown is passed as the initial message
    const prompt = callArgs.prompt as string;
    expect(prompt).toBe(SAMPLE_PLAN_MD);
  });

  test("system prompt explains verifier tools", async () => {
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

    await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.systemPrompt).toContain("start_embedded_run");
    expect(callArgs.options?.systemPrompt).toContain("wait");
    expect(callArgs.options?.systemPrompt).toContain("send_input");
    // Should NOT contain old FSM tools
    expect(callArgs.options?.systemPrompt).not.toContain("fsm_goto");
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

    await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.mcpServers).toHaveProperty("freefsm-verifier");
  });

  test("captures agent result as summary and writes test-report.md", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "PASS: All 2 steps completed successfully",
      duration_ms: 3000,
      duration_api_ms: 2000,
      is_error: false,
      num_turns: 2,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    const result = await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });

    // Summary captured from result message
    expect(result.summary).toBe("PASS: All 2 steps completed successfully");

    // test-report.md written with the summary
    expect(existsSync(join(tmp, "test-report.md"))).toBe(true);
    const report = readFileSync(join(tmp, "test-report.md"), "utf-8");
    expect(report).toContain("PASS");

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

    await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });

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
      planMarkdown: SAMPLE_PLAN_MD,
      testDir: tmp,
      model: "claude-opus-4-20250514",
    });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.model).toBe("claude-opus-4-20250514");
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

    const stderrWrites: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    try {
      await verifyCore({ planMarkdown: SAMPLE_PLAN_MD, testDir: tmp });
    } finally {
      process.stderr.write = origWrite;
    }

    const verifierOutput = stderrWrites.find((s) => s.includes("[verifier]"));
    expect(verifierOutput).toBeDefined();
  });
});
