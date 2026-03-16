import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const CLI_PATH = resolve(import.meta.dirname, "../../dist/cli.js");

function run(args: string[]): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { stdout: (e.stdout || e.stderr || "").trim(), exitCode: e.status };
  }
}

describe("CLI entry point", () => {
  test("prints usage and exits with code 1 when no args given", () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("Usage");
  });

  test("prints greeting when name argument is provided", () => {
    const { exitCode, stdout } = run(["World"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("Hello, World!");
  });
});
