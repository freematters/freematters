import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { readJsonl } from "./helpers.js";

// ─── Tests for verifier.fsm.yaml schema validation ──────────────

import { type Fsm, loadFsm } from "../../fsm.js";

const VERIFIER_FSM_PATH = resolve(__dirname, "../../../workflows/verifier.fsm.yaml");

// Load FSM once and share across all tests in this describe block
let verifierFsm: Fsm;

describe("verifier.fsm.yaml — schema validation", () => {
  beforeAll(() => {
    verifierFsm = loadFsm(VERIFIER_FSM_PATH);
  });

  test("workflow file exists", () => {
    expect(existsSync(VERIFIER_FSM_PATH)).toBe(true);
  });

  test("passes loadFsm schema validation", () => {
    expect(verifierFsm.version).toBe(1);
    expect(verifierFsm.initial).toBe("setup");
  });

  test("has all required states: setup, execute-steps, evaluate, report, done", () => {
    expect(verifierFsm.states).toHaveProperty("setup");
    expect(verifierFsm.states).toHaveProperty("execute-steps");
    expect(verifierFsm.states).toHaveProperty("evaluate");
    expect(verifierFsm.states).toHaveProperty("report");
    expect(verifierFsm.states).toHaveProperty("done");
  });

  test("setup transitions to execute-steps", () => {
    const targets = Object.values(verifierFsm.states.setup.transitions);
    expect(targets).toContain("execute-steps");
  });

  test("execute-steps transitions to evaluate", () => {
    const targets = Object.values(verifierFsm.states["execute-steps"].transitions);
    expect(targets).toContain("evaluate");
  });

  test("evaluate transitions to report", () => {
    const targets = Object.values(verifierFsm.states.evaluate.transitions);
    expect(targets).toContain("report");
  });

  test("report transitions to done", () => {
    const targets = Object.values(verifierFsm.states.report.transitions);
    expect(targets).toContain("done");
  });

  test("done is a terminal state with no transitions", () => {
    expect(Object.keys(verifierFsm.states.done.transitions)).toHaveLength(0);
  });

  test("each state has a non-empty prompt", () => {
    for (const [name, state] of Object.entries(verifierFsm.states)) {
      expect(state.prompt.length).toBeGreaterThan(0);
    }
  });

  test("state prompts reference test plan sections", () => {
    // setup should mention test plan and prerequisites
    expect(verifierFsm.states.setup.prompt.toLowerCase()).toMatch(
      /test plan|setup|prerequisite/,
    );
    // execute-steps should mention executing steps
    expect(verifierFsm.states["execute-steps"].prompt.toLowerCase()).toMatch(
      /step|execute|evidence/,
    );
    // evaluate should mention comparing or judging outcomes
    expect(verifierFsm.states.evaluate.prompt.toLowerCase()).toMatch(
      /outcome|verdict|compare|judge/,
    );
    // report should mention writing report
    expect(verifierFsm.states.report.prompt.toLowerCase()).toMatch(
      /report|test-report/,
    );
  });

  test("has a guide field describing the verification workflow", () => {
    expect(verifierFsm.guide).toBeDefined();
    expect(verifierFsm.guide?.length).toBeGreaterThan(0);
    expect(verifierFsm.guide?.toLowerCase()).toMatch(/verif|test|e2e/);
  });
});

// ─── Tests for verify-runner FSM integration ────────────────────

// Mock the Agent SDK
const mockMessages: Array<{ type: string; [key: string]: unknown }> = [];
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(() => {
    return (async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    })();
  }),
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((name: string, desc: string, schema: unknown, handler: unknown) => ({
    name,
    desc,
    schema,
    handler,
  })),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { TestPlan } from "../../e2e/parser.js";
import type { TranscriptEntry } from "../../e2e/transcript-logger.js";
import { verifyCore } from "../../e2e/verify-runner.js";

const SAMPLE_PLAN: TestPlan = {
  name: "FSM workflow test",
  setup: ["Install dependencies"],
  steps: [
    {
      name: "Start workflow",
      action: "Run `freefsm start workflow.yaml`",
      expected: "Run initializes",
    },
    {
      name: "Check state",
      action: "Run `freefsm current`",
      expected: "Shows current state",
    },
  ],
  expectedOutcomes: ["Workflow completes successfully"],
  cleanup: ["Remove temp files"],
};

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "freefsm-verifier-wf-"));
  mockMessages.length = 0;
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("verifyCore — FSM-driven execution", () => {
  test("query is called with verifier workflow system prompt", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    const mockQuery = vi.mocked(query);
    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];

    // System prompt should contain FSM-related content (from run-system.md template)
    const systemPrompt = callArgs.options?.systemPrompt as string;
    expect(systemPrompt).toContain("FSM");
    expect(systemPrompt).toContain("fsm_goto");
  });

  test("query is called with mcpServers including freefsm", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    const mockQuery = vi.mocked(query);
    const callArgs = mockQuery.mock.calls[0][0];

    // Should have mcpServers with freefsm key
    expect(callArgs.options?.mcpServers).toBeDefined();
    expect(callArgs.options?.mcpServers).toHaveProperty("freefsm");
  });

  test("initial message contains the setup state card with test plan info", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    const mockQuery = vi.mocked(query);
    const callArgs = mockQuery.mock.calls[0][0];

    // Initial message should reference the setup state
    const prompt = callArgs.prompt as string;
    expect(prompt).toContain("setup");
    // Should also contain test plan info
    expect(prompt).toContain("FSM workflow test");
  });

  test("transcript and report files are still generated", async () => {
    mockMessages.push({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Executing setup..." }],
      },
      uuid: "msg-1",
      session_id: "sess-1",
      parent_tool_use_id: null,
    });
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "All done",
      duration_ms: 3000,
      duration_api_ms: 2000,
      is_error: false,
      num_turns: 2,
      total_cost_usd: 0.01,
      usage: { input_tokens: 100, output_tokens: 50, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-2",
      session_id: "sess-1",
    });

    const result = await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    // transcript.jsonl and api.jsonl should exist
    expect(existsSync(join(tmp, "transcript.jsonl"))).toBe(true);
    expect(existsSync(join(tmp, "api.jsonl"))).toBe(true);

    // test-report.md should exist
    expect(existsSync(join(tmp, "test-report.md"))).toBe(true);
    const report = readFileSync(join(tmp, "test-report.md"), "utf-8");
    expect(report).toContain("# Test Report: FSM workflow test");

    // Should return result
    expect(result.jsonReport).toBeDefined();
    expect(result.reportPath).toBe(join(tmp, "test-report.md"));
  });

  test("FSM run is initialized with verifier workflow", async () => {
    mockMessages.push({
      type: "result",
      subtype: "success",
      result: "Done",
      duration_ms: 500,
      duration_api_ms: 400,
      is_error: false,
      num_turns: 1,
      total_cost_usd: 0.002,
      usage: { input_tokens: 30, output_tokens: 15, server_tool_use_input_tokens: 0 },
      modelUsage: {},
      permission_denials: [],
      uuid: "msg-1",
      session_id: "sess-1",
    });

    await verifyCore({ plan: SAMPLE_PLAN, testDir: tmp });

    // Verify that createSdkMcpServer was called (FSM MCP server created)
    const { createSdkMcpServer } = await import("@anthropic-ai/claude-agent-sdk");
    expect(vi.mocked(createSdkMcpServer)).toHaveBeenCalled();
  });
});
