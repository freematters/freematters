import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// We need to spy on process.stderr.write
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

import { colors } from "../../agent-log.js";
import { DualStreamLogger } from "../../e2e/dual-stream-logger.js";

describe("DualStreamLogger", () => {
  test("logEmbedded outputs with [embedded] prefix, cyan color, indented", () => {
    const logger = new DualStreamLogger();
    logger.logEmbedded("hello from embedded");

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[embedded]");
    expect(output).toContain(colors.cyan);
    // Indented: should have leading spaces
    expect(output).toContain("  ");
    expect(output).toContain("hello from embedded");
  });

  test("logVerifier outputs with [verifier] prefix, green color, top level", () => {
    const logger = new DualStreamLogger();
    logger.logVerifier("verifier says hi");

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[verifier]");
    expect(output).toContain(colors.green);
    expect(output).toContain("verifier says hi");
  });

  test("logInput outputs with [input] prefix, magenta color, top level", () => {
    const logger = new DualStreamLogger();
    logger.logInput("user typed something");

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("[input]");
    expect(output).toContain(colors.magenta);
    expect(output).toContain("user typed something");
  });

  test("all output goes to stderr", () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const logger = new DualStreamLogger();
    logger.logEmbedded("embedded");
    logger.logVerifier("verifier");
    logger.logInput("input");

    // stderr should have 3 calls
    expect(stderrSpy).toHaveBeenCalledTimes(3);
    // stdout should have 0 calls
    expect(stdoutSpy).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  test("logEmbedded indents multi-line text", () => {
    const logger = new DualStreamLogger();
    logger.logEmbedded("line1\nline2");

    expect(stderrSpy).toHaveBeenCalled();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain("line1");
    expect(output).toContain("line2");
  });

  test("logVerifier is not indented (top level)", () => {
    const logger = new DualStreamLogger();
    logger.logVerifier("top level message");

    const output = stderrSpy.mock.calls[0][0] as string;
    // Should not start with spaces before the prefix
    // The format is: color + [verifier] + message
    expect(output).not.toMatch(/^ {2,}\[verifier\]/);
  });

  test("logInput is not indented (top level)", () => {
    const logger = new DualStreamLogger();
    logger.logInput("top level input");

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).not.toMatch(/^ {2,}\[input\]/);
  });
});
