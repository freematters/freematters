import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { normalizeDeinitOpts, normalizeInitOpts } from "../commands/init-opts.js";
import { CliError } from "../errors.js";

const PACKAGE_ROOT = resolve(__dirname, "../..");
const cliPath = join(PACKAGE_ROOT, "dist/cli.js");

describe("normalizeInitOpts", () => {
  test("throws ARGS_INVALID when --local and --global are both set", () => {
    try {
      normalizeInitOpts({ local: true, global: true });
      throw new Error("expected normalizeInitOpts to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("ARGS_INVALID");
      expect(cliErr.message).toBe("cannot combine --local and --global");
    }
  });
});

describe("normalizeDeinitOpts", () => {
  test("throws ARGS_INVALID when --all and --local are both set", () => {
    try {
      normalizeDeinitOpts({ all: true, local: true });
      throw new Error("expected normalizeDeinitOpts to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("ARGS_INVALID");
      expect(cliErr.message).toContain("--all");
      expect(cliErr.message).toContain("--local");
    }
  });

  test("throws ARGS_INVALID when --all and --global are both set", () => {
    try {
      normalizeDeinitOpts({ all: true, global: true });
      throw new Error("expected normalizeDeinitOpts to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      const cliErr = err as CliError;
      expect(cliErr.code).toBe("ARGS_INVALID");
      expect(cliErr.message).toContain("--all");
      expect(cliErr.message).toContain("--global");
    }
  });
});

describe.skipIf(!existsSync(cliPath))("compiled CLI --help", () => {
  test("lists init and deinit subcommands but not install", () => {
    const help = execFileSync("node", [cliPath, "--help"], {
      encoding: "utf8",
    });
    expect(help).toMatch(/^\s*init\b/m);
    expect(help).toMatch(/^\s*deinit\b/m);
    expect(help).not.toMatch(/^\s*install\b/m);
  });
});
