/**
 * Unit tests for AgentSession.stream() interface.
 *
 * Mocks MultiTurnSession to control the SDK messages fed into
 * AgentSession, then verifies TurnEvent yield behavior.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TurnEvent } from "../e2e/agent-session.js";

// Controllable mock for MultiTurnSession.
// mockStreamFn allows per-test override of stream() behavior.
let mockMessages: Array<Record<string, unknown>> = [];
let mockSendFn: ReturnType<typeof vi.fn>;
let mockStreamFn: (() => AsyncGenerator<Record<string, unknown>>) | null = null;

vi.mock("../e2e/multi-turn-session.js", () => {
  return {
    MultiTurnSession: class {
      sessionId: string | null = null;
      send = vi.fn((...args: unknown[]) => mockSendFn?.(...args));
      async *stream() {
        if (mockStreamFn) {
          yield* mockStreamFn();
          return;
        }
        for (const msg of mockMessages) {
          yield msg;
          if (msg.type === "result") return;
        }
      }
      close = vi.fn();
    },
  };
});

beforeEach(() => {
  mockMessages = [];
  mockSendFn = vi.fn();
  mockStreamFn = null;
});

describe("AgentSession.stream()", () => {
  test("yields text events from assistant messages", async () => {
    mockMessages = [
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Hello world" },
            { type: "text", text: "  Second block  " },
          ],
        },
      },
      { type: "result", is_error: false, result: "done" },
    ];

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
    mockMessages = [
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "Read", input: { file: "foo.ts" } }],
        },
      },
      { type: "result", is_error: false },
    ];

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
    mockMessages = [{ type: "result", is_error: true, result: "Something went wrong" }];

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
    mockMessages = [
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
      { type: "result", is_error: false },
    ];

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
    mockMessages = [
      { type: "user", message: { role: "user", content: [] } },
      { type: "rate_limit_event" },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "reply" }] },
      },
      { type: "result", is_error: false },
    ];

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
    // Override stream to yield one message then hang forever
    mockStreamFn = async function* () {
      yield {
        type: "assistant",
        message: { content: [{ type: "text", text: "partial" }] },
      };
      // Never complete — simulate a hanging agent
      await new Promise(() => {});
    };

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
    mockMessages = [
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
      { type: "result", is_error: false },
    ];

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
});
