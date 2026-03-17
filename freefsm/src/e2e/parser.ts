export interface TestStep {
  name: string;
  action: string;
  expected: string;
}

export interface TestPlan {
  name: string;
  setup: string[];
  steps: TestStep[];
  expectedOutcomes: string[];
  cleanup: string[];
}

export type ParseResult = { ok: true; plan: TestPlan } | { ok: false; error: string };

/**
 * Parse a structured markdown test plan into a typed data structure.
 *
 * Expected format:
 *   # Test: <name>
 *   ## Setup
 *   ## Steps
 *   ## Expected Outcomes
 *   ## Cleanup (optional)
 */
export function parseTestPlan(markdown: string): ParseResult {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return { ok: false, error: "Empty test plan" };
  }

  // Extract test name from "# Test: <name>"
  const nameMatch = trimmed.match(/^#\s+Test:\s*(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : "Untitled";

  // Split into sections by ## headings
  const sections = splitSections(trimmed);

  // Validate required sections
  if (!sections.has("Steps")) {
    return { ok: false, error: "Missing required section: ## Steps" };
  }
  if (!sections.has("Expected Outcomes")) {
    return { ok: false, error: "Missing required section: ## Expected Outcomes" };
  }

  const setup = parseListItems(sections.get("Setup") ?? "");
  const steps = parseSteps(sections.get("Steps") ?? "");
  const expectedOutcomes = parseListItems(sections.get("Expected Outcomes") ?? "");
  const cleanup = parseListItems(sections.get("Cleanup") ?? "");

  return {
    ok: true,
    plan: { name, setup, steps, expectedOutcomes, cleanup },
  };
}

/**
 * Split markdown by ## headings into a Map<sectionName, content>.
 */
function splitSections(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split("\n");
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentSection !== null) {
        sections.set(currentSection, currentContent.join("\n"));
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection !== null) {
      currentContent.push(line);
    }
  }

  if (currentSection !== null) {
    sections.set(currentSection, currentContent.join("\n"));
  }

  return sections;
}

/**
 * Parse markdown list items (- item) into an array of strings.
 */
function parseListItems(content: string): string[] {
  const items: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }
  return items;
}

/**
 * Parse numbered steps with **name**: action and - Expected: expected.
 *
 * Format:
 *   1. **Step name**: Action description
 *      - Expected: What should happen
 */
function parseSteps(content: string): TestStep[] {
  const steps: TestStep[] = [];
  const lines = content.split("\n");

  let i = 0;
  while (i < lines.length) {
    const stepMatch = lines[i].match(/^\s*\d+\.\s+\*\*([^*]+)\*\*:\s*(.+)$/);
    if (stepMatch) {
      const name = stepMatch[1].trim();
      const action = stepMatch[2].trim();
      let expected = "";

      // Look for - Expected: on the next line(s)
      if (i + 1 < lines.length) {
        const expectedMatch = lines[i + 1].match(/^\s*-\s+Expected:\s*(.+)$/);
        if (expectedMatch) {
          expected = expectedMatch[1].trim();
          i++; // skip the expected line
        }
      }

      steps.push({ name, action, expected });
    }
    i++;
  }

  return steps;
}
