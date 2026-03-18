import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the Agent SDK query function
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    return (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "Done",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5, server_tool_use_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      };
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

let tmp: string;
let planPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verify-core-"));
  planPath = join(tmp, "test-plan.md");
  writeFileSync(
    planPath,
    "# Test: Basic test\n\n## Setup\n- Workflow: test.yaml\n\n## Steps\n1. **Check**: Wait\n   - Expected: OK\n\n## Expected Outcomes\n- Works\n",
    "utf-8",
  );
  vi.clearAllMocks();

  // Return fresh generator for each query() call (retry loop calls multiple times)
  vi.mocked(query).mockImplementation(() => {
    const gen = (async function* () {
      yield {
        type: "result",
        subtype: "success",
        result: "Done",
        duration_ms: 100,
        duration_api_ms: 50,
        is_error: false,
        num_turns: 1,
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5, server_tool_use_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
      };
    })();
    Object.assign(gen, {
      interrupt: vi.fn(),
      setPermissionMode: vi.fn(),
      setModel: vi.fn(),
      setMaxThinkingTokens: vi.fn(),
      streamInput: vi.fn(),
      stopTask: vi.fn(),
      close: vi.fn(),
      rewindFiles: vi.fn(),
    });
    return gen as ReturnType<typeof query>;
  });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("verifyCore — runs verifier FSM via runCore", () => {
  test("calls query with verifier FSM system prompt", async () => {
    const testDir = join(tmp, "out");
    await verifyCore({ planPath, testDir });

    expect(query).toHaveBeenCalled();
    const callArgs = vi.mocked(query).mock.calls[0][0];
    // System prompt comes from verifier.fsm.yaml guide via runCore
    const systemPrompt = callArgs.options?.systemPrompt as string;
    expect(systemPrompt).toContain("start_embedded_run");
    expect(systemPrompt).toContain("wait");
    expect(systemPrompt).toContain("send_input");
  });

  test("initial message contains test plan path and test dir", async () => {
    const testDir = join(tmp, "out");
    await verifyCore({ planPath, testDir });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    const prompt = callArgs.prompt as string;
    expect(prompt).toContain(planPath);
    expect(prompt).toContain(testDir);
  });

  test("mcpServers includes both freefsm (FSM tools) and freefsm-verifier (embedded tools)", async () => {
    const testDir = join(tmp, "out");
    await verifyCore({ planPath, testDir });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    const servers = callArgs.options?.mcpServers as Record<string, unknown>;
    expect(servers).toHaveProperty("freefsm");
    expect(servers).toHaveProperty("freefsm-verifier");
  });

  test("returns reportPath", async () => {
    const testDir = join(tmp, "out");
    const result = await verifyCore({ planPath, testDir });
    expect(result.reportPath).toBe(join(testDir, "test-report.md"));
  });

  test("query bypasses permissions", async () => {
    const testDir = join(tmp, "out");
    await verifyCore({ planPath, testDir });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.permissionMode).toBe("bypassPermissions");
  });

  test("forwards model option", async () => {
    const testDir = join(tmp, "out");
    await verifyCore({ planPath, testDir, model: "claude-opus-4-20250514" });

    const callArgs = vi.mocked(query).mock.calls[0][0];
    expect(callArgs.options?.model).toBe("claude-opus-4-20250514");
  });
});
