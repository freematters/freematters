import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the agent SDK before importing the module under test
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  createSdkMcpServer: vi.fn(),
  tool: vi.fn(),
}));

import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { run } from "../commands/run.js";

const MINIMAL_FSM = `
version: 1
guide: "Test guide for the workflow"
initial: start
states:
  start:
    prompt: "Begin here."
    transitions:
      next: done
  done:
    prompt: "Finished."
    transitions: {}
`;

let tmp: string;
let fsmPath: string;
let root: string;

// Capture tool handlers registered via tool()
let toolHandlers: Record<
  string,
  (args: Record<string, unknown>, extra: unknown) => Promise<unknown>
>;
let toolDefinitions: Array<{ name: string; handler: unknown }>;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-reqinput-test-"));
  fsmPath = join(tmp, "test.yaml");
  writeFileSync(fsmPath, MINIMAL_FSM, "utf-8");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  root = mkdtempSync(join(tmp, "root-"));
  toolHandlers = {};
  toolDefinitions = [];

  // Capture tool definitions when tool() is called
  const mockTool = vi.mocked(tool);
  mockTool.mockImplementation(((
    name: string,
    _desc: string,
    _schema: unknown,
    handler: unknown,
  ) => {
    const def = { name, handler };
    toolDefinitions.push(def);
    toolHandlers[name] = handler as (
      args: Record<string, unknown>,
      extra: unknown,
    ) => Promise<unknown>;
    return def;
  }) as typeof tool);

  // createSdkMcpServer returns a mock server config
  const mockCreateServer = vi.mocked(createSdkMcpServer);
  mockCreateServer.mockImplementation(((opts: { tools?: unknown[] }) => {
    return { type: "sdk", name: opts?.name ?? "freefsm", instance: {} };
  }) as typeof createSdkMcpServer);

  // Default query mock — returns immediately
  const mockQuery = vi.mocked(query);
  async function* generator(): AsyncGenerator<SDKMessage, void> {
    yield {
      type: "result",
      subtype: "success",
      duration_ms: 100,
      duration_api_ms: 50,
      is_error: false,
      num_turns: 1,
      result: "Done",
      stop_reason: null,
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use_input_tokens: 0,
      },
      modelUsage: {},
      permission_denials: [],
    } as unknown as SDKMessage;
  }
  const gen = generator();
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
  mockQuery.mockReturnValue(gen as ReturnType<typeof query>);
});

// Helper: launch run to register MCP tools, then return tool handlers
async function launchAndGetHandlers(): Promise<{
  handlers: typeof toolHandlers;
}> {
  const runId = `test-run-${Date.now()}`;
  await run({ fsmPath, runId, root, json: false });
  return { handlers: toolHandlers };
}

// ─── request_input tool ─────────────────────────────────────────

describe("request_input tool", () => {
  test("is registered as an MCP tool", async () => {
    await launchAndGetHandlers();

    const names = toolDefinitions.map((t) => t.name);
    expect(names).toContain("request_input");
  });

  test("mcp__freefsm__request_input is in allowedTools", async () => {
    await launchAndGetHandlers();

    const mockQuery = vi.mocked(query);
    const callArgs = mockQuery.mock.calls[0][0];
    const allowed = callArgs.options?.allowedTools as string[];
    expect(allowed).toContain("mcp__freefsm__request_input");
  });

  test("writes prompt to stderr", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Mock stdin to provide a line of input
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    const { handlers } = await launchAndGetHandlers();

    // Call request_input in background, then push data
    const resultPromise = handlers.request_input({ prompt: "What is your name?" }, {});
    // Give the handler time to set up readline and write to stderr
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockStdin.push("Alice\n");

    await resultPromise;

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const stderrOutput = stderrCalls.join("");
    expect(stderrOutput).toContain("What is your name?");

    stderrSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
  });

  test("reads line from stdin and returns it", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    const { handlers } = await launchAndGetHandlers();

    const resultPromise = handlers.request_input({ prompt: "Enter something:" }, {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockStdin.push("hello world\n");

    const result = (await resultPromise) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello world");

    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
  });

  test("EOF on stdin returns appropriate message", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mockStdin = new Readable({ read() {} });
    const originalStdin = process.stdin;
    Object.defineProperty(process, "stdin", { value: mockStdin, writable: true });

    const { handlers } = await launchAndGetHandlers();

    const resultPromise = handlers.request_input({ prompt: "Enter something:" }, {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Signal EOF by pushing null
    mockStdin.push(null);

    const result = (await resultPromise) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("EOF: stdin closed, no input available");

    Object.defineProperty(process, "stdin", { value: originalStdin, writable: true });
  });
});
