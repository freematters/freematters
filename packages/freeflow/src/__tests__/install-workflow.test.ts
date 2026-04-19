import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock, promptsMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  promptsMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("prompts", () => ({
  default: promptsMock,
}));

const { runInstallWorkflow } = await import("../commands/install-workflow.js");
const { CliError } = await import("../errors.js");

const PACKAGE_ROOT = resolve(__dirname, "../..");
const WORKFLOWS_DIR = join(PACKAGE_ROOT, "workflows");

const origIsTTY = process.stdin.isTTY;

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

describe("runInstallWorkflow", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
    promptsMock.mockReset();

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

  test("--local lets the skills CLI prompt for workflow + agent selection", async () => {
    await runInstallWorkflow({ scope: "local" });

    const call = findSkillsAddCall();
    expect(call).toBeDefined();
    const args = call?.[1] as string[];

    // target dir is the bundled workflows/
    expect(args[3]).toBe(WORKFLOWS_DIR);

    // no --skill / --agent → skills CLI runs its own interactive pickers
    expect(args).not.toContain("--skill");
    expect(args).not.toContain("--agent");

    // no -y → skills CLI confirmation stays live
    expect(args).not.toContain("-y");

    // local scope → no -g
    expect(args).not.toContain("-g");
  });

  test("--global adds -g and keeps the interactive pickers", async () => {
    await runInstallWorkflow({ scope: "global" });

    const args = findSkillsAddCall()?.[1] as string[];
    expect(args).not.toContain("--skill");
    expect(args).not.toContain("--agent");
    expect(args).toContain("-g");
  });

  test("-y installs every workflow for claude-code + codex and skips prompts", async () => {
    await runInstallWorkflow({ yes: true });

    expect(promptsMock).not.toHaveBeenCalled();

    const args = findSkillsAddCall()?.[1] as string[];
    expect(args).toContain("--skill");
    expect(args[args.indexOf("--skill") + 1]).toBe("*");
    const agentIdx = args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(args[agentIdx + 1]).toBe("claude-code");
    expect(args[agentIdx + 2]).toBe("codex");
    expect(args).toContain("-y");
    // default scope under -y is local
    expect(args).not.toContain("-g");
  });

  test("non-TTY + -y + no scope → defaults to local", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await runInstallWorkflow({ yes: true });

    const args = findSkillsAddCall()?.[1] as string[];
    expect(args).toContain("--skill");
    expect(args).toContain("-y");
    expect(args).not.toContain("-g");
  });

  test("non-TTY without -y or scope → errors", async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });

    await expect(runInstallWorkflow({})).rejects.toBeInstanceOf(CliError);
    const err = await runInstallWorkflow({}).catch((e: unknown) => e);
    expect((err as InstanceType<typeof CliError>).code).toBe("ARGS_INVALID");
  });
});
