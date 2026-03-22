import { writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CliError } from "../../errors.js";
import { loadFsm } from "../../fsm.js";
import { serializeMarkdown } from "../../markdown-serializer.js";
import { jsonSuccess, printJson } from "../../output.js";
import { serializeYaml } from "../../yaml-serializer.js";

export interface ConvertArgs {
  filePath: string;
  output?: string;
  json: boolean;
}

type Direction = "yaml-to-md" | "md-to-yaml";

function detectDirection(filePath: string): Direction {
  if (filePath.endsWith(".workflow.yaml") || filePath.endsWith(".workflow.yml")) {
    return "yaml-to-md";
  }
  if (filePath.endsWith(".workflow.md")) {
    return "md-to-yaml";
  }
  throw new CliError(
    "ARGS_INVALID",
    `unsupported file extension: expected .workflow.yaml or .workflow.md, got "${basename(filePath)}"`,
  );
}

function defaultOutputPath(filePath: string, direction: Direction): string {
  const dir = dirname(filePath);
  const base = basename(filePath);
  if (direction === "yaml-to-md") {
    const stem = base.replace(/\.workflow\.ya?ml$/, "");
    return join(dir, `${stem}.workflow.md`);
  }
  const stem = base.replace(/\.workflow\.md$/, "");
  return join(dir, `${stem}.workflow.yaml`);
}

export function convert(args: ConvertArgs): void {
  const absPath = args.filePath;
  const direction = detectDirection(absPath);
  const fsm = loadFsm(absPath);

  let serialized: string;
  if (direction === "yaml-to-md") {
    // Derive title from filename: "my-workflow.workflow.yaml" → "My Workflow"
    const stem = basename(absPath).replace(/\.workflow\.ya?ml$/, "");
    const title = stem
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    serialized = serializeMarkdown(fsm, { title: `${title} Workflow` });
  } else {
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
