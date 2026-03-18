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
 * Create a 2-state FSM YAML file (non-terminal initial state).
 * The agent will complete a turn and wait for verifier input.
 */
function writeNonTerminalFsm(dir: string): string {
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
 * Create a FSM with a terminal initial state (no transitions).
 * The agent will exit immediately after the first session.
 */
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
  test("createVerifierMcpServer creates MCP server with three tools", () => {
    createVerifierMcpServer();

    const toolCalls = vi.mocked(tool).mock.calls;
    const toolNames = toolCalls.map((c) => c[0]);
    expect(toolNames).toContain("start_embedded_run");
    expect(toolNames).toContain("wait");
    expect(toolNames).toContain("send_input");
  });

  test("start_embedded_run launches embedded run and returns { run_id, store_root }", async () => {
    const fsmPath = writeTerminalFsm(tmp);

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

    const result = await handler({ fsm_path: fsmPath, root: tmp });
    const parsed = parseResult(result);
    expect(parsed.run_id).toBeTruthy();
    expect(typeof parsed.run_id).toBe("string");
    expect(parsed.store_root).toBe(tmp);
  });

  test("wait returns { type: 'turn_complete', output } when agent finishes a turn", async () => {
    const fsmPath = writeNonTerminalFsm(tmp);

    mockQueryResults.push({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello from agent" }] },
    });
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

    // Give the event loop a tick for runCore to process the mock query
    await new Promise((r) => setTimeout(r, 50));

    const parsed = parseResult(await waitHandler({ timeout: 5000 }));
    expect(parsed.type).toBe("turn_complete");
    expect(parsed.output).toContain("Hello from agent");
  });

  test("wait returns turn_complete when terminal FSM run completes", async () => {
    const fsmPath = writeTerminalFsm(tmp);

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

    await new Promise((r) => setTimeout(r, 50));

    const parsed = parseResult(await waitHandler({ timeout: 5000 }));
    expect(parsed.type).toBe("turn_complete");
    expect(typeof parsed.output).toBe("string");
  });

  test("wait returns timeout when no events", async () => {
    const fsmPath = writeTerminalFsm(tmp);

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

    // Drain the turn_complete first
    await new Promise((r) => setTimeout(r, 50));
    await waitHandler({ timeout: 5000 });

    // Now the bus is empty — next wait should timeout
    const parsed = parseResult(await waitHandler({ timeout: 50 }));
    expect(parsed.type).toBe("timeout");
  });

  test("send_input posts message to embedded agent bus", async () => {
    const fsmPath = writeNonTerminalFsm(tmp);

    // The mock query will be consumed twice (once per session)
    mockQueryResults.push(
      {
        type: "result",
        subtype: "success",
        result: "First turn",
        duration_ms: 100,
        is_error: false,
        num_turns: 1,
      },
    );

    createVerifierMcpServer();
    const startHandler = getToolHandler("start_embedded_run");
    const waitHandler = getToolHandler("wait");
    const sendInputHandler = getToolHandler("send_input");

    await startHandler({ fsm_path: fsmPath, root: tmp });

    // Wait for turn_complete (agent finished first session, waiting for prompt)
    await new Promise((r) => setTimeout(r, 50));
    const firstWait = parseResult(await waitHandler({ timeout: 5000 }));
    expect(firstWait.type).toBe("turn_complete");

    // Send input — this resolves the embedded agent's waitForPrompt()
    const result = parseResult(await sendInputHandler({ text: "continue" }));
    expect(result.ok).toBe(true);
  });

  test("send_input errors when no run is active", async () => {
    createVerifierMcpServer();
    const sendInputHandler = getToolHandler("send_input");

    const result = await sendInputHandler({ text: "foo" });
    const typed = result as ToolResult;
    expect(typed.isError).toBe(true);
    expect(typed.content[0].text).toContain("No embedded run is active");
  });

  test("wait logs embedded output via logger when provided", async () => {
    const fsmPath = writeNonTerminalFsm(tmp);

    mockQueryResults.push({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello from agent" }] },
    });
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

    // Give the event loop a tick for runCore to process
    await new Promise((r) => setTimeout(r, 50));

    const parsed = parseResult(await waitHandler({ timeout: 5000 }));
    expect(parsed.type).toBe("turn_complete");
    expect(logEmbeddedSpy).toHaveBeenCalled();
  });

  test("send_input logs input via logger when provided", async () => {
    const fsmPath = writeNonTerminalFsm(tmp);

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

    // Wait for the run to be ready
    await new Promise((r) => setTimeout(r, 50));

    await sendInputHandler({ text: "42" });
    expect(logInputSpy).toHaveBeenCalledWith("42");
  });
});
