import { Command } from "commander";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cleanupTempDir, createTempDir } from "../../__tests__/fixtures.js";
import { buildDaemonCommand, startDaemon } from "../daemon.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("cmd-daemon");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

describe("buildDaemonCommand", () => {
  test("registers daemon command with required --gateway option", () => {
    const program = new Command();
    program.exitOverride();
    buildDaemonCommand(program);

    const daemonCmd = program.commands.find((c) => c.name() === "daemon");
    expect(daemonCmd).toBeDefined();
    expect(daemonCmd?.description()).toContain("Agent Daemon");
  });

  test("--gateway is required", () => {
    const program = new Command();
    program.exitOverride();
    buildDaemonCommand(program);

    // Attempting to parse without --gateway should throw
    expect(() => {
      program.parse(["node", "fflow", "daemon"], { from: "user" });
    }).toThrow();
  });

  test("accepts all options", () => {
    const program = new Command();
    program.exitOverride();
    buildDaemonCommand(program);

    const daemonCmd = program.commands.find((c) => c.name() === "daemon");
    expect(daemonCmd).toBeDefined();

    const optionNames = daemonCmd?.options.map((o) => o.long);
    expect(optionNames).toContain("--gateway");
    expect(optionNames).toContain("--api-key");
    expect(optionNames).toContain("--max-agents");
    expect(optionNames).toContain("--store-root");
  });
});

describe("startDaemon", () => {
  test("returns a shutdown function", async () => {
    // Start a gateway first so daemon can connect to something
    const { gateway } = await import("../gateway.js");
    const gwShutdown = await gateway({
      port: 19_010,
      host: "127.0.0.1",
      apiKey: "daemon-test-key",
      storeRoot: tmp,
    });

    const shutdown = await startDaemon({
      gateway: "ws://127.0.0.1:19010/ws/daemon",
      apiKey: "daemon-test-key",
      maxAgents: "5",
      storeRoot: tmp,
    });

    expect(typeof shutdown).toBe("function");

    shutdown();
    await gwShutdown();
  });

  test("prints connection info to stderr", async () => {
    const { gateway } = await import("../gateway.js");
    const gwShutdown = await gateway({
      port: 19_011,
      host: "127.0.0.1",
      apiKey: "daemon-test-key-2",
      storeRoot: tmp,
    });

    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const shutdown = await startDaemon({
      gateway: "ws://127.0.0.1:19011/ws/daemon",
      apiKey: "daemon-test-key-2",
      storeRoot: tmp,
    });

    process.stderr.write = origWrite;

    const hasConnecting = writes.some((w) => w.includes("connecting"));
    const hasMaxAgents = writes.some((w) => w.includes("Max agents"));
    expect(hasConnecting).toBe(true);
    expect(hasMaxAgents).toBe(true);

    shutdown();
    await gwShutdown();
  });

  test("defaults max_agents to 10", async () => {
    const { gateway } = await import("../gateway.js");
    const gwShutdown = await gateway({
      port: 19_012,
      host: "127.0.0.1",
      apiKey: "daemon-test-key-3",
      storeRoot: tmp,
    });

    const writes: string[] = [];
    const origWrite = process.stderr.write;
    process.stderr.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stderr.write;

    const shutdown = await startDaemon({
      gateway: "ws://127.0.0.1:19012/ws/daemon",
      apiKey: "daemon-test-key-3",
      storeRoot: tmp,
    });

    process.stderr.write = origWrite;

    const agentsLine = writes.find((w) => w.includes("Max agents: 10"));
    expect(agentsLine).toBeDefined();

    shutdown();
    await gwShutdown();
  });
});
