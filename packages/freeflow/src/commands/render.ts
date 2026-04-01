import { writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CliError } from "../errors.js";
import { type Fsm, loadFsm } from "../fsm.js";
import { serializeMarkdown } from "../markdown-serializer.js";
import { jsonSuccess, printJson } from "../output.js";

export interface RenderArgs {
  fsmPath: string;
  output?: string;
  save?: boolean;
  json: boolean;
}

/**
 * Derive the `.md` output path for `--save` mode.
 *
 * Rules:
 * - `workflow.yaml` → `workflow.md`
 * - `foo.workflow.yaml` → `foo.workflow.md`
 * - `bar.yml` → `bar.md`
 */
function deriveSavePath(fsmPath: string): string {
  const dir = dirname(fsmPath);
  const base = basename(fsmPath);

  // Replace .yaml/.yml extension with .md
  const mdName = base.replace(/\.(yaml|yml)$/, ".md");
  return join(dir, mdName);
}

export function render(args: RenderArgs): void {
  // Validate: cannot use both -o and --save
  if (args.output && args.save) {
    throw new CliError("ARGS_INVALID", "Cannot use both -o and --save", {
      context: { fsmPath: args.fsmPath },
    });
  }

  // Validate: must be YAML input (not .md)
  if (args.fsmPath.endsWith(".md")) {
    throw new CliError(
      "ARGS_INVALID",
      "fflow render only accepts YAML input. Pass a .yaml or .yml workflow file.",
      { context: { fsmPath: args.fsmPath } },
    );
  }

  // Load and resolve the FSM (handles from:, workflow:, extends_guide:)
  const fsm: Fsm = loadFsm(args.fsmPath);
  const workflowDir = dirname(resolve(args.fsmPath));

  // Serialize to markdown and inject workflow_dir metadata after frontmatter
  const rawMarkdown = serializeMarkdown(fsm);
  // Insert workflow_dir comment after the closing frontmatter delimiter
  const markdown = rawMarkdown.replace(
    /^(---\n[\s\S]*?\n---\n)/,
    (match) => `${match}\n<!-- workflow_dir: ${workflowDir} -->\n`,
  );

  // Output routing
  let outputPath: string | undefined;

  if (args.save) {
    outputPath = deriveSavePath(args.fsmPath);
  } else if (args.output) {
    outputPath = args.output;
  }

  if (outputPath) {
    writeFileSync(outputPath, markdown, "utf-8");
  }

  // JSON envelope
  if (args.json) {
    const data: Record<string, unknown> = { markdown };
    if (outputPath) {
      data.output_path = outputPath;
    }
    printJson(jsonSuccess("Workflow rendered", data));
  } else if (!outputPath) {
    // Default: write markdown to stdout
    process.stdout.write(markdown);
  }
}
