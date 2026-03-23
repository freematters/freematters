import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the gateway server module before importing the command
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
vi.mock("../../gateway/server.js", () => ({
  createGatewayServer: vi.fn(() => ({
    start: mockStart,
    stop: mockStop,
  })),
}));

import { createGatewayServer } from "../../gateway/server.js";

// Import the function under test
import { gateway } from "../gateway.js";

describe("gateway CLI subcommand", () => {
  // biome-ignore lint/suspicious/noExplicitAny: vi.spyOn overloaded write() signature not expressible
  let stderrSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  describe("option defaults", () => {
    test("uses port 8080 by default", async () => {
      await gateway({ storeRoot: "/tmp/test-store" });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080 }),
      );
    });

    test("uses host 0.0.0.0 by default", async () => {
      await gateway({ storeRoot: "/tmp/test-store" });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ host: "0.0.0.0" }),
      );
    });

    test("passes explicit port option", async () => {
      await gateway({ port: 3000, storeRoot: "/tmp/test-store" });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ port: 3000 }),
      );
    });

    test("passes explicit host option", async () => {
      await gateway({ host: "127.0.0.1", storeRoot: "/tmp/test-store" });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ host: "127.0.0.1" }),
      );
    });

    test("passes explicit api-key option", async () => {
      await gateway({
        apiKey: "my-secret-key",
        storeRoot: "/tmp/test-store",
      });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "my-secret-key" }),
      );
    });

    test("passes store-root option", async () => {
      await gateway({ storeRoot: "/custom/root" });

      expect(createGatewayServer).toHaveBeenCalledWith(
        expect.objectContaining({ storeRoot: "/custom/root" }),
      );
    });
  });

  describe("auto-generate API key", () => {
    test("generates a random API key when not provided", async () => {
      await gateway({ storeRoot: "/tmp/test-store" });

      const call = vi.mocked(createGatewayServer).mock.calls[0][0];
      expect(call.apiKey).toBeDefined();
      expect(call.apiKey.length).toBeGreaterThan(0);
    });

    test("prints generated API key to stderr", async () => {
      await gateway({ storeRoot: "/tmp/test-store" });

      const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
      expect(output).toContain("API Key:");
    });
  });

  describe("server lifecycle", () => {
    test("calls createGatewayServer and start()", async () => {
      await gateway({ storeRoot: "/tmp/test-store" });

      expect(createGatewayServer).toHaveBeenCalledTimes(1);
      expect(mockStart).toHaveBeenCalledTimes(1);
    });

    test("prints listening address to stderr", async () => {
      await gateway({
        port: 9090,
        host: "localhost",
        storeRoot: "/tmp/test-store",
      });

      const output = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
      expect(output).toContain("localhost");
      expect(output).toContain("9090");
    });
  });

  describe("graceful shutdown", () => {
    test("returns a shutdown function that calls stop()", async () => {
      const shutdown = await gateway({ storeRoot: "/tmp/test-store" });

      expect(typeof shutdown).toBe("function");
      await shutdown();
      expect(mockStop).toHaveBeenCalledTimes(1);
    });
  });
});
