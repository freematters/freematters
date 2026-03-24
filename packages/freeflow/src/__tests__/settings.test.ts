import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { isHookEnabled, loadSettings } from "../settings.js";
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
});

describe("isHookEnabled", () => {
  test("returns false when settings empty", () => {
    const root = join(tmp, "hook-empty");
    mkdirSync(root, { recursive: true });
    expect(isHookEnabled(root, "postToolUse")).toBe(false);
  });
});
