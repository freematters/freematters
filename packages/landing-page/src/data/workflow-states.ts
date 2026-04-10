export interface WorkflowState {
  prompt: string | null;
  reasoning: string;
  transitions: Record<string, string>;
  interactive?: boolean;
  terminal?: boolean;
}

export interface YamlLine {
  text: string; // HTML string with syntax highlight spans
  state: string | null;
}

export const STATES: Record<string, WorkflowState> = {
  read: {
    prompt: "Read the PR diff carefully",
    reasoning:
      "Scanning PR #847... 342 lines across 7 files. New endpoint in api/reviews.ts, refactored test helpers, schema migration.",
    transitions: { analyzed: "analyze" },
  },
  analyze: {
    prompt: "Find real issues, skip nitpicks",
    reasoning:
      "3 issues: 1 critical (SQL injection in query builder, line 47), 2 minor (missing error boundary, unused import). Skipping 4 style nitpicks per prompt.",
    transitions: { "found issues": "feedback", "looks good": "done" },
    interactive: true,
  },
  feedback: {
    prompt: "Write constructive review comments",
    reasoning:
      "Drafting inline comment for line 47: SQL injection risk \u2192 parameterized query. Approve-with-comments for 2 minor items.",
    transitions: { "review posted": "done" },
  },
  done: {
    prompt: null,
    reasoning:
      "Review complete. 1 critical issue flagged, 2 suggestions posted. Total: 4.2s.",
    transitions: {},
    terminal: true,
  },
};

export const yamlLines: YamlLine[] = [
  { text: '<span class="sk">workflow</span><span class="sp">:</span>', state: null },
  {
    text: '  <span class="sk">name</span><span class="sp">:</span> <span class="sv">code-review</span>',
    state: null,
  },
  {
    text: '  <span class="sk">states</span><span class="sp">:</span>',
    state: null,
  },
  {
    text: '    <span class="ss">read</span><span class="sp">:</span>',
    state: "read",
  },
  {
    text: '      <span class="sk">prompt</span><span class="sp">:</span> <span class="sv">Read the PR diff carefully</span>',
    state: "read",
  },
  {
    text: '      <span class="sk">transitions</span><span class="sp">:</span>',
    state: "read",
  },
  {
    text: '        <span class="sp">-</span> <span class="sv">analyzed</span> <span class="sp">\u2192</span> <span class="ss">analyze</span>',
    state: "read",
  },
  {
    text: '    <span class="ss">analyze</span><span class="sp">:</span>',
    state: "analyze",
  },
  {
    text: '      <span class="sk">prompt</span><span class="sp">:</span> <span class="sv">Find real issues, skip nitpicks</span>',
    state: "analyze",
  },
  {
    text: '      <span class="sk">transitions</span><span class="sp">:</span>',
    state: "analyze",
  },
  {
    text: '        <span class="sp">-</span> <span class="sv">found issues</span> <span class="sp">\u2192</span> <span class="ss">feedback</span>',
    state: "analyze",
  },
  {
    text: '        <span class="sp">-</span> <span class="sv">looks good</span> <span class="sp">\u2192</span> <span class="ss">done</span>',
    state: "analyze",
  },
  {
    text: '    <span class="ss">feedback</span><span class="sp">:</span>',
    state: "feedback",
  },
  {
    text: '      <span class="sk">prompt</span><span class="sp">:</span> <span class="sv">Write constructive review comments</span>',
    state: "feedback",
  },
  {
    text: '      <span class="sk">transitions</span><span class="sp">:</span>',
    state: "feedback",
  },
  {
    text: '        <span class="sp">-</span> <span class="sv">review posted</span> <span class="sp">\u2192</span> <span class="ss">done</span>',
    state: "feedback",
  },
  {
    text: '    <span class="ss">done</span><span class="sp">:</span>',
    state: "done",
  },
  {
    text: '      <span class="sn">terminal</span><span class="sp">:</span> <span class="sn">true</span>',
    state: "done",
  },
];
