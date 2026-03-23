import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Daemon } from "../../daemon/index.js";
import { buildDaemonCommand } from "../daemon.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeMockDaemon(): Daemon {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    getAgents: vi.fn().mockReturnValue([]),
    _gatewayClient: {} as Daemon["_gatewayClient"],
  };
}

function buildProgram(mockDaemon?: Daemon): {
  program: Command;
  createDaemon: ReturnType<typeof vi.fn>;
} {
  const daemon = mockDaemon ?? makeMockDaemon();
  const createDaemon = vi.fn().mockReturnValue(daemon);
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  buildDaemonCommand(program, { createDaemon });
  return { program, createDaemon };
}

// ── Tests ────────────────────────────────────────────────────────

describe("fflow daemon CLI", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("parses --gateway (required), --api-key, --max-agents options", async () => {
    const { program } = buildProgram();
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
      "--api-key",
      "secret-key",
      "--max-agents",
      "5",
    ]);

    const cmd = program.commands.find((c) => c.name() === "daemon");
    expect(cmd).toBeDefined();
    const opts = cmd?.opts();
    expect(opts?.gateway).toBe("ws://localhost:8080");
    expect(opts?.apiKey).toBe("secret-key");
    expect(opts?.maxAgents).toBe(5);
  });

  it("uses default max-agents of 10 when not provided", async () => {
    const { program } = buildProgram();
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
    ]);

    const cmd = program.commands.find((c) => c.name() === "daemon");
    expect(cmd).toBeDefined();
    const opts = cmd?.opts();
    expect(opts?.maxAgents).toBe(10);
  });

  it("errors if --gateway not provided", () => {
    const { program } = buildProgram();
    expect(() => {
      program.parse(["node", "fflow", "daemon"]);
    }).toThrow();
  });

  it("calls createDaemon with correct config and starts", async () => {
    const daemon = makeMockDaemon();
    const { program, createDaemon } = buildProgram(daemon);
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
      "--api-key",
      "my-key",
      "--max-agents",
      "3",
    ]);

    expect(createDaemon).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_url: "ws://localhost:8080",
        api_key: "my-key",
        max_agents: 3,
      }),
    );
    expect(daemon.start).toHaveBeenCalled();
  });

  it("prints connection status to stderr", async () => {
    const { program } = buildProgram();
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
    ]);

    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("ws://localhost:8080");
  });
});

describe("graceful shutdown", () => {
  let listeners: Map<string, (...args: unknown[]) => void>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    listeners = new Map();
    processOnSpy = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: (...args: unknown[]) => void,
    ) => {
      listeners.set(event, handler);
      return process;
    }) as typeof process.on);
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("registers SIGINT handler that calls stop and exits", async () => {
    const daemon = makeMockDaemon();
    const { program } = buildProgram(daemon);
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
    ]);

    const sigintHandler = listeners.get("SIGINT");
    expect(sigintHandler).toBeDefined();

    sigintHandler?.();
    expect(daemon.stop).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("registers SIGTERM handler that calls stop and exits", async () => {
    const daemon = makeMockDaemon();
    const { program } = buildProgram(daemon);
    await program.parseAsync([
      "node",
      "fflow",
      "daemon",
      "--gateway",
      "ws://localhost:8080",
    ]);

    const sigtermHandler = listeners.get("SIGTERM");
    expect(sigtermHandler).toBeDefined();

    sigtermHandler?.();
    expect(daemon.stop).toHaveBeenCalled();
    expect(process.exit).toHaveBeenCalledWith(0);
  });
});
