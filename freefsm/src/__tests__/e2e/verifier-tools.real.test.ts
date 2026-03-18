/**
 * Real integration test for verifier MCP tools using Claude Code SDK.
 * Calls run_agent, wait, send tool handlers directly.
 */

import { afterEach, describe, expect, test } from "vitest";
import { createVerifierMcpServer } from "../../e2e/verifier-tools.js";

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

function parseResult(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text);
}

describe("verifier MCP tools (real SDK)", () => {
  let server: ReturnType<typeof createVerifierMcpServer> | undefined;

  afterEach(() => {
    server = undefined;
  });

  test("run_agent + wait: single turn", async () => {
    server = createVerifierMcpServer();
    const { runAgent, wait } = server.tools;

    const startResult = (await runAgent.handler(
      { prompt: "Reply with exactly: MCP_TOOL_OK", model: "claude-haiku-4-5-20251001" },
      {},
    )) as ToolResult;
    expect(parseResult(startResult)).toEqual({ ok: true });

    const waitResult = (await wait.handler({ timeout: 30_000 }, {})) as ToolResult;
    const parsed = parseResult(waitResult);
    expect(parsed.output).toContain("MCP_TOOL_OK");
  }, 60_000);

  test("run_agent + wait + send + wait: multi-turn", async () => {
    server = createVerifierMcpServer();
    const { runAgent, wait, send } = server.tools;

    await runAgent.handler(
      { prompt: "Reply with exactly: TURN_A", model: "claude-haiku-4-5-20251001" },
      {},
    );

    const turn1 = parseResult(
      (await wait.handler({ timeout: 30_000 }, {})) as ToolResult,
    );
    expect(turn1.output).toContain("TURN_A");

    const sendResult = (await send.handler(
      { text: "Now reply with exactly: TURN_B" },
      {},
    )) as ToolResult;
    expect(parseResult(sendResult)).toEqual({ ok: true });

    const turn2 = parseResult(
      (await wait.handler({ timeout: 30_000 }, {})) as ToolResult,
    );
    expect(turn2.output).toContain("TURN_B");
  }, 120_000);

  test("run_agent errors on duplicate session", async () => {
    server = createVerifierMcpServer();
    const { runAgent, wait } = server.tools;

    await runAgent.handler(
      { prompt: "Reply with: OK", model: "claude-haiku-4-5-20251001" },
      {},
    );
    await wait.handler({ timeout: 30_000 }, {});

    const dup = (await runAgent.handler(
      { prompt: "Reply with: SHOULD_FAIL", model: "claude-haiku-4-5-20251001" },
      {},
    )) as ToolResult;
    expect(dup.isError).toBe(true);
    expect(dup.content[0].text).toContain("already active");
  }, 60_000);

  test("wait errors when no session", async () => {
    server = createVerifierMcpServer();
    const { wait } = server.tools;

    const result = (await wait.handler({ timeout: 1000 }, {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No agent session");
  });

  test("send errors when no session", async () => {
    server = createVerifierMcpServer();
    const { send } = server.tools;

    const result = (await send.handler({ text: "hello" }, {})) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No agent session");
  });

  test("unknown skill error surfaces in wait output", async () => {
    server = createVerifierMcpServer();
    const { runAgent, wait } = server.tools;

    await runAgent.handler(
      { prompt: "/nonexistent-skill:start foo", model: "claude-haiku-4-5-20251001" },
      {},
    );

    const waitResult = (await wait.handler({ timeout: 30_000 }, {})) as ToolResult;
    const parsed = parseResult(waitResult);
    const output = String(parsed.output);
    expect(output).toContain("Unknown skill");
  }, 60_000);
});
