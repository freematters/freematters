import type { GraphEdge, GraphNode, WorkflowGraph } from "./showcase";
import { workflows as showcaseWorkflows } from "./showcase";

/* ── Extended node type with composition marker ── */

export interface ComposableNode extends GraphNode {
  /** If set, this state embeds the named child workflow */
  composite?: string;
}

export interface ComposableGraph {
  id: string;
  label: string;
  nodes: ComposableNode[];
  edges: GraphEdge[];
  viewBox: string;
}

/* ── Parent graph: idea-to-pr ── */

export const parentGraph: ComposableGraph = {
  id: "idea-to-pr",
  label: "idea-to-pr",
  viewBox: "0 0 640 200",
  nodes: [
    { id: "spec", label: "spec", x: 10, y: 30, composite: "spec-gen" },
    { id: "decide", label: "decide", x: 130, y: 30 },
    { id: "implement", label: "implement", x: 250, y: 30, composite: "spec-to-code" },
    { id: "confirm-pr", label: "confirm-pr", x: 370, y: 30 },
    { id: "submit-pr", label: "submit-pr", x: 490, y: 30, composite: "pr-lifecycle" },
    { id: "done", label: "done", x: 370, y: 140, terminal: true },
  ],
  edges: [
    { from: "spec", to: "decide" },
    { from: "decide", to: "implement" },
    { from: "decide", to: "done" },
    { from: "implement", to: "confirm-pr" },
    { from: "confirm-pr", to: "submit-pr" },
    { from: "confirm-pr", to: "done" },
    { from: "submit-pr", to: "done" },
  ],
};

/* ── Child workflow definitions ── */

export interface ChildWorkflow {
  id: string;
  label: string;
  yamlRef: string;
  graph: WorkflowGraph;
}

// Reuse spec-gen and pr-lifecycle from showcase data
const specGenGraph = showcaseWorkflows.find((w) => w.id === "spec-gen")!;
const prLifecycleGraph = showcaseWorkflows.find((w) => w.id === "pr-lifecycle")!;

const specToCodeGraph: WorkflowGraph = {
  id: "spec-to-code",
  label: "Spec to Code",
  viewBox: "0 0 620 140",
  nodes: [
    { id: "setup", label: "setup", x: 10, y: 55 },
    { id: "implement", label: "implement", x: 110, y: 55 },
    { id: "e2e-test", label: "e2e-test", x: 220, y: 55 },
    { id: "review", label: "review", x: 330, y: 55 },
    { id: "simplify", label: "simplify", x: 430, y: 55 },
    { id: "done", label: "done", x: 530, y: 55, terminal: true },
  ],
  edges: [
    { from: "setup", to: "implement" },
    { from: "implement", to: "e2e-test" },
    { from: "e2e-test", to: "review" },
    { from: "review", to: "simplify" },
    { from: "simplify", to: "done" },
  ],
};

export const childWorkflows: Record<string, ChildWorkflow> = {
  "spec-gen": {
    id: "spec-gen",
    label: "Spec Gen",
    yamlRef: "../spec-gen/workflow.yaml",
    graph: specGenGraph,
  },
  "spec-to-code": {
    id: "spec-to-code",
    label: "Spec to Code",
    yamlRef: "../spec-to-code/workflow.yaml",
    graph: specToCodeGraph,
  },
  "pr-lifecycle": {
    id: "pr-lifecycle",
    label: "PR Lifecycle",
    yamlRef: "../pr-lifecycle/workflow.yaml",
    graph: prLifecycleGraph,
  },
};
