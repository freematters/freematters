import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  normalizeInitOpts,
  normalizeInstallWorkflowOpts,
} from "../commands/init-opts.js";
import { CliError } from "../errors.js";

const PACKAGE_ROOT = resolve(__dirname, "../..");
const cliPath = join(PACKAGE_ROOT, "dist/cli.js");

describe("normalizeInitOpts", () => {
  test("empty by default; unknown flags are ignored", () => {
    expect(normalizeInitOpts({})).toEqual({});
    expect(normalizeInitOpts({ local: true, agent: "x" })).toEqual({});
  });

  test("picks up --uninstall as uninstall: true", () => {
    expect(normalizeInitOpts({ uninstall: true })).toEqual({ uninstall: true });
  });
});

describe("normalizeInstallWorkflowOpts", () => {
  test("throws ARGS_INVALID when --local and --global are both set", () => {
    try {
      normalizeInstallWorkflowOpts({ local: true, global: true });
      throw new Error("expected normalizeInstallWorkflowOpts to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("ARGS_INVALID");
      expect(cliErr.message).toBe("cannot combine --local and --global");
    }
  });

  test("extracts scope and yes from raw flags (agent is ignored — --all always sent)", () => {
    expect(
      normalizeInstallWorkflowOpts({
        global: true,
        agent: "claude-code,cursor",
        yes: true,
      }),
    ).toEqual({
      scope: "global",
      yes: true,
    });
  });
});

describe.skipIf(!existsSync(cliPath))("compiled CLI --help", () => {
  test("lists init and install-workflow subcommands but not install or deinit", () => {
    const help = execFileSync("node", [cliPath, "--help"], {
      encoding: "utf8",
    });
    expect(help).toMatch(/^\s*init\b/m);
    expect(help).toMatch(/^\s*install-workflow\b/m);
    expect(help).not.toMatch(/^\s*install\s/m);
    expect(help).not.toMatch(/^\s*deinit\b/m);
  });
});
