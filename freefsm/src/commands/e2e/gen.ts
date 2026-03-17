import { existsSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { parseTestPlan } from "../../e2e/parser.js";
import { enumeratePaths } from "../../e2e/path-enumerator.js";
import { CliError } from "../../errors.js";
import { loadFsm } from "../../fsm.js";
import { handleError, jsonSuccess, printJson } from "../../output.js";

export interface GenArgs {
  source: string;
  output?: string;
  json: boolean;
}

export interface GenFromYamlResult {
  markdown: string;
  pathCount: number;
}

/**
 * Generate a test plan from a YAML file path (deterministic, no LLM needed).
 * Exported for unit testing.
 */
export function generateFromYaml(fsmPath: string): GenFromYamlResult {
  const fsm = loadFsm(fsmPath);
  const paths = enumeratePaths(fsm);
  const fsmName = basename(fsmPath, ".fsm.yaml");

  const lines: string[] = [];
  lines.push(`# Test: ${fsmName} workflow`);
  lines.push("");

  // Setup section
  lines.push("## Setup");
  lines.push("- Ensure freefsm CLI is available on PATH");
  lines.push(`- Prepare the workflow file: ${basename(fsmPath)}`);
  lines.push("");

  // Steps section — generate steps for each path
  lines.push("## Steps");
  let stepNum = 1;

  for (let pathIdx = 0; pathIdx < paths.length; pathIdx++) {
    const path = paths[pathIdx];
    const pathLabel = paths.length > 1 ? ` (path ${pathIdx + 1}: ${path.name})` : "";

    // Start the workflow
    lines.push(
      `${stepNum}. **Start workflow${pathLabel}**: Run \`freefsm start ${basename(fsmPath)}\` to initialize a new run`,
    );
    lines.push(`   - Expected: Run initializes in "${path.states[0]}" state`);
    stepNum++;

    // Transition through each state
    for (let i = 0; i < path.transitions.length; i++) {
      const fromState = path.states[i];
      const toState = path.states[i + 1];
      const label = path.transitions[i];

      lines.push(
        `${stepNum}. **Transition ${fromState} to ${toState}${pathLabel}**: Run \`freefsm goto ${toState} --on "${label}"\` to transition`,
      );
      lines.push(`   - Expected: State transitions to "${toState}"`);
      stepNum++;
    }
  }
  lines.push("");

  // Expected Outcomes section
  lines.push("## Expected Outcomes");
  if (paths.length === 1) {
    lines.push(`- Workflow traverses the path: ${paths[0].states.join(" -> ")}`);
    lines.push("- All transitions complete without error");
  } else {
    for (const path of paths) {
      lines.push(`- Path "${path.name}" can be traversed: ${path.states.join(" -> ")}`);
    }
    lines.push("- All transitions complete without error");
  }
  lines.push("");

  // Cleanup section
  lines.push("## Cleanup");
  lines.push("- Remove any created run data");
  lines.push("");

  return { markdown: lines.join("\n"), pathCount: paths.length };
}

/**
 * Determine if source is a YAML file path or free-text prompt.
 */
function isYamlPath(source: string): boolean {
  return (source.endsWith(".yaml") || source.endsWith(".yml")) && existsSync(source);
}

/**
 * Main gen command handler.
 */
export async function gen(args: GenArgs): Promise<void> {
  try {
    let markdown: string;
    let pathCount = 1;

    if (isYamlPath(args.source)) {
      // YAML mode: deterministic path enumeration
      const result = generateFromYaml(args.source);
      markdown = result.markdown;
      pathCount = result.pathCount;
    } else {
      // Prompt mode: requires Claude agent (not implemented in YAML-only scope)
      throw new CliError(
        "ARGS_INVALID",
        "Prompt mode for test plan generation is not yet implemented. Provide a .yaml file path.",
      );
    }

    // Validate the generated plan passes the parser
    const parseResult = parseTestPlan(markdown);
    if (!parseResult.ok) {
      throw new CliError(
        "ARGS_INVALID",
        `Generated test plan failed validation: ${parseResult.error}`,
      );
    }

    // Output
    if (args.output) {
      writeFileSync(args.output, markdown, "utf-8");
      if (args.json) {
        printJson(
          jsonSuccess("Test plan generated", {
            path: args.output,
            steps: parseResult.plan.steps.length,
            paths: pathCount,
          }),
        );
      } else {
        process.stdout.write(`Test plan written to ${args.output}\n`);
        process.stdout.write(`  Steps: ${parseResult.plan.steps.length}\n`);
      }
    } else {
      if (args.json) {
        printJson(
          jsonSuccess("Test plan generated", {
            markdown,
            steps: parseResult.plan.steps.length,
          }),
        );
      } else {
        process.stdout.write(markdown);
      }
    }
  } catch (err: unknown) {
    handleError(err, args.json);
  }
}
