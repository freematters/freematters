import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

const { claudeAvailable } = await import("../install-detect.js");

describe("claudeAvailable", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  test("returns true when `which claude` succeeds", () => {
    execFileSyncMock.mockImplementation(() => Buffer.from("/usr/bin/claude\n"));
    expect(claudeAvailable()).toBe(true);

    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("which");
    expect(args).toEqual(["claude"]);
  });

  test("returns false when `which claude` throws", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(claudeAvailable()).toBe(false);
  });
});
