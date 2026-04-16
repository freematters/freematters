import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

const { skillsAdd, skillsRemove, listBundledSkills } = await import("../runners.js");

describe("runners", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
  });

  test("skillsAdd all: true pre-fills --skill '*' --agent '*' and honors yes for -y", () => {
    skillsAdd("/some/dir", { scope: "global", all: true, yes: true });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "/some/dir",
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
      "-g",
    ]);
  });

  test("skillsAdd quiet pipes stdio; default inherits", () => {
    skillsAdd("/a", { scope: "local", all: true, yes: true, quiet: true });
    const quietStdio = (execFileSyncMock.mock.calls[0][2] as { stdio?: string }).stdio;
    expect(quietStdio).toBe("pipe");

    execFileSyncMock.mockReset();
    skillsAdd("/a", { scope: "local", all: true, yes: true });
    const defaultStdio = (execFileSyncMock.mock.calls[0][2] as { stdio?: string })
      .stdio;
    expect(defaultStdio).toBe("inherit");
  });

  test("skillsRemove refuses empty skills list (never wipes with '*')", () => {
    expect(() => skillsRemove({ scope: "global", agent: "codex", skills: [] })).toThrow(
      /at least one skill/,
    );
  });
});

describe("listBundledSkills", () => {
  const PACKAGE_ROOT = resolve(__dirname, "../..");

  test("returns the names of every directory under <packageRoot>/skills", () => {
    const names = listBundledSkills(PACKAGE_ROOT);

    expect(names).toContain("fflow");
    expect(names).toContain("fflow-author");
    expect(names.length).toBeGreaterThan(0);
  });
});
