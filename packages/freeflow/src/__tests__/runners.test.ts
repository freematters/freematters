import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

const {
  skillsAdd,
  skillsRemove,
  claudeInstallPlugin,
  claudeUninstallPlugin,
  claudeRemoveMarketplace,
  listBundledSkills,
  PLUGIN_KEY,
  MARKETPLACE_NAME,
} = await import("../runners.js");

describe("runners", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
  });

  test("skillsAdd local scope: npx skills add <dir> --skill '*' -y (no -g)", () => {
    skillsAdd("/some/dir", { scope: "local" });

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["--yes", "skills", "add", "/some/dir", "--skill", "*", "-y"]);
  });

  test("skillsAdd global scope includes -g", () => {
    skillsAdd("/some/dir", { scope: "global" });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "/some/dir",
      "--skill",
      "*",
      "-y",
      "-g",
    ]);
  });

  test("skillsAdd with agent appends --agent <list> verbatim", () => {
    skillsAdd("/some/dir", { scope: "local", agent: "claude-code,cursor" });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "/some/dir",
      "--skill",
      "*",
      "-y",
      "--agent",
      "claude-code,cursor",
    ]);
  });

  test("skillsAdd interactive omits --skill '*' and -y (lets skills CLI prompt)", () => {
    skillsAdd("/some/dir", { scope: "local", interactive: true });

    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["--yes", "skills", "add", "/some/dir"]);
  });

  test("skillsAdd quiet pipes stdio (doesn't inherit) so skills CLI output is suppressed", () => {
    skillsAdd("/some/dir", { scope: "global", agent: "codex", quiet: true });

    const call = execFileSyncMock.mock.calls[0];
    expect(call[0]).toBe("npx");
    const stdioOpt = (call[2] as { stdio?: string } | undefined)?.stdio;
    expect(stdioOpt).toBe("pipe");
  });

  test("skillsAdd (non-quiet, default) inherits stdio so the user sees the skills CLI", () => {
    skillsAdd("/some/dir", { scope: "global", agent: "codex" });

    const call = execFileSyncMock.mock.calls[0];
    const stdioOpt = (call[2] as { stdio?: string } | undefined)?.stdio;
    expect(stdioOpt).toBe("inherit");
  });

  test("skillsAdd interactive still forwards --agent and -g when provided", () => {
    skillsAdd("/some/dir", {
      scope: "global",
      interactive: true,
      agent: "claude-code",
    });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "--yes",
      "skills",
      "add",
      "/some/dir",
      "--agent",
      "claude-code",
      "-g",
    ]);
  });

  test("skillsAdd all: true pre-fills --skill '*' --agent '*' without -y (picker still shows)", () => {
    skillsAdd("/some/dir", { scope: "local", all: true, agent: "ignored" });

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
    ]);
  });

  test("skillsAdd all: true + yes: true appends -y (full --all shorthand)", () => {
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

  test("claudeInstallPlugin: marketplace add THEN plugin install in order", () => {
    claudeInstallPlugin("/pkg/root");

    expect(execFileSyncMock).toHaveBeenCalledTimes(2);
    const [firstCmd, firstArgs] = execFileSyncMock.mock.calls[0];
    const [secondCmd, secondArgs] = execFileSyncMock.mock.calls[1];

    expect(firstCmd).toBe("claude");
    expect(firstArgs).toEqual(["plugin", "marketplace", "add", "/pkg/root"]);

    expect(secondCmd).toBe("claude");
    expect(secondArgs).toEqual(["plugin", "install", PLUGIN_KEY]);
    expect(PLUGIN_KEY).toBe("freeflow@freeflow-local");
  });

  test("claudeUninstallPlugin: `claude plugin uninstall <key>`", () => {
    claudeUninstallPlugin();

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "uninstall", PLUGIN_KEY]);
  });

  test("claudeRemoveMarketplace: `claude plugin marketplace remove <name>`", () => {
    claudeRemoveMarketplace();

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
  });

  test("skillsRemove: `npx skills remove <names...> --agent <a> -y [-g]`", () => {
    skillsRemove({
      scope: "global",
      agent: "codex",
      skills: ["fflow", "fflow-author"],
    });

    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual([
      "--yes",
      "skills",
      "remove",
      "fflow",
      "fflow-author",
      "--agent",
      "codex",
      "-y",
      "-g",
    ]);
  });

  test("skillsRemove local scope omits -g", () => {
    skillsRemove({ scope: "local", agent: "codex", skills: ["fflow"] });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).not.toContain("-g");
  });

  test("skillsRemove throws if no skill names are provided (safety: never wipes '*')", () => {
    expect(() => skillsRemove({ scope: "global", agent: "codex", skills: [] })).toThrow(
      /at least one skill/,
    );
  });

  test("skillsRemove quiet pipes stdio", () => {
    skillsRemove({
      scope: "global",
      agent: "codex",
      skills: ["fflow"],
      quiet: true,
    });

    const call = execFileSyncMock.mock.calls[0];
    const stdioOpt = (call[2] as { stdio?: string } | undefined)?.stdio;
    expect(stdioOpt).toBe("pipe");
  });
});

describe("listBundledSkills", () => {
  const PACKAGE_ROOT = resolve(__dirname, "../..");

  test("returns the names of every directory under <packageRoot>/skills", () => {
    const names = listBundledSkills(PACKAGE_ROOT);

    // Real skills shipped with the package — if any of these disappear,
    // the uninstall flow needs to be rechecked.
    expect(names).toContain("fflow");
    expect(names).toContain("fflow-author");
    expect(names.length).toBeGreaterThan(0);
  });
});
