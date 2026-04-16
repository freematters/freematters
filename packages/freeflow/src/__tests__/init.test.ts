import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

const { claudeAvailableMock } = vi.hoisted(() => ({
  claudeAvailableMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("../install-detect.js", () => ({
  claudeAvailable: claudeAvailableMock,
}));

const { runInit } = await import("../commands/init.js");
const { CliError } = await import("../errors.js");

function findSkillsAddCall(): readonly unknown[] | undefined {
  return execFileSyncMock.mock.calls.find(
    (c) =>
      c[0] === "npx" &&
      Array.isArray(c[1]) &&
      c[1][0] === "--yes" &&
      c[1][1] === "skills" &&
      c[1][2] === "add",
  );
}

function findSkillsRemoveCall(): readonly unknown[] | undefined {
  return execFileSyncMock.mock.calls.find(
    (c) =>
      c[0] === "npx" &&
      Array.isArray(c[1]) &&
      c[1][0] === "--yes" &&
      c[1][1] === "skills" &&
      c[1][2] === "remove",
  );
}

describe("runInit", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
    claudeAvailableMock.mockReset();
  });

  test("installs claude plugin via marketplace add then plugin install", async () => {
    claudeAvailableMock.mockReturnValue(true);

    await runInit();

    const claudeCalls = execFileSyncMock.mock.calls.filter((c) => c[0] === "claude");
    expect(claudeCalls).toHaveLength(2);

    expect(claudeCalls[0][1]).toEqual([
      "plugin",
      "marketplace",
      "add",
      expect.any(String),
    ]);
    expect(claudeCalls[1][1]).toEqual(["plugin", "install", "freeflow@freeflow-local"]);
  });

  test("also installs codex skills globally via `npx skills add --agent codex`", async () => {
    claudeAvailableMock.mockReturnValue(true);

    await runInit();

    const call = findSkillsAddCall();
    expect(call).toBeDefined();
    const args = call?.[1] as string[];

    // target dir is the bundled package skills/
    expect(args[3]).toMatch(/[\\/]skills$/);

    // -g (global)
    expect(args).toContain("-g");

    // --agent codex
    const agentIdx = args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(args[agentIdx + 1]).toBe("codex");

    // non-interactive: --skill '*' and -y
    expect(args).toContain("--skill");
    expect(args[args.indexOf("--skill") + 1]).toBe("*");
    expect(args).toContain("-y");

    // quiet: stdio is piped (not inherited) so the skills CLI doesn't spam output
    const stdioOpt = (call?.[2] as { stdio?: string } | undefined)?.stdio;
    expect(stdioOpt).toBe("pipe");
  });

  test("throws CLAUDE_NOT_FOUND when claude binary is missing", async () => {
    claudeAvailableMock.mockReturnValue(false);

    await expect(runInit()).rejects.toBeInstanceOf(CliError);

    const err = await runInit().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as InstanceType<typeof CliError>).code).toBe("CLAUDE_NOT_FOUND");

    // No subprocess fired at all.
    expect(execFileSyncMock).not.toHaveBeenCalledWith(
      "claude",
      expect.anything(),
      expect.anything(),
    );
  });

  describe("--uninstall", () => {
    test("uninstalls claude plugin, removes marketplace, and removes codex skills", async () => {
      claudeAvailableMock.mockReturnValue(true);

      await runInit({ uninstall: true });

      const claudeCalls = execFileSyncMock.mock.calls.filter((c) => c[0] === "claude");
      // plugin uninstall + marketplace remove
      expect(claudeCalls).toHaveLength(2);
      expect(claudeCalls[0][1]).toEqual([
        "plugin",
        "uninstall",
        "freeflow@freeflow-local",
      ]);
      expect(claudeCalls[1][1]).toEqual([
        "plugin",
        "marketplace",
        "remove",
        "freeflow-local",
      ]);

      // No install-side calls leaked through.
      expect(
        execFileSyncMock.mock.calls.some(
          (c) => c[0] === "claude" && Array.isArray(c[1]) && c[1][1] === "install",
        ),
      ).toBe(false);
      expect(findSkillsAddCall()).toBeUndefined();

      const removeCall = findSkillsRemoveCall();
      expect(removeCall).toBeDefined();
      const args = removeCall?.[1] as string[];

      // --agent codex and -g (global)
      expect(args).toContain("-g");
      const agentIdx = args.indexOf("--agent");
      expect(agentIdx).toBeGreaterThanOrEqual(0);
      expect(args[agentIdx + 1]).toBe("codex");

      // Targeted skill names — never '*' — so user-owned codex skills survive.
      expect(args).not.toContain("*");
      // Positional skill names sit between `remove` and the first flag.
      const firstFlagIdx = args.findIndex((a, i) => i >= 3 && a.startsWith("-"));
      const skillNames = args.slice(3, firstFlagIdx);
      expect(skillNames.length).toBeGreaterThan(0);
      expect(skillNames).toContain("fflow");
      expect(skillNames).toContain("fflow-author");
    });

    test("uninstall is best-effort: codex skills are still removed even if claude uninstall fails", async () => {
      claudeAvailableMock.mockReturnValue(true);
      execFileSyncMock.mockImplementation((cmd: string, argv: readonly string[]) => {
        if (cmd === "claude" && argv[1] === "uninstall") {
          throw new Error("plugin not installed");
        }
        return Buffer.from("");
      });

      await runInit({ uninstall: true });

      // Claude marketplace remove still runs after the uninstall failure.
      const marketplaceRemove = execFileSyncMock.mock.calls.find(
        (c) =>
          c[0] === "claude" &&
          Array.isArray(c[1]) &&
          c[1][1] === "marketplace" &&
          c[1][2] === "remove",
      );
      expect(marketplaceRemove).toBeDefined();

      // And codex skills removal also runs.
      expect(findSkillsRemoveCall()).toBeDefined();
    });
  });
});
