import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHookEnabled, loadSettings, saveSettings } from "../settings.js";
import { cleanupTempDir, createTempDir } from "./fixtures.js";

let tmp: string;

beforeAll(() => {
  tmp = createTempDir("settings");
});

afterAll(() => {
  cleanupTempDir(tmp);
});

describe("loadSettings", () => {
  test("returns {} for missing file", () => {
    const root = join(tmp, "missing");
    mkdirSync(root, { recursive: true });
    const result = loadSettings(root);
    expect(result).toEqual({});
  });

  test("returns {} for malformed JSON", () => {
    const root = join(tmp, "malformed");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "settings.json"), "not valid json{{{", "utf-8");
    const result = loadSettings(root);
    expect(result).toEqual({});
  });

  test("returns parsed settings for valid JSON", () => {
    const root = join(tmp, "valid");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: true } }),
      "utf-8",
    );
    const result = loadSettings(root);
    expect(result).toEqual({ hooks: { postToolUse: true } });
  });
});

describe("saveSettings", () => {
  test("creates file when missing", () => {
    const root = join(tmp, "save-new");
    // root dir does not exist yet
    saveSettings(root, { hooks: { postToolUse: true } });
    const raw = readFileSync(join(root, "settings.json"), "utf-8");
    expect(JSON.parse(raw)).toEqual({ hooks: { postToolUse: true } });
  });

  test("preserves existing keys", () => {
    const root = join(tmp, "save-preserve");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: false }, other: "value" }),
      "utf-8",
    );
    // Load, modify, save
    const settings = loadSettings(root);
    if (settings.hooks) {
      settings.hooks.postToolUse = true;
    }
    saveSettings(root, settings);
    const raw = readFileSync(join(root, "settings.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.hooks.postToolUse).toBe(true);
    expect(parsed.other).toBe("value");
  });
});

describe("isHookEnabled", () => {
  test("returns false when settings empty", () => {
    const root = join(tmp, "hook-empty");
    mkdirSync(root, { recursive: true });
    expect(isHookEnabled(root, "postToolUse")).toBe(false);
  });

  test("returns true when hooks.postToolUse is true", () => {
    const root = join(tmp, "hook-true");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: true } }),
      "utf-8",
    );
    expect(isHookEnabled(root, "postToolUse")).toBe(true);
  });

  test("returns false when hooks.postToolUse is false", () => {
    const root = join(tmp, "hook-false");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "settings.json"),
      JSON.stringify({ hooks: { postToolUse: false } }),
      "utf-8",
    );
    expect(isHookEnabled(root, "postToolUse")).toBe(false);
  });
});
