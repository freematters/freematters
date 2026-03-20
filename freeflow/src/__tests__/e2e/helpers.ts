import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI = resolve(__dirname, "../../../dist/cli.js");

/**
 * Read a JSONL file and parse each line as JSON.
 */
export function readJsonl<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf-8").trim();
  if (!content) return [];
  return content.split("\n").map((line) => JSON.parse(line) as T);
}

/**
 * Run the freefsm CLI with the given args string.
 * By default throws on non-zero exit; set expectFail to allow failures.
 */
export function runCli(
  args: string,
  opts: { expectFail?: boolean; env?: Record<string, string | undefined> } = {},
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args.split(/\s+/)], {
      encoding: "utf-8",
      env: { ...process.env, ...opts.env },
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { status: number; stdout: string; stderr: string };
    if (!opts.expectFail) {
      throw new Error(
        `CLI failed unexpectedly (exit ${e.status}):\n${e.stderr}\n${e.stdout}`,
      );
    }
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status };
  }
}
