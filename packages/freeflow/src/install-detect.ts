import { execFileSync } from "node:child_process";

/** True if the `claude` binary is on PATH. */
export function claudeAvailable(): boolean {
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
