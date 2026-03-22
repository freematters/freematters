import type { Root, RootContent } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parse as yamlParse } from "yaml";
import { FsmError } from "./fsm.js";

// --- Helpers ---

function fail(message: string): never {
  throw new FsmError("SCHEMA_INVALID", message);
}

/**
 * Stringify AST nodes back to markdown text (simple approach).
 * We walk through children and reconstruct text content.
 */
function nodesToMarkdown(nodes: RootContent[]): string {
  const lines: string[] = [];
  for (const node of nodes) {
    lines.push(nodeToText(node));
  }
  return lines.join("\n\n").trim();
}

function nodeToText(node: RootContent): string {
  switch (node.type) {
    case "paragraph":
      return inlineToText(node);
    case "list":
      return node.children
        .map((li) => {
          const text = li.children.map((c) => nodeToText(c as RootContent)).join("\n");
          return `- ${text}`;
        })
        .join("\n");
    case "code":
      return `\`\`\`${node.lang ?? ""}\n${node.value}\n\`\`\``;
    case "blockquote":
      return node.children.map((c) => `> ${nodeToText(c as RootContent)}`).join("\n");
    case "heading": {
      const prefix = "#".repeat(node.depth);
      return `${prefix} ${inlineToText(node)}`;
    }
    case "html":
      return node.value;
    case "thematicBreak":
      return "---";
    default:
      if ("value" in node) return (node as { value: string }).value;
      if ("children" in node) {
        return (node as { children: RootContent[] }).children
          .map((c) => nodeToText(c))
          .join("");
      }
      return "";
  }
}

// biome-ignore lint/suspicious/noExplicitAny: mdast node types are complex unions
function inlineToText(node: any): string {
  if (!node.children) return "";
  return node.children
    .map((child: RootContent) => {
      switch (child.type) {
        case "text":
          return child.value;
        case "strong":
          return `**${inlineToText(child)}**`;
        case "emphasis":
          return `*${inlineToText(child)}*`;
        case "inlineCode":
          return `\`${child.value}\``;
        case "link":
          return `[${inlineToText(child)}](${child.url})`;
        case "html":
          return child.value;
        default:
          if ("value" in child) return (child as unknown as { value: string }).value;
          if ("children" in child) return inlineToText(child);
          return "";
      }
    })
    .join("");
}

// --- Freeflow tag parsing ---

const FREEFLOW_SELF_CLOSING_RE = /^<freeflow\s+(from|workflow)="([^"]+)"\s*\/?>$/;

function isFreeflowOpenTag(text: string): { attr: string; value: string } | null {
  const m = text.trim().match(FREEFLOW_SELF_CLOSING_RE);
  if (m) return { attr: m[1], value: m[2] };
  // Check for append-todos open tag
  if (/^<freeflow\s+append-todos\s*>$/i.test(text.trim())) {
    return { attr: "append-todos", value: "" };
  }
  return null;
}

// --- Section splitting ---

interface Section {
  heading: string;
  depth: number;
  nodes: RootContent[];
}

function splitBySections(root: Root, targetDepth: number): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const node of root.children) {
    if (node.type === "yaml") continue; // frontmatter handled separately

    if (node.type === "heading" && node.depth === targetDepth) {
      const text = inlineToText(node);
      current = { heading: text, depth: node.depth, nodes: [] };
      sections.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
    // nodes before any heading at target depth are ignored (title heading)
  }

  return sections;
}

// --- Transition parsing ---

const TRANSITION_RE = /^(.+?)\s*(?:→|->)\s*(.+)$/;

function parseTransitions(
  stateName: string,
  nodes: RootContent[],
): Record<string, string> {
  const transitions: Record<string, string> = {};

  // Check for (none) marker
  const text = nodesToMarkdown(nodes).trim();
  if (text === "(none)" || text === "") {
    return {};
  }

  // Expect list items
  for (const node of nodes) {
    if (node.type === "list") {
      for (const li of node.children) {
        const itemText = li.children
          .map((c) => nodeToText(c as RootContent))
          .join("")
          .trim();

        if (itemText === "(none)") return {};

        const m = itemText.match(TRANSITION_RE);
        if (!m) {
          fail(`state "${stateName}": invalid transition format: "${itemText}"`);
        }
        transitions[m[1].trim()] = m[2].trim();
      }
    } else if (node.type === "paragraph") {
      const pText = inlineToText(node).trim();
      if (pText === "(none)") return {};
      // A paragraph that's not (none) in transitions section — could be malformed
      fail(`state "${stateName}": invalid transition format: "${pText}"`);
    }
  }

  return transitions;
}

// --- Append-todos extraction ---

const LIST_ITEM_RE = /^[-*]\s+(.+)$/;

function parseAppendTodosContent(raw: string): string[] {
  const items: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(LIST_ITEM_RE);
    if (m) {
      items.push(m[1].trim());
    }
  }
  return items;
}

// --- Main parser ---

/**
 * Parse a markdown workflow string into a raw document object.
 * The returned object has the same shape as yamlLoad() output,
 * ready for resolveWorkflowStates/resolveRefs/validation.
 */
export function parseMarkdownWorkflow(content: string): Record<string, unknown> {
  const tree = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .parse(content);

  // 1. Extract frontmatter
  const yamlNode = tree.children.find((n) => n.type === "yaml");
  if (!yamlNode || yamlNode.type !== "yaml") {
    fail("missing frontmatter (YAML front matter block is required)");
  }

  const frontmatter = yamlParse(yamlNode.value) as Record<string, unknown>;
  if (!frontmatter || typeof frontmatter !== "object") {
    fail("frontmatter must be a YAML mapping");
  }

  const doc: Record<string, unknown> = {};

  // Copy frontmatter fields
  if (frontmatter.version !== undefined) doc.version = frontmatter.version;
  if (frontmatter.initial !== undefined) doc.initial = frontmatter.initial;
  if (frontmatter.allowed_tools !== undefined)
    doc.allowed_tools = frontmatter.allowed_tools;
  if (frontmatter.extends_guide !== undefined)
    doc.extends_guide = frontmatter.extends_guide;

  // 2. Split top-level sections (depth 2)
  const sections = splitBySections(tree, 2);

  const states: Record<string, Record<string, unknown>> = {};

  for (const section of sections) {
    // Skip State Machine section
    if (section.heading === "State Machine") {
      continue;
    }

    // Guide section
    if (section.heading === "Guide" && section.depth === 2) {
      doc.guide = nodesToMarkdown(section.nodes);
      continue;
    }

    // State sections
    const stateMatch = section.heading.match(/^State:\s*(.+)$/);
    if (!stateMatch) continue;

    const stateName = stateMatch[1].trim();
    const state: Record<string, unknown> = {};

    // Look for freeflow tags and subsections within the state
    const stateNodes = section.nodes;

    // Extract freeflow tags first
    const filteredNodes: RootContent[] = [];

    for (const node of stateNodes) {
      if (node.type === "html") {
        const val = node.value.trim();

        // Check for self-closing freeflow tags (single-line)
        const tagInfo = isFreeflowOpenTag(val);
        if (tagInfo) {
          if (tagInfo.attr === "from") {
            state.from = tagInfo.value;
          } else if (tagInfo.attr === "workflow") {
            state.workflow = tagInfo.value;
          } else if (tagInfo.attr === "append-todos") {
            // Should not happen as block form is parsed as single HTML node
          }
          continue;
        }

        // Check for append-todos block (entire block as single HTML node)
        const appendMatch = val.match(
          /^<freeflow\s+append-todos\s*>([\s\S]*?)<\/freeflow>$/,
        );
        if (appendMatch) {
          state.append_todos = parseAppendTodosContent(appendMatch[1]);
          continue;
        }

        if (val === "</freeflow>") {
          continue;
        }
      }

      filteredNodes.push(node);
    }

    // If this is a workflow state, it should not have prompt
    if (state.workflow !== undefined) {
      // Parse sub-sections for transitions only
      const subSections = splitBySubSections(filteredNodes);
      for (const sub of subSections) {
        if (sub.heading === "Transitions") {
          state.transitions = parseTransitions(stateName, sub.nodes);
        }
      }
      states[stateName] = state;
      continue;
    }

    // Parse sub-sections (### level)
    const subSections = splitBySubSections(filteredNodes);

    let hasInstructions = false;
    for (const sub of subSections) {
      if (sub.heading === "Instructions") {
        hasInstructions = true;
        state.prompt = nodesToMarkdown(sub.nodes);
      } else if (sub.heading === "Todos") {
        state.todos = extractTodoItems(sub.nodes);
      } else if (sub.heading === "Transitions") {
        state.transitions = parseTransitions(stateName, sub.nodes);
      }
    }

    if (!hasInstructions && state.from === undefined) {
      fail(`state "${stateName}": missing Instructions section`);
    }

    states[stateName] = state;
  }

  doc.states = states;
  return doc;
}

// --- Sub-section splitting (### level within a ## State section) ---

interface SubSection {
  heading: string;
  nodes: RootContent[];
}

function splitBySubSections(nodes: RootContent[]): SubSection[] {
  const subs: SubSection[] = [];
  let current: SubSection | null = null;

  for (const node of nodes) {
    if (node.type === "heading" && node.depth === 3) {
      const text = inlineToText(node);
      current = { heading: text, nodes: [] };
      subs.push(current);
    } else if (current) {
      current.nodes.push(node);
    }
  }

  return subs;
}

// --- Todo extraction ---

function extractTodoItems(nodes: RootContent[]): string[] {
  const items: string[] = [];
  for (const node of nodes) {
    if (node.type === "list") {
      for (const li of node.children) {
        const text = li.children
          .map((c) => nodeToText(c as RootContent))
          .join("")
          .trim();
        if (text) items.push(text);
      }
    }
  }
  return items;
}
