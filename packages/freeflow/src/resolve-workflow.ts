import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Directories searched in order when resolving a workflow name. */
function searchDirs(): string[] {
  return [
    resolve(".freeflow/workflows"),
    join(homedir(), ".freeflow/workflows"),
    resolve(__dirname, "../workflows"), // bundled with freeflow package
  ];
}

function hasWorkflowExtension(name: string): boolean {
  return [".workflow.yaml", ".workflow.yml", ".fsm.yaml", ".fsm.yml"].some((ext) =>
    name.endsWith(ext),
  );
}

/**
 * Resolve a workflow name or path to an absolute workflow YAML file path.
 *
 * Resolution rules:
 * 1. If the input is an existing file (absolute or relative), return it.
 * 2. Search for `<name>/workflow.yaml` in directories:
 *    - .freeflow/workflows/  (project-local)
 *    - ~/.freeflow/workflows/ (user-global)
 *    - <freeflow-package>/workflows/ (bundled)
 * 3. If not found anywhere, throw with WORKFLOW_NOT_FOUND.
 */
export function resolveWorkflow(input: string): string {
  const isExplicitPath = input.includes("/") || input.startsWith(".");

  // If it already has a workflow extension, try as a direct path first
  if (hasWorkflowExtension(input)) {
    const abs = resolve(input);
    if (existsSync(abs)) return abs;
    if (isExplicitPath) {
      throw new CliError("WORKFLOW_NOT_FOUND", `File not found: ${abs}`, {
        context: { fsmPath: input },
      });
    }
    // Bare name with extension — not supported in directory format
    const bareName = input.replace(/\.(workflow|fsm)\.ya?ml$/, "");
    throw new CliError(
      "WORKFLOW_NOT_FOUND",
      `Flat filename format is no longer supported. Use the bare workflow name instead (e.g. "${bareName}").`,
      { context: { fsmPath: input } },
    );
  }

  // Try as a direct path (e.g. user passed a full path without extension)
  const abs = resolve(input);
  if (existsSync(abs)) return abs;

  // Search directories
  const dirs = searchDirs();
  for (const dir of dirs) {
    const found = probeDir(dir, input);
    if (found) return found;
  }

  const dirList = dirs.map((d) => `  - ${d}`).join("\n");
  throw new CliError(
    "WORKFLOW_NOT_FOUND",
    `Cannot find workflow "${input}"\nSearched:\n${dirList}`,
    { context: { fsmPath: input } },
  );
}

/**
 * Probe a directory for a workflow file at `<baseName>/workflow.yaml`.
 * Returns absolute path if found, undefined otherwise.
 */
function probeDir(dir: string, baseName: string): string | undefined {
  const candidate = join(dir, baseName, "workflow.yaml");
  return existsSync(candidate) ? candidate : undefined;
}
