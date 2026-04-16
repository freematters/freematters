import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock, promptsMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  promptsMock: vi.fn(),
}));

const {
  detectInstalledMock,
  claudeAvailableMock,
  detectAllScopesMock,
  detectClaudePluginMock,
} = vi.hoisted(() => ({
  detectInstalledMock: vi.fn(),
  claudeAvailableMock: vi.fn(),
  detectAllScopesMock: vi.fn(),
  detectClaudePluginMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("prompts", () => ({
  default: promptsMock,
}));

vi.mock("../install-detect.js", () => ({
  detectInstalled: detectInstalledMock,
  claudeAvailable: claudeAvailableMock,
  detectAllInstalledScopes: detectAllScopesMock,
  detectClaudePlugin: detectClaudePluginMock,
}));

const { runInit } = await import("../commands/init.js");
const { CliError } = await import("../errors.js");

const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const WORKFLOWS_DIR = join(PACKAGE_ROOT, "workflows");

const origIsTTY = process.stdin.isTTY;

function findSkillsAddCalls(): readonly (readonly unknown[])[] {
  return execFileSyncMock.mock.calls.filter(
    (c) =>
      c[0] === "npx" &&
      Array.isArray(c[1]) &&
      c[1][0] === "--yes" &&
      c[1][1] === "skills" &&
      c[1][2] === "add",
  );
}

function findClaudeCalls(): readonly (readonly unknown[])[] {
  return execFileSyncMock.mock.calls.filter((c) => c[0] === "claude");
}

describe("runInit", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
    promptsMock.mockReset();
    detectInstalledMock.mockReset();
    claudeAvailableMock.mockReset();
    detectAllScopesMock.mockReset();
    detectClaudePluginMock.mockReset();

    detectInstalledMock.mockReturnValue(false);
    claudeAvailableMock.mockReturnValue(false);
    detectAllScopesMock.mockReturnValue([]);
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

  test("init default flow (no claude, local scope, TTY)", async () => {
    promptsMock.mockResolvedValueOnce({ scope: "local" });
    claudeAvailableMock.mockReturnValue(false);
    detectInstalledMock.mockReturnValue(false);

    await runInit({});

    expect(findClaudeCalls()).toHaveLength(0);

    const skillsAddCalls = findSkillsAddCalls();
    expect(skillsAddCalls).toHaveLength(2);

    const firstArgs = skillsAddCalls[0][1] as string[];
    const secondArgs = skillsAddCalls[1][1] as string[];

    expect(firstArgs[3]).toBe(SKILLS_DIR);
    expect(secondArgs[3]).toBe(WORKFLOWS_DIR);

    expect(firstArgs).not.toContain("-g");
    expect(secondArgs).not.toContain("-g");
    expect(firstArgs).not.toContain("--agent");
    expect(secondArgs).not.toContain("--agent");
  });

  test("init --global with hook consent", async () => {
    claudeAvailableMock.mockReturnValue(true);
    detectInstalledMock.mockReturnValue(false);
    promptsMock.mockResolvedValueOnce({ installHook: true });

    await runInit({ scope: "global" });

    const calls = execFileSyncMock.mock.calls;

    const marketplaceAddIdx = calls.findIndex(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "marketplace" &&
        c[1][2] === "add",
    );
    const pluginInstallIdx = calls.findIndex(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "install" &&
        c[1][2] === "freeflow@freeflow-local",
    );

    expect(marketplaceAddIdx).toBeGreaterThanOrEqual(0);
    expect(pluginInstallIdx).toBeGreaterThan(marketplaceAddIdx);

    const skillsAddCalls = findSkillsAddCalls();
    expect(skillsAddCalls).toHaveLength(2);

    const firstArgs = skillsAddCalls[0][1] as string[];
    const secondArgs = skillsAddCalls[1][1] as string[];

    expect(firstArgs).toContain("-g");
    expect(secondArgs).toContain("-g");
  });

  test("init -y on non-TTY, no scope flag → defaults to local", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    claudeAvailableMock.mockReturnValue(false);
    detectInstalledMock.mockReturnValue(false);

    await runInit({ yes: true });

    expect(promptsMock).not.toHaveBeenCalled();

    const skillsAddCalls = findSkillsAddCalls();
    expect(skillsAddCalls).toHaveLength(2);

    const firstArgs = skillsAddCalls[0][1] as string[];
    const secondArgs = skillsAddCalls[1][1] as string[];

    expect(firstArgs).not.toContain("-g");
    expect(secondArgs).not.toContain("-g");
  });

  test("init on non-TTY without -y or scope flag → errors", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(runInit({})).rejects.toBeInstanceOf(CliError);
    await expect(runInit({})).rejects.toMatchObject({
      code: "ARGS_INVALID",
    });

    const err = await runInit({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    const msg = (err as Error).message;
    expect(msg.includes("--local") || msg.includes("--global")).toBe(true);
  });

  test("non-TTY + claude available + no -y + no --no-hooks → throws", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    claudeAvailableMock.mockReturnValue(true);
    detectInstalledMock.mockReturnValue(false);

    await expect(runInit({ scope: "local" })).rejects.toBeInstanceOf(CliError);

    const err = await runInit({ scope: "local" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    const cliErr = err as InstanceType<typeof CliError>;
    expect(cliErr.code).toBe("ARGS_INVALID");
    expect(cliErr.message.includes("-y") || cliErr.message.includes("--no-hooks")).toBe(
      true,
    );
  });

  test("reinstall path — already installed, user confirms", async () => {
    detectInstalledMock.mockReturnValue(true);
    claudeAvailableMock.mockReturnValue(true);
    detectAllScopesMock.mockReturnValue(["local"]);
    detectClaudePluginMock.mockReturnValue(true);

    // Only the reinstall prompt fires; hooks skipped by noHooks flag.
    promptsMock.mockResolvedValueOnce({ reinstall: true });

    await runInit({ scope: "local", noHooks: true, yes: false });

    const calls = execFileSyncMock.mock.calls;

    const firstSkillsAddIdx = calls.findIndex(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "--yes" &&
        c[1][1] === "skills" &&
        c[1][2] === "add",
    );
    expect(firstSkillsAddIdx).toBeGreaterThanOrEqual(0);

    const skillsRemoveIdx = calls.findIndex(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "--yes" &&
        c[1][1] === "skills" &&
        c[1][2] === "remove",
    );
    const pluginUninstallIdx = calls.findIndex(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "uninstall",
    );
    const marketplaceRemoveIdx = calls.findIndex(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "marketplace" &&
        c[1][2] === "remove",
    );

    expect(skillsRemoveIdx).toBeGreaterThanOrEqual(0);
    expect(skillsRemoveIdx).toBeLessThan(firstSkillsAddIdx);

    expect(pluginUninstallIdx).toBeGreaterThanOrEqual(0);
    expect(pluginUninstallIdx).toBeLessThan(firstSkillsAddIdx);

    expect(marketplaceRemoveIdx).toBeGreaterThanOrEqual(0);
    expect(marketplaceRemoveIdx).toBeLessThan(firstSkillsAddIdx);
  });

  test("init rollback on skills failure", async () => {
    claudeAvailableMock.mockReturnValue(true);
    detectInstalledMock.mockReturnValue(false);
    detectAllScopesMock.mockReturnValue(["local"]);
    detectClaudePluginMock.mockReturnValue(true);

    promptsMock
      .mockResolvedValueOnce({ scope: "local" })
      .mockResolvedValueOnce({ installHook: true });

    const skillsAddError = new Error("skills add failed");

    let skillsAddCount = 0;
    execFileSyncMock.mockImplementation((cmd: string, args: readonly string[]) => {
      if (
        cmd === "npx" &&
        args[0] === "--yes" &&
        args[1] === "skills" &&
        args[2] === "add" &&
        ++skillsAddCount === 1
      ) {
        throw skillsAddError;
      }
      return Buffer.from("");
    });

    await expect(runInit({})).rejects.toBe(skillsAddError);

    const pluginUninstallCall = execFileSyncMock.mock.calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "uninstall" &&
        c[1][2] === "freeflow@freeflow-local",
    );
    expect(pluginUninstallCall).toBeDefined();

    const marketplaceRemoveCall = execFileSyncMock.mock.calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "marketplace" &&
        c[1][2] === "remove" &&
        c[1][3] === "freeflow-local",
    );
    expect(marketplaceRemoveCall).toBeDefined();
  });

  test("--no-hooks with claude present skips all Claude calls entirely", async () => {
    claudeAvailableMock.mockReturnValue(true);
    detectInstalledMock.mockReturnValue(false);

    await runInit({ scope: "local", noHooks: true, yes: false });

    expect(promptsMock).not.toHaveBeenCalled();
    expect(findClaudeCalls()).toHaveLength(0);
  });

  test("reinstall No path — user declines, no installation happens", async () => {
    detectInstalledMock.mockReturnValue(true);
    promptsMock.mockResolvedValueOnce({ reinstall: false });

    await runInit({ scope: "local" });

    const skillsRemoveCalls = execFileSyncMock.mock.calls.filter(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "--yes" &&
        c[1][1] === "skills" &&
        c[1][2] === "remove",
    );
    expect(skillsRemoveCalls).toHaveLength(0);

    const skillsAddCalls = findSkillsAddCalls();
    expect(skillsAddCalls).toHaveLength(0);
  });

  test("--agent <list> is forwarded verbatim", async () => {
    claudeAvailableMock.mockReturnValue(false);
    detectInstalledMock.mockReturnValue(false);

    await runInit({
      scope: "global",
      agent: "claude-code,cursor",
      yes: true,
    });

    const skillsAddCalls = findSkillsAddCalls();
    expect(skillsAddCalls).toHaveLength(2);

    for (const call of skillsAddCalls) {
      const args = call[1] as string[];
      const agentIdx = args.indexOf("--agent");
      expect(agentIdx).toBeGreaterThanOrEqual(0);
      expect(args[agentIdx + 1]).toBe("claude-code,cursor");
      expect(args).toContain("-g");
    }
  });
});
