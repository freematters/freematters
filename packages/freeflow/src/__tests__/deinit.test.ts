import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock, promptsMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  promptsMock: vi.fn(),
}));

const { detectAllScopesMock, claudeAvailableMock, detectClaudePluginMock } = vi.hoisted(
  () => ({
    detectAllScopesMock: vi.fn(),
    claudeAvailableMock: vi.fn(),
    detectClaudePluginMock: vi.fn(),
  }),
);

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("prompts", () => ({
  default: promptsMock,
}));

vi.mock("../install-detect.js", () => ({
  detectAllInstalledScopes: detectAllScopesMock,
  claudeAvailable: claudeAvailableMock,
  detectClaudePlugin: detectClaudePluginMock,
}));

const { runDeinit } = await import("../commands/deinit.js");
const { CliError } = await import("../errors.js");

const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const WORKFLOWS_DIR = join(PACKAGE_ROOT, "workflows");

const origIsTTY = process.stdin.isTTY;

function findSkillsRemoveCall(
  dir: string,
  global: boolean,
): readonly unknown[] | undefined {
  return execFileSyncMock.mock.calls.find(
    (c) =>
      c[0] === "npx" &&
      Array.isArray(c[1]) &&
      c[1][0] === "skills" &&
      c[1][1] === "remove" &&
      c[1][2] === dir &&
      (global ? c[1].includes("-g") : !c[1].includes("-g")),
  );
}

describe("runDeinit", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
    promptsMock.mockReset();
    detectAllScopesMock.mockReset();
    claudeAvailableMock.mockReset();
    detectClaudePluginMock.mockReset();

    claudeAvailableMock.mockReturnValue(false);
    detectClaudePluginMock.mockReturnValue(false);

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: origIsTTY,
      configurable: true,
    });
  });

  test("auto-detect single populated scope (local) with -y: no prompt, no -g", async () => {
    detectAllScopesMock.mockReturnValue(["local"]);

    await runDeinit({ yes: true });

    expect(promptsMock).not.toHaveBeenCalled();

    const skillsCall = findSkillsRemoveCall(SKILLS_DIR, false);
    expect(skillsCall?.[1]).toEqual([
      "skills",
      "remove",
      SKILLS_DIR,
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
    ]);

    const workflowsCall = findSkillsRemoveCall(WORKFLOWS_DIR, false);
    expect(workflowsCall?.[1]).toEqual([
      "skills",
      "remove",
      WORKFLOWS_DIR,
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
    ]);

    expect(findSkillsRemoveCall(SKILLS_DIR, true)).toBeUndefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, true)).toBeUndefined();
  });

  test("auto-detect single populated scope (global) with -y: includes -g", async () => {
    detectAllScopesMock.mockReturnValue(["global"]);

    await runDeinit({ yes: true });

    expect(promptsMock).not.toHaveBeenCalled();

    const skillsCall = findSkillsRemoveCall(SKILLS_DIR, true);
    expect(skillsCall?.[1]).toEqual([
      "skills",
      "remove",
      SKILLS_DIR,
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
      "-g",
    ]);

    const workflowsCall = findSkillsRemoveCall(WORKFLOWS_DIR, true);
    expect(workflowsCall?.[1]).toEqual([
      "skills",
      "remove",
      WORKFLOWS_DIR,
      "--skill",
      "*",
      "--agent",
      "*",
      "-y",
      "-g",
    ]);
  });

  test("both scopes populated → prompt asks which, answer local", async () => {
    detectAllScopesMock.mockReturnValue(["local", "global"]);
    promptsMock
      .mockResolvedValueOnce({ targets: ["local"] })
      .mockResolvedValueOnce({ confirm: true });

    await runDeinit({});

    expect(promptsMock).toHaveBeenCalledTimes(2);

    // Only local-scope removal calls fire (no -g).
    expect(findSkillsRemoveCall(SKILLS_DIR, false)).toBeDefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, false)).toBeDefined();
    expect(findSkillsRemoveCall(SKILLS_DIR, true)).toBeUndefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, true)).toBeUndefined();
  });

  test("destructive confirmation N → exit early, zero removal calls", async () => {
    detectAllScopesMock.mockReturnValue(["local"]);
    promptsMock.mockResolvedValueOnce({ confirm: false });

    await runDeinit({});

    // No skills remove calls.
    const removalCalls = execFileSyncMock.mock.calls.filter(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "skills" &&
        c[1][1] === "remove",
    );
    expect(removalCalls).toHaveLength(0);

    // No claude plugin calls either.
    const claudeCalls = execFileSyncMock.mock.calls.filter((c) => c[0] === "claude");
    expect(claudeCalls).toHaveLength(0);
  });

  test("idempotent on clean system: no removal calls, prints 'Nothing to remove'", async () => {
    detectAllScopesMock.mockReturnValue([]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runDeinit({});

      const removalCalls = execFileSyncMock.mock.calls.filter(
        (c) =>
          c[0] === "npx" &&
          Array.isArray(c[1]) &&
          c[1][0] === "skills" &&
          c[1][1] === "remove",
      );
      expect(removalCalls).toHaveLength(0);

      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("Nothing to remove");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("aggregation: one task fails, all others still run, throws DEINIT_FAILED", async () => {
    detectAllScopesMock.mockReturnValue(["local"]);
    claudeAvailableMock.mockReturnValue(true);
    detectClaudePluginMock.mockReturnValue(true);

    // Make the workflows removal throw; others succeed.
    execFileSyncMock.mockImplementation((cmd: string, args: readonly string[]) => {
      if (
        cmd === "npx" &&
        args[0] === "skills" &&
        args[1] === "remove" &&
        args[2] === WORKFLOWS_DIR
      ) {
        throw new Error("workflows remove failed");
      }
      return Buffer.from("");
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(runDeinit({ yes: true })).rejects.toMatchObject({
        code: "DEINIT_FAILED",
      });
    } finally {
      logSpy.mockRestore();
    }

    // All four tasks should have been attempted.
    expect(findSkillsRemoveCall(SKILLS_DIR, false)).toBeDefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, false)).toBeDefined();

    const uninstallCall = execFileSyncMock.mock.calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "uninstall",
    );
    expect(uninstallCall).toBeDefined();

    const marketplaceRemoveCall = execFileSyncMock.mock.calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "marketplace" &&
        c[1][2] === "remove",
    );
    expect(marketplaceRemoveCall).toBeDefined();
  });

  test("--all targets both scopes even if detection returns empty", async () => {
    detectAllScopesMock.mockReturnValue([]);

    await runDeinit({ scope: "all", yes: true });

    // 4 skill removal calls total (skills/workflows × local/global).
    expect(findSkillsRemoveCall(SKILLS_DIR, false)).toBeDefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, false)).toBeDefined();
    expect(findSkillsRemoveCall(SKILLS_DIR, true)).toBeDefined();
    expect(findSkillsRemoveCall(WORKFLOWS_DIR, true)).toBeDefined();
  });

  test("non-TTY + both scopes populated + no scope + no -y → throws ARGS_INVALID", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    detectAllScopesMock.mockReturnValue(["local", "global"]);

    await expect(runDeinit({})).rejects.toBeInstanceOf(CliError);
    await expect(runDeinit({})).rejects.toMatchObject({
      code: "ARGS_INVALID",
    });
  });
});
