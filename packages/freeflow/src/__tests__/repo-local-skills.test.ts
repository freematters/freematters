import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
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

  test("repo instructions describe local skills instead of command aliases", () => {
    const agents = readFileSync(resolve(REPO_ROOT, "AGENTS.md"), "utf-8");

    expect(agents).toContain("## Local Skills");
    expect(agents).not.toContain("## Local Commands");
    expect(agents).toContain("| `pr-lifecycle` |");
    expect(agents).not.toContain("| `/pr` |");
  });

  test("spec-gen prompt requires numbered options and quick mode wording", () => {
    const workflow = readFileSync(
      resolve(REPO_ROOT, "packages/freeflow/workflows/spec-gen/workflow.yaml"),
      "utf-8",
    );

    expect(workflow).toContain("Every question MUST include numbered response options.");
    expect(workflow).toContain("**Quick mode**: If the user requested `--quick`");
    expect(workflow).not.toContain("**Lite mode**: If the user started with `--lite`");
  });

  test("workflow prompts reference pr-lifecycle instead of /pr", () => {
    const specToCode = readFileSync(
      resolve(REPO_ROOT, "packages/freeflow/workflows/spec-to-code/workflow.yaml"),
      "utf-8",
    );
    const specDriven = readFileSync(
      resolve(REPO_ROOT, "packages/freeflow/workflows/spec-driven/workflow.yaml"),
      "utf-8",
    );

    expect(specToCode).toContain("run `/pr-lifecycle`");
    expect(specToCode).not.toContain("run `/pr`");
    expect(specDriven).toContain("run /pr-lifecycle to create a pull request");
    expect(specDriven).not.toContain("run /pr to create a pull request");
  });
});
