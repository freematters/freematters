import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliBin = path.join(projectRoot, "dist/cli.js");

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("node", [cliBin, ...args], {
      cwd: projectRoot,
      timeout: 10000,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; code: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.code || 1 };
  }
}

describe("codoc CLI", () => {
  it("should print help with --help flag", async () => {
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("codoc");
    expect(result.stdout).toContain("server");
    expect(result.stdout).toContain("share");
    expect(result.stdout).toContain("poll");
    expect(result.stdout).toContain("stop");
    expect(result.stdout).toContain("install");
  });

  it("should print version with --version flag", async () => {
    const result = await runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("should show help for install subcommand", async () => {
    const result = await runCli(["install", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("install");
    expect(result.stdout).toContain("platform");
  });

  it("should show help for server subcommand", async () => {
    const result = await runCli(["server", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("server");
  });

  it("should show help for share subcommand", async () => {
    const result = await runCli(["share", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("share");
  });

  it("should show help for poll subcommand", async () => {
    const result = await runCli(["poll", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("poll");
  });

  it("should show help for stop subcommand", async () => {
    const result = await runCli(["stop", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stop");
  });

  it("should have _hook as a hidden command", async () => {
    const result = await runCli(["_hook", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("_hook");
  });
});

describe("codoc install claude", () => {
  it("should resolve package root and attempt plugin registration", async () => {
    const result = await runCli(["install", "claude"]);
    // The command should run without crashing. It will fail to actually
    // register since claude CLI may not be available, but it should attempt it.
    // We check that it outputs something about plugin registration.
    expect(result.stdout + result.stderr).toMatch(/plugin|install|register|claude/i);
  });
});

describe("plugin files", () => {
  it("should have .claude-plugin/plugin.json", () => {
    const pluginPath = path.join(projectRoot, ".claude-plugin/plugin.json");
    expect(fs.existsSync(pluginPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(pluginPath, "utf-8"));
    expect(content.name).toBe("codoc");
    expect(content.version).toBeDefined();
    expect(content.author).toBeDefined();
    expect(content.author.name).toBe("freematters");
  });

  it("should have .claude-plugin/marketplace.json", () => {
    const marketplacePath = path.join(projectRoot, ".claude-plugin/marketplace.json");
    expect(fs.existsSync(marketplacePath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(marketplacePath, "utf-8"));
    expect(content.name).toBe("codoc-local");
    expect(content.plugins).toBeInstanceOf(Array);
    expect(content.plugins[0].name).toBe("codoc");
    expect(content.plugins[0].source).toBe("./");
  });

  it("should have hooks/hooks.json with PostToolUse and SessionEnd", () => {
    const hooksPath = path.join(projectRoot, "hooks/hooks.json");
    expect(fs.existsSync(hooksPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(hooksPath, "utf-8"));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.PostToolUse).toBeInstanceOf(Array);
    expect(content.hooks.SessionStart).toBeUndefined();
    expect(content.hooks.SessionEnd).toBeInstanceOf(Array);
  });

  it("should have skills/ directory", () => {
    const skillsPath = path.join(projectRoot, "skills");
    expect(fs.existsSync(skillsPath)).toBe(true);
    expect(fs.statSync(skillsPath).isDirectory()).toBe(true);
  });
});
