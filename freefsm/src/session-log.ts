import { existsSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Derive the Claude session directory for a given working directory.
 * Convention: ~/.claude/projects/<encoded-cwd>/ where non-alphanumeric
 * characters in cwd are replaced with '-'.
 */
export function getSessionDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

/**
 * Find a Claude session JSONL log file by session ID.
 * Uses the deterministic session directory convention.
 */
export function findSessionLog(sessionId: string): string | null {
  const sessionDir = getSessionDir(process.cwd());
  const candidate = join(sessionDir, `${sessionId}.jsonl`);
  return existsSync(candidate) ? candidate : null;
}

/**
 * Symlink a Claude session JSONL log into a destination directory.
 * No-op if sessionId is null or the log file is not found.
 */
export function symlinkSessionLog(
  sessionId: string | null,
  destDir: string,
  name: string,
): void {
  if (!sessionId) return;
  const logPath = findSessionLog(sessionId);
  if (!logPath) return;
  try {
    symlinkSync(logPath, join(destDir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      process.stderr.write(`Warning: failed to symlink session log: ${err}\n`);
    }
  }
}
