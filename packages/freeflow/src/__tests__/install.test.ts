import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: execFileSyncMock,
  };
});

const { install } = await import("../commands/install.js");

const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const WORKFLOWS_DIR = join(PACKAGE_ROOT, "workflows");

// ─── Install: claude backend ────────────────────────────────────

describe("install claude (with stubbed execFileSync)", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  test("plugin install is invoked, then npx skills install twice (in order)", () => {
    install("claude");

    const calls = execFileSyncMock.mock.calls;

    const claudePluginInstallIdx = calls.findIndex(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "install",
    );
    expect(claudePluginInstallIdx).toBeGreaterThanOrEqual(0);

    const npxCalls = calls.filter(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "skills" &&
        c[1][1] === "install",
    );
    expect(npxCalls).toHaveLength(2);

    // Order: plugin install before both npx calls
    const firstNpxIdx = calls.findIndex(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "skills" &&
        c[1][1] === "install",
    );
    expect(firstNpxIdx).toBeGreaterThan(claudePluginInstallIdx);

    // Verify both parent dir paths in order: skills then workflows
    expect(npxCalls[0][1]).toEqual(["skills", "install", SKILLS_DIR]);
    expect(npxCalls[1][1]).toEqual(["skills", "install", WORKFLOWS_DIR]);
  });

  test("on npx skills install failure on second call, plugin uninstall is invoked and exits non-zero", () => {
    let npxCount = 0;
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "npx" && args[0] === "skills" && args[1] === "install") {
        npxCount += 1;
        if (npxCount === 2) {
          throw new Error("npx skills install failed");
        }
      }
      return Buffer.from("");
    });

    expect(() => install("claude")).toThrow();

    const calls = execFileSyncMock.mock.calls;
    const uninstallCall = calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "uninstall" &&
        c[1][2] === "freeflow@freeflow-local",
    );
    expect(uninstallCall).toBeDefined();
  });
});

// ─── Install: codex backend ─────────────────────────────────────

describe("install codex (with stubbed execFileSync)", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation(() => Buffer.from(""));
  });

  afterEach(() => {
    execFileSyncMock.mockReset();
  });

  test("no symlink is created at ~/.agents/skills/freeflow and npx skills install is invoked twice", () => {
    const agentsTarget = join(process.env.HOME || "", ".agents", "skills", "freeflow");
    const preExists = existsSync(agentsTarget);

    install("codex");

    // No new symlink created by install: if it didn't exist before, it still doesn't.
    if (!preExists) {
      expect(existsSync(agentsTarget)).toBe(false);
    }

    const npxCalls = execFileSyncMock.mock.calls.filter(
      (c) =>
        c[0] === "npx" &&
        Array.isArray(c[1]) &&
        c[1][0] === "skills" &&
        c[1][1] === "install",
    );
    expect(npxCalls).toHaveLength(2);
    expect(npxCalls[0][1]).toEqual(["skills", "install", SKILLS_DIR]);
    expect(npxCalls[1][1]).toEqual(["skills", "install", WORKFLOWS_DIR]);
  });

  test("on npx skills install failure, exits non-zero and no plugin rollback is attempted", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "npx" && args[0] === "skills" && args[1] === "install") {
        throw new Error("npx skills install failed");
      }
      return Buffer.from("");
    });

    expect(() => install("codex")).toThrow();

    const uninstallCall = execFileSyncMock.mock.calls.find(
      (c) =>
        c[0] === "claude" &&
        Array.isArray(c[1]) &&
        c[1][0] === "plugin" &&
        c[1][1] === "uninstall",
    );
    expect(uninstallCall).toBeUndefined();
  });
});

// ─── Repo shape ─────────────────────────────────────────────────

describe("repo shape", () => {
  test("packages/freeflow/skills/markdown-fix/ does not exist", () => {
    expect(existsSync(join(PACKAGE_ROOT, "skills", "markdown-fix"))).toBe(false);
  });
});
