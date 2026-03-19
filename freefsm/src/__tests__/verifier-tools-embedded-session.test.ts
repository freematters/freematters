/**
 * E2E test: createVerifierMcpServer().embeddedSessionId must reflect
 * the embedded agent's session_id after closeSession().
 *
 * Root cause of the bug: Object.assign flattens getters into their current
 * values at assignment time, so the embeddedSessionId getter always returns
 * null even after closeSession() updates the closure variable.
 */

import { describe, expect, test, vi } from "vitest";

// Mock AgentSession so we don't need a real Claude session
vi.mock("../e2e/agent-session.js", () => ({
  AgentSession: class {
    sessionId = "embedded-sess-test-123";
    send() {}
    close() {}
  },
}));

describe("createVerifierMcpServer embeddedSessionId", () => {
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
    expect(server.embeddedSessionId).toBe("embedded-sess-test-123");
  });
});
