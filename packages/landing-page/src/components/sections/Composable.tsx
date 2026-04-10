import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  type ComposableGraph,
  childWorkflows,
  parentGraph,
} from "../../data/composable";
import type { WorkflowGraph } from "../../data/showcase";

const NODE_W = 88;
const NODE_H = 30;
const CHILD_NODE_W = 80;
const CHILD_NODE_H = 30;

/* ── Shared SVG helpers ── */

function arrowPath(
  nodes: { id: string; x: number; y: number }[],
  fromId: string,
  toId: string,
  nodeW: number,
  nodeH: number,
): string {
  const from = nodes.find((n) => n.id === fromId);
  const to = nodes.find((n) => n.id === toId);
  if (!from || !to) return "";

  const fx = from.x + nodeW / 2;
  const fy = from.y + nodeH / 2;
  const tx = to.x + nodeW / 2;
  const ty = to.y + nodeH / 2;

  const mx = (fx + tx) / 2;
  const my = (fy + ty) / 2 - 8;

  return `M ${fx} ${fy} Q ${mx} ${my} ${tx} ${ty}`;
}

/* ── Parent graph rendering ── */

function ParentGraph({
  graph,
  selected,
  onSelect,
}: {
  graph: ComposableGraph;
  selected: string;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <svg
      viewBox={graph.viewBox}
      className="w-full"
      style={{ height: "auto" }}
      role="img"
      aria-label="idea-to-pr parent workflow"
    >
      <defs>
        <marker
          id="arr-parent"
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
          // biome-ignore lint/suspicious/noArrayIndexKey: static data
          key={i}
          d={arrowPath(graph.nodes, edge.from, edge.to, NODE_W, NODE_H)}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="1.5"
          opacity="0.5"
          markerEnd="url(#arr-parent)"
        />
      ))}

      {graph.nodes.map((node) => {
        const isComposite = !!node.composite;
        const isSelected = node.composite === selected;
        const isTerminal = !!node.terminal;

        const fillColor = isSelected
          ? "color-mix(in srgb, var(--accent) 12%, var(--bg2))"
          : "var(--bg2)";

        const strokeColor = isSelected
          ? "var(--accent)"
          : isTerminal
            ? "var(--ok)"
            : isComposite
              ? "var(--accent)"
              : "var(--border)";

        const textColor = isSelected
          ? "var(--accent)"
          : isTerminal
            ? "var(--ok)"
            : isComposite
              ? "var(--text)"
              : "var(--dim)";

        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            style={{ cursor: isComposite ? "pointer" : "default", outline: "none" }}
            onClick={isComposite ? () => onSelect(node.composite!) : undefined}
            role={isComposite ? "button" : undefined}
            tabIndex={isComposite ? 0 : undefined}
            onKeyDown={
              isComposite
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(node.composite!);
                  }
                : undefined
            }
          >
            <rect
              x={0}
              y={0}
              width={NODE_W}
              height={NODE_H}
              rx={8}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={isSelected ? 2 : isComposite ? 1.5 : 1}
              strokeDasharray={isComposite && !isSelected ? "4 2" : "none"}
              opacity={isComposite || isSelected || isTerminal ? 1 : 0.8}
            />

            <text
              x={isComposite ? NODE_W / 2 - 5 : NODE_W / 2}
              y={NODE_H / 2 + 1}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={textColor}
              fontSize={11}
              fontFamily="var(--fm)"
              fontWeight={isSelected ? 600 : 400}
              style={{ pointerEvents: "none" }}
            >
              {node.label}
            </text>

            {isComposite && (
              <text
                x={NODE_W - 14}
                y={NODE_H / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={isSelected ? "var(--accent)" : "var(--dim)"}
                fontSize={9}
                fontFamily="var(--fm)"
                style={{ pointerEvents: "none" }}
              >
                {isSelected ? "\u25BC" : "\u25B6"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Child workflow graph rendering ── */

function ChildGraph({ graph }: { graph: WorkflowGraph }) {
  return (
    <svg
      viewBox={graph.viewBox}
      className="w-full"
      style={{ height: "auto" }}
      role="img"
      aria-label={`${graph.label} child workflow`}
    >
      <defs>
        <marker
          id={`arr-child-${graph.id}`}
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
          // biome-ignore lint/suspicious/noArrayIndexKey: static data
          key={i}
          d={arrowPath(graph.nodes, edge.from, edge.to, CHILD_NODE_W, CHILD_NODE_H)}
          fill="none"
          stroke="var(--dim)"
          strokeWidth="1.5"
          opacity="0.5"
          markerEnd={`url(#arr-child-${graph.id})`}
        />
      ))}

      {graph.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
          <rect
            x={0}
            y={0}
            width={CHILD_NODE_W}
            height={CHILD_NODE_H}
            rx={8}
            fill="var(--bg2)"
            stroke={node.terminal ? "var(--ok)" : "var(--border)"}
            strokeWidth={node.terminal ? 1.5 : 1}
          />
          <text
            x={CHILD_NODE_W / 2}
            y={CHILD_NODE_H / 2 + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={node.terminal ? "var(--ok)" : "var(--dim)"}
            fontSize={11}
            fontFamily="var(--fm)"
          >
            {node.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* ── YAML snippet showing the composition syntax ── */

function YamlSnippet({
  stateId,
  yamlRef,
}: {
  stateId: string;
  yamlRef: string;
}) {
  return (
    <pre
      className={cn(
        "m-0 overflow-hidden whitespace-pre-wrap break-all rounded-md",
        "border border-[var(--border)] p-[10px_14px]",
        "font-mono text-xs leading-[1.7]",
      )}
      style={{
        background: "color-mix(in srgb, var(--bg) 60%, var(--bg2))",
      }}
    >
      <span className="sk">{stateId}</span>
      <span className="sp">:</span>
      {"\n"}
      {"  "}
      <span className="sk">workflow</span>
      <span className="sp">:</span>{" "}
      <span className="sv">{yamlRef}</span>
      {"\n"}
      {"  "}
      <span className="sk">transitions</span>
      <span className="sp">:</span>
      {"\n"}
      {"    "}
      <span className="sv">completed</span>
      <span className="sp">:</span>{" "}
      <span className="ss">{getNextState(stateId)}</span>
    </pre>
  );
}

function getNextState(stateId: string): string {
  const edge = parentGraph.edges.find((e) => e.from === stateId);
  return edge?.to ?? "done";
}

/* ── Main section ── */

export function Composable() {
  const [selected, setSelected] = useState("spec-gen");
  const child = childWorkflows[selected];

  const parentNode = parentGraph.nodes.find((n) => n.composite === selected);

  return (
    <section className="py-24">
      <div className="mx-auto max-w-[960px] px-10">
        {/* Header */}
        <div className="mb-14 flex flex-col items-center gap-3">
          <span className="text-xs uppercase tracking-widest font-mono text-[var(--accent)]">
            Architecture
          </span>
          <h2 className="text-4xl text-center font-heading text-foreground">
            Composable by Design
          </h2>
          <p className="mt-1 max-w-[560px] text-center text-sm text-muted-foreground">
            Embed entire workflows as single states. Each sub-workflow runs its
            own prompt injection loop with scoped todos and deterministic
            transitions, then hands control back to the parent.
          </p>
        </div>

        {/* Parent workflow label */}
        <div className="mb-4 flex justify-center">
          <Badge
            variant="outline"
            className="rounded-full font-mono border-[var(--accent)] text-[var(--accent)] opacity-85"
          >
            idea-to-pr
          </Badge>
        </div>

        {/* Parent graph */}
        <div
          className={cn(
            "rounded-xl border border-[var(--border)] bg-[var(--bg2)]",
            "px-8 pb-6 pt-7",
          )}
        >
          <ParentGraph graph={parentGraph} selected={selected} onSelect={setSelected} />
        </div>

        {/* Connector */}
        <div className="relative flex h-8 justify-center">
          <div
            className="h-full opacity-40"
            style={{
              width: 1,
              borderLeft: "1px dashed var(--accent)",
            }}
          />
        </div>

        {/* Child detail panel */}
        {child && (
          <div
            key={child.id}
            className={cn(
              "rounded-xl border border-[var(--border)] bg-[var(--bg2)]",
              "px-8 py-6 transition-opacity duration-200",
            )}
          >
            {/* Child header */}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className="rounded-md font-mono border-[var(--accent)] text-[var(--accent)] opacity-70"
                >
                  {child.label}
                </Badge>
                <span className="text-xs font-mono text-muted-foreground">
                  {child.graph.nodes.length} states
                </span>
              </div>
            </div>

            {/* Child graph + YAML side by side */}
            <div className="flex items-start gap-6">
              <div className="min-w-0 flex-1">
                <ChildGraph graph={child.graph} />
              </div>
              <div className="w-[300px] shrink-0">
                <div className="mb-2 text-xs font-mono text-muted-foreground opacity-60">
                  One line embeds the entire workflow:
                </div>
                <YamlSnippet
                  stateId={parentNode?.id ?? child.id}
                  yamlRef={child.yamlRef}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
