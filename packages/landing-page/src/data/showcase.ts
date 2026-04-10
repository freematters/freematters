export interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  terminal?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  id: string;
  label: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewBox: string;
}

export const workflows: WorkflowGraph[] = [
  {
    id: "code-review",
    label: "Code Review",
    viewBox: "0 0 500 140",
    nodes: [
      { id: "read", label: "read", x: 30, y: 55 },
      { id: "analyze", label: "analyze", x: 150, y: 55 },
      { id: "feedback", label: "feedback", x: 280, y: 55 },
      { id: "done", label: "done", x: 400, y: 55, terminal: true },
    ],
    edges: [
      { from: "read", to: "analyze" },
      { from: "analyze", to: "feedback" },
      { from: "feedback", to: "done" },
      { from: "analyze", to: "done" },
    ],
  },
  {
    id: "spec-gen",
    label: "Spec Gen",
    viewBox: "0 0 500 240",
    nodes: [
      { id: "create", label: "create", x: 20, y: 40 },
      { id: "requirements", label: "requirements", x: 130, y: 40 },
      { id: "research", label: "research", x: 270, y: 40 },
      { id: "design", label: "design", x: 130, y: 120 },
      { id: "plan", label: "plan", x: 270, y: 120 },
      { id: "e2e-gen", label: "e2e-gen", x: 270, y: 195 },
      { id: "done", label: "done", x: 400, y: 120, terminal: true },
    ],
    edges: [
      { from: "create", to: "requirements" },
      { from: "requirements", to: "research" },
      { from: "research", to: "requirements" },
      { from: "requirements", to: "design" },
      { from: "design", to: "plan" },
      { from: "plan", to: "e2e-gen" },
      { from: "plan", to: "done" },
      { from: "e2e-gen", to: "done" },
    ],
  },
  {
    id: "pr-lifecycle",
    label: "PR Lifecycle",
    viewBox: "0 0 500 240",
    nodes: [
      { id: "create-pr", label: "create-pr", x: 20, y: 40 },
      { id: "poll", label: "poll", x: 150, y: 40 },
      { id: "fix", label: "fix", x: 290, y: 40 },
      { id: "rebase", label: "rebase", x: 290, y: 120 },
      { id: "address", label: "address", x: 290, y: 195 },
      { id: "push", label: "push", x: 150, y: 130 },
      { id: "done", label: "done", x: 410, y: 40, terminal: true },
    ],
    edges: [
      { from: "create-pr", to: "poll" },
      { from: "poll", to: "fix" },
      { from: "poll", to: "rebase" },
      { from: "poll", to: "address" },
      { from: "poll", to: "done" },
      { from: "fix", to: "push" },
      { from: "rebase", to: "push" },
      { from: "address", to: "push" },
      { from: "push", to: "poll" },
    ],
  },
];
