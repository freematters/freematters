import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./errors.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Directories searched in order when resolving a workflow name. */
function searchDirs(): string[] {
  return [
    resolve(".freefsm/workflows"),
    join(homedir(), ".freefsm/workflows"),
    resolve(__dirname, "../workflows"), // bundled with freefsm package
  ];
}

const FSM_EXTENSIONS = [".fsm.yaml", ".fsm.yml"] as const;

function hasFsmExtension(name: string): boolean {
  return FSM_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Resolve a workflow name or path to an absolute FSM YAML file path.
 *
 * Resolution rules:
 * 1. If the input is an existing file (absolute or relative), return it.
 * 2. Substitute `.fsm.yaml` / `.fsm.yml` if no FSM extension is present.
 *    If both exist at the same location, throw an ambiguity error.
 * 3. Search directories in order:
 *    - .freefsm/workflows/  (project-local)
 *    - ~/.freefsm/workflows/ (user-global)
 *    - <freefsm-package>/workflows/ (bundled)
 * 4. If not found anywhere, throw with WORKFLOW_NOT_FOUND.
 */
export function resolveWorkflow(input: string): string {
  // If it already has an FSM extension, try as a direct path first
  if (hasFsmExtension(input)) {
    const abs = resolve(input);
    if (existsSync(abs)) return abs;
    // Fall through to search dirs with the basename
  } else {
    // Try as a direct path (e.g. user passed a full path without extension)
    const abs = resolve(input);
    if (existsSync(abs)) return abs;
  }

  // Strip extension if present for search
  const baseName = hasFsmExtension(input) ? input.replace(/\.fsm\.ya?ml$/, "") : input;

  // Search directories
  for (const dir of searchDirs()) {
    const found = probeDir(dir, baseName);
    if (found) return found;
  }

  const dirs = searchDirs()
    .map((d) => `  - ${d}`)
    .join("\n");
  throw new CliError(
    "WORKFLOW_NOT_FOUND",
    `Cannot find workflow "${input}"\nSearched:\n${dirs}`,
    { context: { fsmPath: input } },
  );
}

/**
 * Probe a directory for a workflow file matching baseName.
 * Returns absolute path if exactly one extension matches, throws if both match.
 */
function probeDir(dir: string, baseName: string): string | undefined {
  const yamlPath = join(dir, `${baseName}.fsm.yaml`);
  const ymlPath = join(dir, `${baseName}.fsm.yml`);
  const yamlExists = existsSync(yamlPath);
  const ymlExists = existsSync(ymlPath);

  if (yamlExists && ymlExists) {
    throw new CliError(
      "WORKFLOW_AMBIGUOUS",
      `Both "${baseName}.fsm.yaml" and "${baseName}.fsm.yml" exist in ${dir}\nRemove one to resolve the ambiguity.`,
      { context: { fsmPath: baseName } },
    );
  }

  if (yamlExists) return yamlPath;
  if (ymlExists) return ymlPath;
  return undefined;
}
