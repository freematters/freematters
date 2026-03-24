import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodocConfig {
  tunnel: "cloudflare" | null;
  port: number;
  defaultName: string;
  callbackScript?: string;
}

export function loadConfig(configPath: string): CodocConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new Error(
        `Config not found at ${configPath}. Create it with:\n${JSON.stringify(
          { tunnel: "cloudflare or null", port: 3000, defaultName: "browser_user" },
          null,
          2,
        )}\ntunnel must be "cloudflare" or null (required, no default)`,
      );
    }
    throw e;
  }

  const parsed = JSON.parse(raw);

  if (parsed.tunnel === undefined) {
    throw new Error(
      'Config validation: tunnel field is required (must be "cloudflare" or null)',
    );
  }
  if (parsed.tunnel !== null && parsed.tunnel !== "cloudflare") {
    throw new Error('Config validation: tunnel must be "cloudflare" or null');
  }

  if (parsed.port === undefined || typeof parsed.port !== "number") {
    throw new Error("Config validation: port field is required and must be a number");
  }

  if (parsed.defaultName === undefined || typeof parsed.defaultName !== "string") {
    throw new Error(
      "Config validation: defaultName field is required and must be a string",
    );
  }

  const config: CodocConfig = {
    tunnel: parsed.tunnel,
    port: parsed.port,
    defaultName: parsed.defaultName,
  };

  if (parsed.callbackScript !== undefined) {
    config.callbackScript = parsed.callbackScript;
  }

  return config;
}

export function parseTunnelUrl(output: string): string | null {
  const match = output.match(/https:\/\/(?!api\.)[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match) {
    return match[0];
  }
  return null;
}

export interface TunnelSpawnArgs {
  command: string;
  args: string[];
}

export function ensureCloudflared(): string | null {
  try {
    const found = execFileSync("which", ["cloudflared"], { encoding: "utf-8" }).trim();
    if (found) return found;
  } catch {}

  const tmpPath = path.join(os.tmpdir(), "cloudflared");
  if (fs.existsSync(tmpPath)) {
    try {
      fs.accessSync(tmpPath, fs.constants.X_OK);
      return tmpPath;
    } catch {}
  }

  console.error("Installing cloudflared...");
  const url =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
  try {
    execFileSync("curl", ["-fsSL", "-o", tmpPath, url], { timeout: 60000 });
    fs.chmodSync(tmpPath, 0o755);
    return tmpPath;
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`Failed to install cloudflared: ${e.message}`);
    return null;
  }
}

export function getTunnelSpawnArgs(
  port: number,
  cloudflaredPath: string,
): TunnelSpawnArgs {
  return {
    command: cloudflaredPath,
    args: ["tunnel", "--url", `http://localhost:${port}`],
  };
}
