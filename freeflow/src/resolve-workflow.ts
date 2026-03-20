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

const WORKFLOW_EXTENSIONS = [
  ".workflow.yaml",
  ".workflow.yml",
  ".fsm.yaml",
  ".fsm.yml",
] as const;

function hasWorkflowExtension(name: string): boolean {
  return WORKFLOW_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Resolve a workflow name or path to an absolute workflow YAML file path.
 *
 * Resolution rules:
 * 1. If the input is an existing file (absolute or relative), return it.
 * 2. Substitute `.workflow.yaml` / `.workflow.yml` / `.fsm.yaml` / `.fsm.yml`
 *    if no workflow extension is present.
 *    If multiple exist at the same location, throw an ambiguity error.
 * 3. Search directories in order:
 *    - .freeflow/workflows/  (project-local)
 *    - ~/.freeflow/workflows/ (user-global)
 *    - <freeflow-package>/workflows/ (bundled)
 * 4. If not found anywhere, throw with WORKFLOW_NOT_FOUND.
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
    // Bare name — fall through to search dirs
  } else {
    // Try as a direct path (e.g. user passed a full path without extension)
    const abs = resolve(input);
    if (existsSync(abs)) return abs;
  }

  // Strip extension if present for search
  const baseName = hasWorkflowExtension(input)
    ? input.replace(/\.(workflow|fsm)\.ya?ml$/, "")
    : input;

  // Search directories
  const dirs = searchDirs();
  for (const dir of dirs) {
    const found = probeDir(dir, baseName);
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
 * Probe a directory for a workflow file matching baseName.
 * Returns absolute path if exactly one extension matches, throws if multiple match.
 */
function probeDir(dir: string, baseName: string): string | undefined {
  const candidates = WORKFLOW_EXTENSIONS.map((ext) => ({
    path: join(dir, `${baseName}${ext}`),
    ext,
  }));
  const found = candidates.filter((c) => existsSync(c.path));

  if (found.length > 1) {
    const names = found.map((c) => `"${baseName}${c.ext}"`).join(" and ");
    throw new CliError(
      "WORKFLOW_AMBIGUOUS",
      `Both ${names} exist in ${dir}\nRemove one to resolve the ambiguity.`,
      { context: { fsmPath: baseName } },
    );
  }

  return found.length === 1 ? found[0].path : undefined;
}
