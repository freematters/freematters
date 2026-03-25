import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { render } from "../../commands/render.js";
import { CliError } from "../../errors.js";
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

/** YAML workflow with a guide. */
const YAML_WITH_GUIDE = `\
version: 1
guide: "Follow this guide carefully."
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

let tmp: string;

afterEach(() => {
  if (tmp) cleanupTempDir(tmp);
});

/** Capture stdout writes from a synchronous function. */
function captureStdout(fn: () => void): string {
  const writes: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((str: string) => {
    writes.push(str);
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = origWrite;
  }
  return writes.join("");
}

describe("fflow render command", () => {
  test("renders YAML workflow to stdout by default", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const output = captureStdout(() => {
      render({ fsmPath: yamlPath, json: false, root: tmp });
    });

    expect(output).toContain("## State: start");
    expect(output).toContain("## State: done");
    expect(output).toContain("```mermaid");
    expect(output).toMatch(/^---\n/);
  });

  test("renders YAML with guide to stdout", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, YAML_WITH_GUIDE);

    const output = captureStdout(() => {
      render({ fsmPath: yamlPath, json: false, root: tmp });
    });

    expect(output).toContain("## Guide");
    expect(output).toContain("Follow this guide carefully.");
  });

  test("--save writes .workflow.md alongside the YAML", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    render({ fsmPath: yamlPath, save: true, json: false, root: tmp });

    const mdPath = join(tmp, "workflow.workflow.md");
    expect(existsSync(mdPath)).toBe(true);

    const content = readFileSync(mdPath, "utf-8");
    expect(content).toContain("## State: start");
    expect(content).toContain("## State: done");

    // Original YAML must still exist
    expect(existsSync(yamlPath)).toBe(true);
  });

  test("--save with .yml extension writes .workflow.md", () => {
    tmp = createTempDir("render");
    const ymlPath = join(tmp, "workflow.yml");
    writeFileSync(ymlPath, MINIMAL_YAML);

    render({ fsmPath: ymlPath, save: true, json: false, root: tmp });

    const mdPath = join(tmp, "workflow.workflow.md");
    expect(existsSync(mdPath)).toBe(true);
  });

  test("--save derives basename correctly from nested path", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "my-flow.workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    render({ fsmPath: yamlPath, save: true, json: false, root: tmp });

    const mdPath = join(tmp, "my-flow.workflow.md");
    expect(existsSync(mdPath)).toBe(true);
  });

  test("-o writes to specified output path", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const outputPath = join(tmp, "custom-output.md");
    render({ fsmPath: yamlPath, output: outputPath, json: false, root: tmp });

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, "utf-8");
    expect(content).toContain("## State: start");
  });

  test("errors on .md input", () => {
    tmp = createTempDir("render");
    const mdPath = join(tmp, "workflow.md");
    writeFileSync(mdPath, "# Not a YAML workflow");

    expect(() => {
      render({ fsmPath: mdPath, json: false, root: tmp });
    }).toThrow(CliError);

    try {
      render({ fsmPath: mdPath, json: false, root: tmp });
    } catch (err) {
      expect((err as CliError).code).toBe("ARGS_INVALID");
      expect((err as CliError).message).toMatch(/YAML input/i);
    }
  });

  test("errors if both -o and --save specified", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    expect(() => {
      render({
        fsmPath: yamlPath,
        output: join(tmp, "out.md"),
        save: true,
        json: false,
        root: tmp,
      });
    }).toThrow(CliError);

    try {
      render({
        fsmPath: yamlPath,
        output: join(tmp, "out.md"),
        save: true,
        json: false,
        root: tmp,
      });
    } catch (err) {
      expect((err as CliError).code).toBe("ARGS_INVALID");
      expect((err as CliError).message).toMatch(/Cannot use both/);
    }
  });

  test("-j flag wraps output in JSON envelope", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const output = captureStdout(() => {
      render({ fsmPath: yamlPath, json: true, root: tmp });
    });

    const envelope = JSON.parse(output);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toHaveProperty("markdown");
    expect(envelope.data.markdown).toContain("## State: start");
  });

  test("-j flag with --save includes output_path in envelope", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const output = captureStdout(() => {
      render({ fsmPath: yamlPath, save: true, json: true, root: tmp });
    });

    const envelope = JSON.parse(output);
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toHaveProperty("output_path");
    expect(envelope.data.output_path).toMatch(/\.workflow\.md$/);
  });

  test("-j flag with -o includes output_path in envelope", () => {
    tmp = createTempDir("render");
    const yamlPath = join(tmp, "workflow.yaml");
    writeFileSync(yamlPath, MINIMAL_YAML);

    const outputPath = join(tmp, "custom.md");
    const output = captureStdout(() => {
      render({ fsmPath: yamlPath, output: outputPath, json: true, root: tmp });
    });

    const envelope = JSON.parse(output);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.output_path).toBe(outputPath);
  });
});
