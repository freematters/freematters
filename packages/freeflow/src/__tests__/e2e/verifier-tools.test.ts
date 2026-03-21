import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the Agent SDK before importing anything that uses it
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    return (async function* () {})();
  }),
  createSdkMcpServer: vi.fn((...args: unknown[]) => {
    return { __mockArgs: args };
  }),
  tool: vi.fn(
    (
      name: string,
      desc: string,
      schema: unknown,
      handler: (...args: unknown[]) => unknown,
    ) => ({
      name,
      desc,
      schema,
      handler,
    }),
  ),
}));

// Import after mocking
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { DualStreamLogger } from "../../e2e/dual-stream-logger.js";
import { createVerifierMcpServer } from "../../e2e/verifier-tools.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freeflow-verifier-tools-"));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Helper to get a tool handler by name from the mocked tool() calls.
 */
function getToolHandler(name: string): (...args: unknown[]) => Promise<unknown> {
  const toolCalls = vi.mocked(tool).mock.calls;
  const call = toolCalls.find((c) => c[0] === name);
  if (!call) {
    throw new Error(`Tool "${name}" not found in mock calls`);
  }
  return call[3] as (...args: unknown[]) => Promise<unknown>;
}

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

function parseResult(result: unknown): Record<string, unknown> {
  return JSON.parse((result as ToolResult).content[0].text);
}

describe("Verifier MCP Tools", () => {
  test("run_agent returns ok on success", async () => {
    createVerifierMcpServer();
    const handler = getToolHandler("run_agent");

    const result = await handler({ prompt: "hello", model: undefined });
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
  });

  test("run_agent errors on duplicate session", async () => {
    createVerifierMcpServer();
    const handler = getToolHandler("run_agent");

    await handler({ prompt: "first", model: undefined });
    const dup = (await handler({ prompt: "second", model: undefined })) as ToolResult;
    expect(dup.isError).toBe(true);
    expect(dup.content[0].text).toContain("already active");
  });

  test("wait errors when no session active", async () => {
    createVerifierMcpServer();
    const handler = getToolHandler("wait");

    const result = (await handler({ timeout: 1000 })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No agent session");
  });

  test("send errors when no session active", async () => {
    createVerifierMcpServer();
    const handler = getToolHandler("send");

    const result = (await handler({ text: "foo" })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No agent session");
  });

  test("send logs input via logger when provided", async () => {
    createVerifierMcpServer();
    const runHandler = getToolHandler("run_agent");
    await runHandler({ prompt: "start", model: undefined });

    const logger = new DualStreamLogger();
    const logInputSpy = vi.spyOn(logger, "logInput");

    // Create a new server with logger to test logging
    vi.clearAllMocks();
    createVerifierMcpServer({ logger });
    const runHandler2 = getToolHandler("run_agent");
    const sendHandler = getToolHandler("send");

    await runHandler2({ prompt: "start", model: undefined });
    await sendHandler({ text: "42" });
    expect(logInputSpy).toHaveBeenCalledWith("42");
  });
});
