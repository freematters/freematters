import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CliError } from "../../errors.js";
import { loadFsm } from "../../fsm.js";
import { serializeRawYamlToMarkdown } from "../../markdown-serializer.js";
import { jsonSuccess, printJson } from "../../output.js";
import { serializeYaml } from "../../yaml-serializer.js";

export interface ConvertArgs {
  filePath: string;
  output?: string;
  json: boolean;
}

type Direction = "yaml-to-md" | "md-to-yaml";

function detectDirection(filePath: string): Direction {
  if (
    filePath.endsWith(".workflow.yaml") ||
    filePath.endsWith(".workflow.yml") ||
    filePath.endsWith(".yaml") ||
    filePath.endsWith(".yml")
  ) {
    return "yaml-to-md";
  }
  if (filePath.endsWith(".workflow.md")) {
    return "md-to-yaml";
  }
  throw new CliError(
    "ARGS_INVALID",
    `unsupported file extension: expected .yaml, .yml, or .workflow.md, got "${basename(filePath)}"`,
  );
}

function defaultOutputPath(filePath: string, direction: Direction): string {
  const dir = dirname(filePath);
  const base = basename(filePath);
  if (direction === "yaml-to-md") {
    const stem = base.replace(/\.(workflow\.)?ya?ml$/, "");
    return join(dir, `${stem}.workflow.md`);
  }
  const stem = base.replace(/\.workflow\.md$/, "");
  return join(dir, `${stem}.workflow.yaml`);
}

function deriveTitle(absPath: string): string {
  let stem = basename(absPath).replace(/\.(workflow\.)?ya?ml$/, "");
  if (stem === "workflow") {
    stem = basename(dirname(absPath));
  }
  return `${stem
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")} Workflow`;
}

export function convert(args: ConvertArgs): void {
  const absPath = args.filePath;
  const direction = detectDirection(absPath);

  let serialized: string;
  if (direction === "yaml-to-md") {
    // Read raw YAML and convert directly — preserves from:, workflow:, extends_guide
    const yamlContent = readFileSync(absPath, "utf-8");
    serialized = serializeRawYamlToMarkdown(yamlContent, {
      title: deriveTitle(absPath),
    });
  } else {
    // MD→YAML: load resolved Fsm and serialize
    const fsm = loadFsm(absPath);
    serialized = serializeYaml(fsm);
  }

  const outPath = args.output
    ? resolve(args.output)
    : defaultOutputPath(absPath, direction);
  writeFileSync(outPath, serialized, "utf-8");

  if (args.json) {
    printJson(
      jsonSuccess("Converted successfully", {
        input_path: absPath,
        output_path: outPath,
        direction,
      }),
    );
  } else {
    process.stdout.write(`Converted: ${absPath} → ${outPath}\n`);
  }
}
