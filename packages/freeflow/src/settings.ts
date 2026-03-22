import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- Types ---

export interface FreeflowSettings {
  hooks?: {
    postToolUse?: boolean;
  };
  [key: string]: unknown;
}

// --- Public API ---

/**
 * Read and parse `settings.json` from the given root directory.
 * Returns `{}` if the file is missing or contains malformed JSON.
 */
export function loadSettings(root: string): FreeflowSettings {
  const p = join(root, "settings.json");
  if (!existsSync(p)) {
    return {};
  }
  try {
    const raw = readFileSync(p, "utf-8");
    return JSON.parse(raw) as FreeflowSettings;
  } catch {
    return {};
  }
}

/**
 * Write settings to `settings.json` in the given root directory.
 * Creates the directory and file if they do not exist.
 */
export function saveSettings(root: string, settings: FreeflowSettings): void {
  mkdirSync(root, { recursive: true });
  const p = join(root, "settings.json");
  writeFileSync(p, JSON.stringify(settings, null, 2), "utf-8");
}

/**
 * Convenience check: returns `true` only when the named hook is explicitly
 * enabled in settings. Returns `false` for missing file, missing key, or
 * any falsy value.
 */
export function isHookEnabled(root: string, hookName: "postToolUse"): boolean {
  const settings = loadSettings(root);
  return settings.hooks?.[hookName] === true;
}
