import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getDefaultSocketPath(): string {
  const user = process.env.USER ?? "unknown";
  const dir = path.join("/tmp", user);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "codoc.sock");
}

export function getDefaultTokensPath(): string {
  return path.join(os.homedir(), ".codoc", "tokens.json");
}

export function readSessionIdFromStdin(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        const parsed = JSON.parse(data);
        resolve(parsed.session_id ?? null);
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => {
      resolve(null);
    });
  });
}
