import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../../..");

describe("repo local workflow skills", () => {
  test("checked-in .agents skills are symlinks to workflow directories", () => {
    const expectedLinks = {
      "spec-gen": "../../packages/freeflow/workflows/spec-gen",
      "spec-to-code": "../../packages/freeflow/workflows/spec-to-code",
      "pr-lifecycle": "../../packages/freeflow/workflows/pr-lifecycle",
      release: "../../packages/freeflow/workflows/release",
      "spec-driven": "../../packages/freeflow/workflows/spec-driven",
    };

    for (const [name, target] of Object.entries(expectedLinks)) {
      const linkPath = resolve(REPO_ROOT, ".agents/skills", name);
      expect(existsSync(linkPath)).toBe(true);
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(linkPath)).toBe(target);
    }
  });
});
