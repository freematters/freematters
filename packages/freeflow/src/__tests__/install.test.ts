import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const CLI = resolve(__dirname, "../../dist/cli.js");
const PACKAGE_ROOT = resolve(__dirname, "../..");

function cli(args: string): string {
  return execFileSync("node", [CLI, ...args.split(/\s+/)], {
    encoding: "utf-8",
  });
}

function hasCommand(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

// ─── Codex install ──────────────────────────────────────────────

const describeCodex = describe.skipIf(!hasCommand("codex"));

describeCodex("install codex", () => {
  const agentsDir = join(homedir(), ".agents", "skills");
  const target = join(agentsDir, "freeflow");
  const backup = `${target}.bak`;

  // Snapshot for restore
  let savedLink: string | null = null;
  let hadTarget = false;

  beforeAll(() => {
    if (existsSync(target)) {
      hadTarget = true;
      try {
        savedLink = readlinkSync(target);
      } catch {
        savedLink = null;
      }
    }
  });

  afterAll(() => {
    // Clean up test artifacts
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });

    // Restore original state
    if (hadTarget && savedLink) {
      mkdirSync(agentsDir, { recursive: true });
      symlinkSync(savedLink, target);
    }
  });

  test("creates symlink to skills directory", () => {
    // Clean slate
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });

    const stdout = cli("install codex");
    expect(stdout).toContain("FreeFlow skills linked for Codex");

    expect(existsSync(target)).toBe(true);
    expect(lstatSync(target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(target)).toBe(join(PACKAGE_ROOT, "skills"));
  });

});

// ─── Claude install ─────────────────────────────────────────────

const describeClaude = describe.skipIf(!hasCommand("claude"));

describeClaude("install claude", () => {
  const pluginsDir = join(homedir(), ".claude", "plugins");
  const knownPath = join(pluginsDir, "known_marketplaces.json");
  const installedPath = join(pluginsDir, "installed_plugins.json");
  const knownBackup = `${knownPath}.bak`;
  const installedBackup = `${installedPath}.bak`;

  beforeAll(() => {
    // Snapshot existing plugin state
    if (existsSync(knownPath)) copyFileSync(knownPath, knownBackup);
    if (existsSync(installedPath)) copyFileSync(installedPath, installedBackup);
  });

  afterAll(() => {
    // Restore original plugin state
    if (existsSync(knownBackup)) {
      copyFileSync(knownBackup, knownPath);
      rmSync(knownBackup);
    }
    if (existsSync(installedBackup)) {
      copyFileSync(installedBackup, installedPath);
      rmSync(installedBackup);
    }
  });

  test("registers marketplace and installs plugin", () => {
    const stdout = cli("install claude");
    expect(stdout).toContain("FreeFlow plugin installed for Claude Code");

    const known = JSON.parse(readFileSync(knownPath, "utf-8"));
    expect(known["freeflow-local"]).toBeDefined();
    expect(known["freeflow-local"].source.source).toBe("directory");
    expect(known["freeflow-local"].source.path).toBe(PACKAGE_ROOT);

    const installed = JSON.parse(readFileSync(installedPath, "utf-8"));
    expect(installed.plugins["freeflow@freeflow-local"]).toBeDefined();
    expect(installed.plugins["freeflow@freeflow-local"].length).toBeGreaterThan(0);
  });

});

// ─── End-to-end workflow ────────────────────────────────────────

const HELLO_WORKFLOW = `\
version: 1
guide: "Say hello workflow"
initial: greet
states:
  greet:
    prompt: "Say hello to the user."
    transitions:
      next: done
  done:
    prompt: "Say goodbye."
    transitions: {}
`;

describe("workflow e2e after install", () => {
  let tmp: string;
  let fsmPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "freeflow-install-e2e-"));
    fsmPath = join(tmp, "hello.yaml");
    writeFileSync(fsmPath, HELLO_WORKFLOW, "utf-8");
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("create workflow yaml and start a run", () => {
    // Verify the workflow file was created
    expect(existsSync(fsmPath)).toBe(true);
    const yaml = readFileSync(fsmPath, "utf-8");
    expect(yaml).toContain("Say hello workflow");
    expect(yaml).toContain("greet");
    expect(yaml).toContain("done");

    // Start a run using the workflow
    const root = join(tmp, "root");
    const startOut = cli(`start ${fsmPath} --run-id hello-run --root ${root}`);
    expect(startOut).toContain("FSM started.");
    expect(startOut).toContain("You are in **greet** state.");
    expect(startOut).toContain("Say hello to the user.");
    expect(startOut).toContain("next → done");

    // Verify current state
    const currentOut = cli(`current --run-id hello-run --root ${root}`);
    expect(currentOut).toContain("You are in **greet** state.");

    // Transition to done
    const gotoOut = cli(`goto done --run-id hello-run --on next --root ${root}`);
    expect(gotoOut).toContain("You are in **done** state.");
    expect(gotoOut).toContain("Say goodbye.");
  });

  test("start with JSON output", () => {
    const root = join(tmp, "root-json");
    const stdout = cli(`start ${fsmPath} --run-id hello-json -j --root ${root}`);
    const envelope = JSON.parse(stdout);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.state).toBe("greet");
    expect(envelope.data.prompt).toBe("Say hello to the user.");
    expect(envelope.data.transitions).toEqual({ next: "done" });
  });
});
