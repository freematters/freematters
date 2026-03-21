/**
 * Unit tests for AgentSession.stream() interface.
 *
 * Mocks only the external SDK boundary (@anthropic-ai/claude-agent-sdk query())
 * and lets the real MultiTurnSession + AgentSession run.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TurnEvent } from "../e2e/agent-session.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SDKMsg = Record<string, unknown>;

/** Build a mock query() return value: async iterable with close(). */
function makeQueryResult(messages: SDKMsg[]) {
  let closed = false;
  const closeFn = vi.fn(() => {
    closed = true;
  });

  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const msg of messages) {
        if (closed) return;
        yield msg;
      }
    },
    close: closeFn,
  };
  return iterable;
}

/** Build a query result from an async generator (for hanging streams). */
function makeQueryResultFromGenerator(gen: () => AsyncGenerator<SDKMsg>) {
  let generator: AsyncGenerator<SDKMsg> | null = null;

  const iterable = {
    [Symbol.asyncIterator]() {
      generator = gen();
      return generator;
    },
    close: vi.fn(() => {
      generator?.return(undefined);
    }),
  };
  return iterable;
}

// ---------------------------------------------------------------------------
// Mocks — only external boundaries
// ---------------------------------------------------------------------------

let mockQueryReturn: ReturnType<typeof makeQueryResult>;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => mockQueryReturn),
}));

// Avoid filesystem access from session-log
vi.mock("../session-log.js", () => ({
  getSessionDir: vi.fn(() => "/tmp/fake-session-dir"),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AgentSession.stream()", () => {
  test("yields text events from assistant messages", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-1" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello world" },
            { type: "text", text: "  Second block  " },
          ],
        },
      },
      { type: "result", is_error: false, result: "done", session_id: "sess-1" },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([
      { type: "text", text: "Hello world" },
      { type: "text", text: "Second block" },
    ]);
  });

  test("yields tool_use events from assistant messages", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-2" },
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file: "foo.ts" } }],
        },
      },
      { type: "result", is_error: false, session_id: "sess-2" },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([
      { type: "tool_use", name: "Read", input: { file: "foo.ts" } },
    ]);
  });

  test("yields error event from error result messages", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-3" },
      {
        type: "result",
        is_error: true,
        result: "Something went wrong",
        session_id: "sess-3",
      },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([{ type: "error", text: "Something went wrong" }]);
  });

  test("skips empty/whitespace text blocks", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-4" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "   " },
            { type: "text", text: "" },
            { type: "text", text: "Actual text" },
          ],
        },
      },
      { type: "result", is_error: false, session_id: "sess-4" },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([{ type: "text", text: "Actual text" }]);
  });

  test("silently ignores user and rate_limit_event messages", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-5" },
      { type: "user", message: { role: "user", content: [] } },
      { type: "rate_limit_event" },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "reply" }] },
      },
      { type: "result", is_error: false, session_id: "sess-5" },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([{ type: "text", text: "reply" }]);
  });

  test("yields timeout event when deadline is exceeded", async () => {
    mockQueryReturn = makeQueryResultFromGenerator(async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "sess-6",
      };
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "partial" }] },
      };
      // Never complete — simulate a hanging agent
      await new Promise(() => {});
    });

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(100)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([{ type: "text", text: "partial" }, { type: "timeout" }]);
  });

  test("wait() accumulates stream events into TurnResult", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-7" },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Line 1" },
            { type: "tool_use", name: "Bash", input: { cmd: "ls" } },
          ],
        },
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Line 2" }] },
      },
      { type: "result", is_error: false, session_id: "sess-7" },
    ]);

    const toolUses: string[] = [];
    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession({
      onToolUse: (name) => toolUses.push(name),
    });
    session.send("test");

    const result = await session.wait(5000);
    session.close();

    expect(result.output).toBe("Line 1\n---\nLine 2");
    expect(toolUses).toEqual(["Bash"]);
  });

  test("yields result text as fallback when no prior content was emitted", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-8" },
      {
        type: "result",
        is_error: false,
        result: "Unknown skill: nonexistent",
        session_id: "sess-8",
      },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    expect(events).toEqual([{ type: "text", text: "Unknown skill: nonexistent" }]);
  });

  test("does not yield result text when prior content was already emitted", async () => {
    mockQueryReturn = makeQueryResult([
      { type: "system", subtype: "init", session_id: "sess-9" },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello" }] },
      },
      { type: "result", is_error: false, result: "done", session_id: "sess-9" },
    ]);

    const { AgentSession } = await import("../e2e/agent-session.js");
    const session = new AgentSession();
    session.send("test");

    const events: TurnEvent[] = [];
    for await (const event of session.stream(5000)) {
      events.push(event);
    }
    session.close();

    // Result text "done" should NOT appear since assistant text was already emitted
    expect(events).toEqual([{ type: "text", text: "Hello" }]);
  });
});
