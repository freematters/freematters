import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { convert } from "../../commands/markdown/convert.js";
import { cleanupTempDir, createTempDir } from "../fixtures.js";

/** Minimal valid YAML workflow. */
const MINIMAL_YAML = `\
version: 1
initial: start
states:
  start:
    prompt: Begin here.
    transitions:
      next: done
  done:
    prompt: Finished.
    transitions: {}
`;

/** Minimal valid markdown workflow. */
const MINIMAL_MD = `\
---
version: 1
initial: start
---

## State Machine

\`\`\`mermaid
stateDiagram-v2
  [*] --> start
  start --> done: next
  done --> [*]
\`\`\`

## State: start

### Instructions

Begin here.

### Transitions

- next \u2192 done

## State: done

### Instructions

Finished.

### Transitions

(none)
`;

let tmp: string;

afterEach(() => {
  if (tmp) cleanupTempDir(tmp);
});

describe("markdown convert command", () => {
  test("YAML input outputs valid .workflow.md", () => {
    tmp = createTempDir("md-convert");
    const yamlPath = join(tmp, "test.workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    convert({ filePath: yamlPath, json: false });

    const outPath = join(tmp, "test.workflow.md");
    expect(existsSync(outPath)).toBe(true);

    const content = readFileSync(outPath, "utf-8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("## State: start");
    expect(content).toContain("## State: done");
    expect(content).toContain("```mermaid");
  });

  test("Markdown input outputs valid .workflow.yaml", () => {
    tmp = createTempDir("md-convert");
    const mdPath = join(tmp, "test.workflow.md");
    writeFileSync(mdPath, MINIMAL_MD);

    convert({ filePath: mdPath, json: false });

    const outPath = join(tmp, "test.workflow.yaml");
    expect(existsSync(outPath)).toBe(true);

    const content = readFileSync(outPath, "utf-8");
    expect(content).toContain("version: 1");
    expect(content).toContain("initial: start");
    expect(content).toContain("states:");
  });

  test("unsupported extension throws ARGS_INVALID error", () => {
    tmp = createTempDir("md-convert");
    const txtPath = join(tmp, "test.txt");
    writeFileSync(txtPath, "not a workflow");

    let caught: unknown;
    try {
      convert({ filePath: txtPath, json: false });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect((caught as { code: string }).code).toBe("ARGS_INVALID");
    expect((caught as Error).message).toMatch(/unsupported file extension/);
  });

  test("-o flag writes to specified path", () => {
    tmp = createTempDir("md-convert");
    const yamlPath = join(tmp, "input.workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const customOut = join(tmp, "custom-output.workflow.md");
    convert({ filePath: yamlPath, output: customOut, json: false });

    expect(existsSync(customOut)).toBe(true);
    expect(existsSync(join(tmp, "input.workflow.md"))).toBe(false);
  });

  test("json flag wraps output in JSON envelope", () => {
    tmp = createTempDir("md-convert");
    const yamlPath = join(tmp, "test.workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const writes: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((str: string) => {
      writes.push(str);
      return true;
    }) as typeof process.stdout.write;

    try {
      convert({ filePath: yamlPath, json: true });
    } finally {
      process.stdout.write = origWrite;
    }

    const output = writes.join("");
    const envelope = JSON.parse(output);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toHaveProperty("output_path");
  });

  test("workflow.yaml outputs workflow.md (not workflow.workflow.md)", () => {
    tmp = createTempDir("md-convert");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    convert({ filePath: yamlPath, json: false });

    expect(existsSync(join(tmp, "workflow.md"))).toBe(true);
    expect(existsSync(join(tmp, "workflow.workflow.md"))).toBe(false);
  });

  test("foo.workflow.yaml outputs foo.workflow.md", () => {
    tmp = createTempDir("md-convert");
    const yamlPath = join(tmp, "foo.workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    convert({ filePath: yamlPath, json: false });

    expect(existsSync(join(tmp, "foo.workflow.md"))).toBe(true);
  });

  test("workflow.md outputs workflow.yaml", () => {
    tmp = createTempDir("md-convert");
    const mdPath = join(tmp, "workflow.md");
    writeFileSync(mdPath, MINIMAL_MD);

    convert({ filePath: mdPath, json: false });

    expect(existsSync(join(tmp, "workflow.yaml"))).toBe(true);
  });

  test("bar.workflow.md outputs bar.workflow.yaml", () => {
    tmp = createTempDir("md-convert");
    const mdPath = join(tmp, "bar.workflow.md");
    writeFileSync(mdPath, MINIMAL_MD);

    convert({ filePath: mdPath, json: false });

    expect(existsSync(join(tmp, "bar.workflow.yaml"))).toBe(true);
  });

  test(".md file is accepted as MD-to-YAML input", () => {
    tmp = createTempDir("md-convert");
    const mdPath = join(tmp, "myflow.md");
    writeFileSync(mdPath, MINIMAL_MD);

    convert({ filePath: mdPath, json: false });

    expect(existsSync(join(tmp, "myflow.yaml"))).toBe(true);

    const content = readFileSync(join(tmp, "myflow.yaml"), "utf-8");
    expect(content).toContain("version: 1");
    expect(content).toContain("initial: start");
  });
});
