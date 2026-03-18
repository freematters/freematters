import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verifier-tools-"));
  mockQueryResults.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * Create a minimal 2-state FSM YAML file for testing.
 */
function writeTrivialFsm(dir: string): string {
  const fsmPath = join(dir, "test.fsm.yaml");
  writeFileSync(
    fsmPath,
    `version: 1
initial: start
guide: "Test workflow"
states:
  start:
    prompt: "Do something"
    transitions:
      next: done
  done:
    prompt: "All done"
    transitions: {}
`,
  );
  return fsmPath;
}

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

describe("Verifier MCP Tools", () => {
  test("createVerifierMcpServer creates MCP server with three tools", () => {
    createVerifierMcpServer();

    const toolCalls = vi.mocked(tool).mock.calls;
    const toolNames = toolCalls.map((c) => c[0]);
    expect(toolNames).toContain("start_embedded_run");
    expect(toolNames).toContain("wait");
    expect(toolNames).toContain("send_input");
  });

  test("start_embedded_run launches embedded run and returns { run_id, store_root }", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    // Agent completes immediately
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const handler = getToolHandler("start_embedded_run");

    const result = (await handler({ fsm_path: fsmPath, root: tmp })) as {
      content: Array<{ type: string; text: string }>;
    };

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.run_id).toBeTruthy();
    expect(typeof parsed.run_id).toBe("string");
    expect(parsed.store_root).toBe(tmp);
  });

  test("wait returns { status: 'turn_complete', output } when agent finishes a turn", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Hello from agent",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Drain until we get turn_complete
    let parsed: Record<string, unknown>;
    do {
      const result = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(result.content[0].text);
    } while (parsed.status !== "turn_complete" && parsed.status !== "exited");

    expect(parsed.status).toBe("turn_complete");
    expect(parsed.output).toContain("Hello from agent");
  });

  test("wait returns { status: 'awaiting_input', prompt, output } when request_input is called", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    // Agent will call request_input, so the mock query will just produce a result
    // We need to trigger request_input through the tool handler
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");
    const sendInputHandler = getToolHandler("send_input");

    // Start the embedded run
    const startResult = (await startHandler({ fsm_path: fsmPath, root: tmp })) as {
      content: Array<{ type: string; text: string }>;
    };
    const { run_id } = JSON.parse(startResult.content[0].text);

    // Manually enqueue an input request on the bus to simulate request_input
    // We access the bus through the internal state by importing EmbeddedRun
    // Actually, we need to go through the message bus directly.
    // The verifier tools should have stashed the bus internally.
    // Let's use a different approach: get the embedded run's bus from the tool's internal state.

    // For this test, we'll use the tool handler from the embedded run's request_input tool
    // to simulate the agent calling request_input.
    const embeddedToolCalls = vi.mocked(tool).mock.calls;
    const requestInputCall = embeddedToolCalls.find((c) => c[0] === "request_input");
    expect(requestInputCall).toBeDefined();
    const requestInputHandler = requestInputCall?.[3] as (args: {
      prompt: string;
    }) => Promise<unknown>;

    // Call request_input in background (it blocks waiting for input)
    const inputPromise = requestInputHandler({ prompt: "What is your name?" });

    // Now wait should return awaiting_input
    const waitResult = (await waitHandler({ timeout: 5000 })) as {
      content: Array<{ type: string; text: string }>;
    };

    // Drain output events until we hit awaiting_input
    let parsed = JSON.parse(waitResult.content[0].text);
    while (parsed.status === "output" || parsed.status === "turn_complete") {
      const next = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(next.content[0].text);
    }

    expect(parsed.status).toBe("awaiting_input");
    expect(parsed.prompt).toBe("What is your name?");

    // Resolve the pending input so the test cleans up
    await sendInputHandler({ text: "Alice" });
    await inputPromise;
  });

  test("wait returns { status: 'exited', code, output } when run completes", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "All done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Drain events until exited
    let parsed: { status: string; code?: number; output?: string; text?: string };
    do {
      const result = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(result.content[0].text);
    } while (parsed.status !== "exited");

    expect(parsed.status).toBe("exited");
    expect(parsed.code).toBe(0);
    expect(typeof parsed.output).toBe("string");
  });

  test("wait returns { status: 'timeout' } after timeout", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Drain all events first
    let parsed: { status: string };
    do {
      const result = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(result.content[0].text);
    } while (parsed.status !== "exited");

    // Now the bus is empty and exited — next wait should timeout
    const result = (await waitHandler({ timeout: 50 })) as {
      content: Array<{ type: string; text: string }>;
    };
    parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("timeout");
  });

  test("send_input resolves pending input request", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const sendInputHandler = getToolHandler("send_input");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Get the request_input handler from the embedded run
    const embeddedToolCalls = vi.mocked(tool).mock.calls;
    const requestInputCall = embeddedToolCalls.find((c) => c[0] === "request_input");
    const requestInputHandler = requestInputCall?.[3] as (args: {
      prompt: string;
    }) => Promise<{ content: Array<{ type: string; text: string }> }>;

    // Simulate agent calling request_input (blocks until resolved)
    const inputPromise = requestInputHandler({ prompt: "Enter value:" });

    // Give the event loop a tick so the input request is enqueued
    await new Promise((r) => setTimeout(r, 10));

    // send_input should resolve it
    const result = (await sendInputHandler({ text: "42" })) as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.ok).toBe(true);

    // The request_input handler should have resolved with the input
    const inputResult = await inputPromise;
    expect(inputResult.content[0].text).toBe("42");
  });

  test("wait logs embedded output via logger when provided", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Hello from agent",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const logger = new DualStreamLogger();
    const logEmbeddedSpy = vi.spyOn(logger, "logEmbedded");

    createVerifierMcpServer({ logger });
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Drain until turn_complete
    let parsed: Record<string, unknown>;
    do {
      const result = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(result.content[0].text);
    } while (parsed.status !== "turn_complete" && parsed.status !== "exited");

    expect(parsed.status).toBe("turn_complete");
    // Logger should have been called with the accumulated output
    expect(logEmbeddedSpy).toHaveBeenCalled();
  });

  test("wait logs input request via logger when provided", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const logger = new DualStreamLogger();
    const logEmbeddedSpy = vi.spyOn(logger, "logEmbedded");

    createVerifierMcpServer({ logger });
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Get request_input handler from embedded run tools
    const embeddedToolCalls = vi.mocked(tool).mock.calls;
    const requestInputCall = embeddedToolCalls.find((c) => c[0] === "request_input");
    const requestInputHandler = requestInputCall?.[3] as (args: {
      prompt: string;
    }) => Promise<unknown>;

    // Call request_input in background
    const inputPromise = requestInputHandler({ prompt: "Enter name:" });

    // Drain output events until we hit awaiting_input
    let parsed: { status: string; prompt?: string };
    do {
      const result = (await waitHandler({ timeout: 5000 })) as {
        content: Array<{ type: string; text: string }>;
      };
      parsed = JSON.parse(result.content[0].text);
    } while (parsed.status === "turn_complete");

    expect(parsed.status).toBe("awaiting_input");
    expect(logEmbeddedSpy).toHaveBeenCalledWith("[request_input] Enter name:");

    // Clean up
    const sendInputHandler = getToolHandler("send_input");
    await sendInputHandler({ text: "Alice" });
    await inputPromise;
  });

  test("send_input logs input via logger when provided", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const logger = new DualStreamLogger();
    const logInputSpy = vi.spyOn(logger, "logInput");

    createVerifierMcpServer({ logger });
    const startHandler = getToolHandler("start_embedded_run");
    const sendInputHandler = getToolHandler("send_input");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Get request_input handler
    const embeddedToolCalls = vi.mocked(tool).mock.calls;
    const requestInputCall = embeddedToolCalls.find((c) => c[0] === "request_input");
    const requestInputHandler = requestInputCall?.[3] as (args: {
      prompt: string;
    }) => Promise<unknown>;

    // Trigger a pending input request
    const inputPromise = requestInputHandler({ prompt: "Enter value:" });
    await new Promise((r) => setTimeout(r, 10));

    await sendInputHandler({ text: "42" });
    expect(logInputSpy).toHaveBeenCalledWith("42");

    await inputPromise;
  });

  test("send_input errors when no request is pending", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const sendInputHandler = getToolHandler("send_input");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // No input request is pending, so send_input should return an error
    const result = (await sendInputHandler({ text: "foo" })) as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No input request pending");
  });
});
