/**
 * Unit tests for verifier MCP tools.
 *
 * - Streaming: verifies that each text event is logged to the DualStreamLogger
 *   as it arrives, tool use events are logged in verbose mode, timeout/error
 *   events are handled correctly, and the final result contains accumulated text.
 * - embeddedSessionId: verifies that the getter reflects the embedded agent's
 *   session_id after closeSession().
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TurnEvent } from "../e2e/agent-session.js";

// Track the order of events to verify streaming (not batching)
let streamedEvents: TurnEvent[] = [];
let loggedMessages: Array<{ type: string; text: string }> = [];

// Mock AgentSession with controllable stream
vi.mock("../e2e/agent-session.js", () => {
  return {
    AgentSession: class {
      sessionId = "test-session-id";
      send = vi.fn();
      async *stream(_timeout: number) {
        for (const event of streamedEvents) {
          yield event;
        }
      }
      close = vi.fn();
    },
  };
});

beforeEach(() => {
  streamedEvents = [];
  loggedMessages = [];
});

function createMockLogger() {
  return {
    logEmbedded: vi.fn((text: string) => {
      loggedMessages.push({ type: "embedded", text });
    }),
    logVerifier: vi.fn((text: string) => {
      loggedMessages.push({ type: "verifier", text });
    }),
    logInput: vi.fn((text: string) => {
      loggedMessages.push({ type: "input", text });
    }),
  };
}

describe("verifier wait tool streaming", () => {
  test("logs each text event as it streams", async () => {
    streamedEvents = [
      { type: "text", text: "Step 1 output" },
      { type: "text", text: "Step 2 output" },
      { type: "text", text: "Final output" },
    ];

    const logger = createMockLogger();
    const { createVerifierMcpServer } = await import("../e2e/verifier-tools.js");
    const server = createVerifierMcpServer({ logger: logger as never });

    // Start an agent session
    await server.tools.runAgent.handler({ prompt: "test", model: undefined }, {});

    // Call wait — should stream events through logger
    const result = await server.tools.wait.handler({ timeout: 5000 }, {});

    // All three text messages should have been logged individually
    expect(logger.logEmbedded).toHaveBeenCalledTimes(3);
    expect(logger.logEmbedded).toHaveBeenNthCalledWith(1, "Step 1 output");
    expect(logger.logEmbedded).toHaveBeenNthCalledWith(2, "Step 2 output");
    expect(logger.logEmbedded).toHaveBeenNthCalledWith(3, "Final output");

    // Result should contain all accumulated text
    const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(content.output).toBe("Step 1 output\n---\nStep 2 output\n---\nFinal output");
  });

  test("logs tool_use events in verbose mode", async () => {
    streamedEvents = [
      {
        type: "tool_use",
        name: "Read",
        input: { file_path: "/tmp/test.ts" },
      },
      { type: "text", text: "Done reading" },
    ];

    const logger = createMockLogger();
    const { createVerifierMcpServer } = await import("../e2e/verifier-tools.js");
    const server = createVerifierMcpServer({
      logger: logger as never,
      verbose: true,
    });

    await server.tools.runAgent.handler({ prompt: "test", model: undefined }, {});
    await server.tools.wait.handler({ timeout: 5000 }, {});

    // Tool use should be logged (verbose mode)
    expect(logger.logEmbedded).toHaveBeenCalledTimes(2);
    expect(logger.logEmbedded.mock.calls[0][0]).toContain("Read");
  });

  test("handles timeout event from stream", async () => {
    streamedEvents = [{ type: "text", text: "partial output" }, { type: "timeout" }];

    const logger = createMockLogger();
    const { createVerifierMcpServer } = await import("../e2e/verifier-tools.js");
    const server = createVerifierMcpServer({ logger: logger as never });

    await server.tools.runAgent.handler({ prompt: "test", model: undefined }, {});
    const result = await server.tools.wait.handler({ timeout: 5000 }, {});

    // Timeout should be logged
    expect(logger.logEmbedded).toHaveBeenCalledWith("[timeout]");

    // Result should indicate timeout
    const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(content.type).toBe("timeout");
  });

  test("logs error events from stream", async () => {
    streamedEvents = [{ type: "error", text: "Something failed" }];

    const logger = createMockLogger();
    const { createVerifierMcpServer } = await import("../e2e/verifier-tools.js");
    const server = createVerifierMcpServer({ logger: logger as never });

    await server.tools.runAgent.handler({ prompt: "test", model: undefined }, {});
    const result = await server.tools.wait.handler({ timeout: 5000 }, {});

    expect(logger.logEmbedded).toHaveBeenCalledWith("[error] Something failed");

    const content = JSON.parse((result.content as Array<{ text: string }>)[0].text);
    expect(content.output).toBe("[error] Something failed");
  });
});

describe("embeddedSessionId management", () => {
  test("embeddedSessionId reflects session_id after closeSession", async () => {
    const { createVerifierMcpServer } = await import("../e2e/verifier-tools.js");
    const server = createVerifierMcpServer();

    // Before any agent: null
    expect(server.embeddedSessionId).toBeNull();

    // Start an agent via the run_agent tool
    const runAgentTool = server.tools.runAgent;
    await runAgentTool.handler({ prompt: "test", model: undefined }, {});

    // Close the session — should capture the embedded agent's session_id
    server.closeSession();

    // This is the bug: Object.assign flattens the getter, so this returns null
    expect(server.embeddedSessionId).toBe("test-session-id");
  });
});
