import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const E2E_DIR = resolve(__dirname, "../../../e2e");

describe("e2e test plan files — run-stops-for-user-input.md", () => {
  test("file exists in e2e/ directory", () => {
    expect(existsSync(join(E2E_DIR, "run-stops-for-user-input.md"))).toBe(true);
  });
});
