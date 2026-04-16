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
  PLUGIN_KEY,
  MARKETPLACE_NAME,
} = await import("../runners.js");

describe("runners", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
  });

  test("skillsAdd local scope: npx skills add <dir> --skill '*' (no -g)", () => {
    skillsAdd("/some/dir", { scope: "local" });

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual(["skills", "add", "/some/dir", "--skill", "*"]);
  });

  test("skillsAdd global scope includes -g", () => {
    skillsAdd("/some/dir", { scope: "global" });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual(["skills", "add", "/some/dir", "--skill", "*", "-g"]);
  });

  test("skillsAdd with agent appends --agent <list> verbatim", () => {
    skillsAdd("/some/dir", { scope: "local", agent: "claude-code,cursor" });

    const [, args] = execFileSyncMock.mock.calls[0];
    expect(args).toEqual([
      "skills",
      "add",
      "/some/dir",
      "--skill",
      "*",
      "--agent",
      "claude-code,cursor",
    ]);
  });

  test("skillsRemove local scope: npx skills remove <dir> --skill '*' --agent '*' -y", () => {
    skillsRemove("/some/dir", { scope: "local" });

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("npx");
    expect(args).toEqual([
      "skills",
      "remove",
      "/some/dir",
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
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

  test("claudeUninstallPlugin: claude plugin uninstall freeflow@freeflow-local", () => {
    claudeUninstallPlugin();

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "uninstall", "freeflow@freeflow-local"]);
  });

  test("claudeRemoveMarketplace: claude plugin marketplace remove freeflow-local", () => {
    claudeRemoveMarketplace();

    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileSyncMock.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toEqual(["plugin", "marketplace", "remove", MARKETPLACE_NAME]);
    expect(MARKETPLACE_NAME).toBe("freeflow-local");
  });
});
