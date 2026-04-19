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

  test("skillsAdd non-interactive with multiple agents emits --skill '*' --agent a b and -y", () => {
    skillsAdd("/some/dir", {
      scope: "global",
      agents: ["claude-code", "codex"],
      yes: true,
    });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "/some/dir",
      "--skill",
      "*",
      "--agent",
      "claude-code",
      "codex",
      "-y",
      "-g",
    ]);
  });

  test("skillsAdd interactive omits --skill and --agent so the skills CLI prompts", () => {
    skillsAdd("/some/dir", { scope: "local", interactive: true });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).not.toContain("--skill");
    expect(args).not.toContain("--agent");
    expect(args).not.toContain("-y");
    expect(args).not.toContain("-g");
  });

  test("skillsAdd quiet pipes stdio; default inherits", () => {
    skillsAdd("/a", { scope: "local", agents: ["codex"], yes: true, quiet: true });
    const quietStdio = (execFileSyncMock.mock.calls[0][2] as { stdio?: string }).stdio;
    expect(quietStdio).toBe("pipe");

    execFileSyncMock.mockReset();
    skillsAdd("/a", { scope: "local", agents: ["codex"], yes: true });
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
