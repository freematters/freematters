import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the Agent SDK
const mockMessages: Array<{ type: string; [key: string]: unknown }> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
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

import { query } from "@anthropic-ai/claude-agent-sdk";
import { verifyCore } from "../../e2e/verify-runner.js";

const SAMPLE_PLAN_MD = `# Test: FSM workflow test

Verify that the workflow completes.

## Setup
- Workflow: tests/qa.fsm.yaml

## Steps
1. **Start workflow**: Start the embedded run
   - Expected: Run initializes
2. **Check state**: Wait for output
   - Expected: Shows current state

## Expected Outcomes
- Workflow completes successfully

## Cleanup
- Remove temp files
`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verifier-wf-"));
  mockMessages.length = 0;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("verifyCore — embedded verifier integration", () => {
  test("passes raw markdown and system prompt describes embedded tools", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "PASS",
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

    const mockQuery = vi.mocked(query);
    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];

    // Raw markdown passed as prompt
    expect(callArgs.prompt).toBe(SAMPLE_PLAN_MD);

    // System prompt describes embedded tools
    const systemPrompt = callArgs.options?.systemPrompt as string;
    expect(systemPrompt).toContain("start_embedded_run");
    expect(systemPrompt).toContain("wait");
    expect(systemPrompt).toContain("send_input");
  });

  test("mcpServers includes freefsm-verifier", async () => {
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

  test("captures summary from result and writes test-report.md", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "PASS: All steps completed",
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

    expect(result.summary).toBe("PASS: All steps completed");
    expect(existsSync(join(tmp, "test-report.md"))).toBe(true);
    const report = readFileSync(join(tmp, "test-report.md"), "utf-8");
    expect(report).toContain("PASS");
    expect(result.reportPath).toBe(join(tmp, "test-report.md"));
  });

  test("no FSM store is created (verifier does not use its own FSM)", async () => {
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

    expect(existsSync(join(tmp, ".freefsm"))).toBe(false);
  });
});
