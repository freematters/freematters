import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    // Store the args so tests can inspect the tools passed
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
import { query, tool } from "@anthropic-ai/claude-agent-sdk";
import { EmbeddedRun } from "../../e2e/embedded-run.js";
import type { BusEvent } from "../../e2e/message-bus.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-embedded-run-"));
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

describe("EmbeddedRun", () => {
  test("start() launches an Agent SDK session that runs in the background", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    // Simulate agent producing a result message (simple non-interactive run)
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    // query should have been called
    expect(query).toHaveBeenCalled();
  });

  test("populates runId and storeRoot after start", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    expect(run.getRunId()).toBeTruthy();
    expect(typeof run.getRunId()).toBe("string");
    expect(run.getStoreRoot()).toBe(tmp);
  });

  test("runId can be provided via options", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp, runId: "my-custom-id" });
    await run.start();

    expect(run.getRunId()).toBe("my-custom-id");
  });

  test("getBus() returns a MessageBus", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    const bus = run.getBus();

    expect(bus).toBeDefined();
    expect(typeof bus.waitForEvent).toBe("function");
    expect(typeof bus.resolveInput).toBe("function");
  });

  test("markExited is called on the bus when session completes", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "All done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    const bus = run.getBus();
    // Wait for the background task to complete and mark exited
    // The exited event should eventually appear
    const event = await bus.waitForEvent(5000);
    // Could be output or exited — drain until exited
    const events: BusEvent[] = [event];
    while (events[events.length - 1].type !== "exited") {
      events.push(await bus.waitForEvent(5000));
    }
    const exitedEvent = events[events.length - 1];
    expect(exitedEvent.type).toBe("exited");
    if (exitedEvent.type === "exited") {
      expect(exitedEvent.code).toBe(0);
    }
  });

  test("result messages go to the bus (not stdout)", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Final answer from agent",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    const bus = run.getBus();
    // Drain events until exited
    const events: BusEvent[] = [];
    let ev: BusEvent;
    do {
      ev = await bus.waitForEvent(5000);
      events.push(ev);
    } while (ev.type !== "exited");

    // Should have an output event with the result text
    const outputEvents = events.filter((e) => e.type === "output");
    const allOutput = outputEvents
      .map((e) => (e as { type: "output"; text: string }).text)
      .join("\n");
    expect(allOutput).toContain("Final answer from agent");
  });

  test("request_input tool uses bus instead of readline when in embedded mode", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    // We need to verify that the request_input tool handler created for embedded mode
    // calls bus.enqueueInputRequest instead of readline.
    // We do this by checking the tool was created with the right handler.
    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    // The tool() mock should have been called to create request_input
    const toolCalls = vi.mocked(tool).mock.calls;
    const requestInputCall = toolCalls.find((call) => call[0] === "request_input");
    expect(requestInputCall).toBeDefined();

    // Call the handler with a prompt to verify it uses the bus
    const handler = requestInputCall?.[3] as (args: {
      prompt: string;
    }) => Promise<{ content: Array<{ type: string; text: string }> }>;

    const bus = run.getBus();

    // Call handler in background — it will block waiting for input
    const handlerPromise = handler({ prompt: "What is your name?" });

    // The bus should have an input_request event
    const event = await bus.waitForEvent(5000);
    // Drain output events if any until we find input_request
    const events: BusEvent[] = [event];
    while (events[events.length - 1].type !== "input_request") {
      events.push(await bus.waitForEvent(5000));
    }
    const inputEvent = events.find((e) => e.type === "input_request");
    expect(inputEvent).toBeDefined();
    if (inputEvent?.type === "input_request") {
      expect(inputEvent.prompt).toBe("What is your name?");
    }

    // Resolve the input
    bus.resolveInput("Alice");

    // The handler should resolve with the input text
    const result = await handlerPromise;
    expect(result.content[0].text).toBe("Alice");
  });

  test("embedded session exits with code 1 on error", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "error",
      result: "Something went wrong",
      duration_ms: 100,
      is_error: true,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    const bus = run.getBus();
    const events: BusEvent[] = [];
    let ev: BusEvent;
    do {
      ev = await bus.waitForEvent(5000);
      events.push(ev);
    } while (ev.type !== "exited");

    const exitedEvent = events[events.length - 1];
    expect(exitedEvent.type).toBe("exited");
    if (exitedEvent.type === "exited") {
      expect(exitedEvent.code).toBe(1);
    }
  });

  test("store files are created in storeRoot", async () => {
    const fsmPath = writeTrivialFsm(tmp);

    mockQueryResults.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 100,
      is_error: false,
      num_turns: 1,
    });

    const run = new EmbeddedRun(fsmPath, { root: tmp });
    await run.start();

    // Wait for completion
    const bus = run.getBus();
    let ev: BusEvent;
    do {
      ev = await bus.waitForEvent(5000);
    } while (ev.type !== "exited");

    const runId = run.getRunId();
    // Store should have created run directory with snapshot
    expect(existsSync(join(tmp, "runs", runId, "snapshot.json"))).toBe(true);
    expect(existsSync(join(tmp, "runs", runId, "events.jsonl"))).toBe(true);
  });
});
