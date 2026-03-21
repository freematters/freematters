import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// We need to spy on process.stderr.write
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

import { DualStreamLogger } from "../../e2e/dual-stream-logger.js";

describe("DualStreamLogger", () => {
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
});
