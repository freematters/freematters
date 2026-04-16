import { join, resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    realpathSync: (p: string) => p,
  };
});

const {
  claudeAvailable,
  detectInstalled,
  detectAllInstalledScopes,
  detectClaudePlugin,
} = await import("../install-detect.js");

const PACKAGE_ROOT = resolve(__dirname, "../..");

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

describe("detectInstalled", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  test("returns true when a skill's source resolves under packageRoot", () => {
    const underPkg = join(PACKAGE_ROOT, "skills/fflow");
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (
        cmd === "npx" &&
        args[0] === "--yes" &&
        args[1] === "skills" &&
        args[2] === "ls"
      ) {
        return Buffer.from(JSON.stringify([{ name: "fflow", source: underPkg }]));
      }
      return Buffer.from("");
    });

    expect(detectInstalled("local")).toBe(true);
  });

  test("returns false when no skill source resolves under packageRoot", () => {
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (
        cmd === "npx" &&
        args[0] === "--yes" &&
        args[1] === "skills" &&
        args[2] === "ls"
      ) {
        return Buffer.from(
          JSON.stringify([
            { name: "unrelated", source: "/tmp/unrelated/skills/fflow" },
          ]),
        );
      }
      return Buffer.from("");
    });

    expect(detectInstalled("local")).toBe(false);
  });
});

describe("detectAllInstalledScopes", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  test("composes both scope probes and returns the populated set", () => {
    const underPkg = join(PACKAGE_ROOT, "skills/fflow");
    execFileSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (
        cmd === "npx" &&
        args[0] === "--yes" &&
        args[1] === "skills" &&
        args[2] === "ls"
      ) {
        // global invocation carries -g; local does not
        const isGlobal = args.includes("-g");
        if (isGlobal) {
          return Buffer.from(JSON.stringify([]));
        }
        return Buffer.from(JSON.stringify([{ name: "fflow", source: underPkg }]));
      }
      return Buffer.from("");
    });

    expect(detectAllInstalledScopes()).toEqual(["local"]);
  });
});

describe("detectClaudePlugin", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  test("returns true when `claude plugin list` output contains freeflow@freeflow-local", () => {
    execFileSyncMock.mockImplementation(() =>
      Buffer.from("plugins:\n  freeflow@freeflow-local (enabled)\n"),
    );
    expect(detectClaudePlugin()).toBe(true);
  });

  test("returns false when output does not contain the plugin key", () => {
    execFileSyncMock.mockImplementation(() => Buffer.from("plugins:\n  (none)\n"));
    expect(detectClaudePlugin()).toBe(false);
  });

  test("returns false when `claude` throws `not found`", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("claude: not found");
    });
    expect(detectClaudePlugin()).toBe(false);
  });
});
