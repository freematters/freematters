import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { type WorkflowGraph, workflows } from "../../data/showcase";

const NODE_W = 80;
const NODE_H = 30;

const DESCRIPTIONS: Record<string, { desc: string; tags: string[] }> = {
  "code-review": {
    desc: "Deterministic PR review with human decision points. Agent reads the diff, reasons about real issues, and writes constructive feedback \u2014 guided by state-scoped prompts at each phase.",
    tags: ["interactive branch", "4 states", "deterministic path"],
  },
  "spec-gen": {
    desc: "From rough idea to complete spec through structured reasoning. Requirements, research, design, and planning \u2014 each phase with its own todos and deterministic transitions.",
    tags: ["bidirectional loops", "7 states", "todos", "reasoning"],
  },
  "pr-lifecycle": {
    desc: "Monitor a PR from creation to merge. Auto-fix CI, rebase conflicts, address review feedback \u2014 each event drives a deterministic state transition via hook-injected prompts.",
    tags: ["event-driven loop", "7 states", "deterministic path"],
  },
};

function arrowPath(
  nodes: WorkflowGraph["nodes"],
  fromId: string,
  toId: string,
): string {
  const from = nodes.find((n) => n.id === fromId);
  const to = nodes.find((n) => n.id === toId);
  if (!from || !to) return "";

  const fx = from.x + NODE_W / 2;
  const fy = from.y + NODE_H / 2;
  const tx = to.x + NODE_W / 2;
  const ty = to.y + NODE_H / 2;

  const mx = (fx + tx) / 2;
  const my = (fy + ty) / 2 - 8;

  return `M ${fx} ${fy} Q ${mx} ${my} ${tx} ${ty}`;
}

function WorkflowSvg({ graph }: { graph: WorkflowGraph }) {
  return (
    <svg
      viewBox={graph.viewBox}
      className="w-full"
      style={{ height: "auto" }}
      role="img"
      aria-label={graph.label}
    >
      <defs>
        <marker
          id={`arrow-${graph.id}`}
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L0,6 L6,3 z" fill="var(--dim)" opacity="0.5" />
        </marker>
      </defs>

      {graph.edges.map((edge, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: static edge data
          key={i}
          d={arrowPath(graph.nodes, edge.from, edge.to)}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="1.5"
          opacity="0.5"
          markerEnd={`url(#arrow-${graph.id})`}
        />
      ))}

      {graph.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <rect
            x={0}
            y={0}
            width={NODE_W}
            height={NODE_H}
            rx={8}
            fill="var(--bg2)"
            stroke={node.terminal ? "var(--ok)" : "var(--border)"}
            strokeWidth={node.terminal ? 1.5 : 1}
          />
          <text
            x={NODE_W / 2}
            y={NODE_H / 2 + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={node.terminal ? "var(--ok)" : "var(--dim)"}
            fontSize={12}
            fontFamily="var(--fm)"
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function WorkflowShowcase() {
  return (
    <section className="py-14 bg-[var(--bg)] md:py-24">
      <div className="mx-auto max-w-[1280px] px-5 md:px-10">
        <div className="mb-14 flex flex-col items-center gap-3">
          <span className="text-xs uppercase tracking-widest font-mono text-[var(--accent)]">
            Included
          </span>
          <h2 className="text-2xl text-center font-heading text-foreground md:text-4xl">
            Built-in Workflows
          </h2>
        </div>

        <Tabs defaultValue={workflows[0].id}>
          <TabsList
            variant="line"
            className={cn(
              "mb-8 flex w-full justify-start overflow-x-auto bg-transparent md:mb-12 md:justify-center",
              "h-auto gap-2",
            )}
          >
            {workflows.map((w) => (
              <TabsTrigger
                key={w.id}
                value={w.id}
                className={cn(
                  "rounded-lg border px-5 py-2 text-sm font-body cursor-pointer",
                  "transition-all h-auto",
                  "data-[state=active]:bg-[var(--bg2)] data-[state=active]:text-foreground data-[state=active]:border-[var(--border)] data-[state=active]:shadow-none",
                  "data-[state=inactive]:bg-transparent data-[state=inactive]:text-muted-foreground data-[state=inactive]:border-transparent",
                  "after:hidden",
                )}
              >
                {w.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {workflows.map((w) => {
            const info = DESCRIPTIONS[w.id];
            return (
              <TabsContent
                key={w.id}
                value={w.id}
                className={cn(
                  "rounded-xl border border-[var(--border)] bg-[var(--bg2)]",
                  "p-5 md:p-[32px_36px]",
                  "animate-[fadeIn_0.25s_ease]",
                )}
              >
                <div className="flex flex-col gap-6 md:flex-row md:gap-10 md:items-start">
                  {/* Left: SVG graph */}
                  <div className="min-w-0 flex-1">
                    <WorkflowSvg graph={w} />
                  </div>

                  {/* Right: info */}
                  <div className="flex w-full shrink-0 flex-col gap-4 md:w-[320px]">
                    <h3 className="text-xl font-semibold font-heading text-foreground">
                      {w.label}
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {info?.desc}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {info?.tags.map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className={cn(
                            "rounded-md font-mono",
                            "border-[var(--accent)] text-[var(--accent)] opacity-70",
                          )}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
      </div>
    </section>
  );
}
