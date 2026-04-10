import { forwardRef, useImperativeHandle, useRef } from "react";

export interface StateGraphHandle {
  animateDot(edgeKey: string): Promise<void>;
}

interface Props {
  currentState: string | null;
  completedStates: Set<string>;
  activeEdge: string | null;
}

function nodeClass(
  name: string,
  currentState: string | null,
  completedStates: Set<string>,
) {
  if (currentState === name) return "active";
  if (completedStates.has(name)) return "completed";
  return "";
}

function edgeMarker(
  edgeKey: string,
  activeEdge: string | null,
  completedEdges: Set<string>,
) {
  if (activeEdge === edgeKey) return "url(#aAct)";
  if (completedEdges.has(edgeKey)) return "url(#aOk)";
  return "url(#aDim)";
}

function edgeClass(
  edgeKey: string,
  activeEdge: string | null,
  completedEdges: Set<string>,
) {
  if (activeEdge === edgeKey) return "edge-path active";
  if (completedEdges.has(edgeKey)) return "edge-path completed";
  return "edge-path";
}

// Derive which edges are completed from completedStates
function getCompletedEdges(completedStates: Set<string>): Set<string> {
  const edges = new Set<string>();
  if (completedStates.has("read")) edges.add("read->analyze");
  if (completedStates.has("analyze")) {
    edges.add("analyze->feedback");
    edges.add("analyze->done");
  }
  if (completedStates.has("feedback")) edges.add("feedback->done");
  return edges;
}

export const StateGraph = forwardRef<StateGraphHandle, Props>(function StateGraph(
  { currentState, completedStates, activeEdge },
  ref,
) {
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    animateDot(edgeKey: string): Promise<void> {
      return new Promise<void>((resolve) => {
        const svg = svgRef.current;
        if (!svg) {
          resolve();
          return;
        }
        const pathId = `edge-${edgeKey.replace("->", "-")}`;
        const dotId = `dot-${edgeKey.replace("->", "-")}`;
        const pathEl = svg.querySelector<SVGPathElement>(`#${pathId}`);
        const dotEl = svg.querySelector<SVGCircleElement>(`#${dotId}`);
        if (!pathEl || !dotEl) {
          resolve();
          return;
        }

        // Captured as non-null locals for the closure (guarded by early return above)
        const path = pathEl;
        const dot = dotEl;
        const len = path.getTotalLength();
        dot.style.opacity = "1";
        let t0: number | null = null;

        function step(ts: number) {
          if (t0 === null) t0 = ts;
          const t = Math.min((ts - t0) / 600, 1);
          const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
          const pt = path.getPointAtLength(ease * len);
          dot.setAttribute("cx", String(pt.x));
          dot.setAttribute("cy", String(pt.y));
          if (t < 1) {
            requestAnimationFrame(step);
          } else {
            dot.style.opacity = "0";
            resolve();
          }
        }

        requestAnimationFrame(step);
      });
    },
  }));

  const completedEdges = getCompletedEdges(completedStates);

  const nodeStyle = (name: string): React.CSSProperties => {
    const cls = nodeClass(name, currentState, completedStates);
    if (cls === "active") {
      return {
        fill: "color-mix(in srgb, var(--accent) 12%, var(--bg2))",
        stroke: "var(--accent)",
        strokeWidth: 2.5,
        animation: "pulse 2s ease-in-out infinite",
        transition: "fill .4s, stroke .4s",
        rx: 10,
      } as React.CSSProperties;
    }
    if (cls === "completed") {
      return {
        fill: "color-mix(in srgb, var(--ok) 10%, var(--bg2))",
        stroke: "var(--ok)",
        strokeWidth: 1.5,
        transition: "fill .4s, stroke .4s",
        rx: 10,
      } as React.CSSProperties;
    }
    return {
      fill: "var(--bg2)",
      stroke: "var(--border)",
      strokeWidth: 1.5,
      transition: "fill .4s, stroke .4s",
      rx: 10,
    } as React.CSSProperties;
  };

  const labelStyle = (name: string): React.CSSProperties => {
    const cls = nodeClass(name, currentState, completedStates);
    return {
      fill:
        cls === "active"
          ? "var(--accent)"
          : cls === "completed"
            ? "var(--ok)"
            : "var(--dim)",
      fontFamily: "var(--fm)",
      fontSize: 16,
      fontWeight: cls === "completed" ? 600 : 500,
      textAnchor: "middle",
      dominantBaseline: "central",
      transition: "fill .4s",
      pointerEvents: "none",
    } as React.CSSProperties;
  };

  const edgePathStyle = (edgeKey: string): React.CSSProperties => {
    if (activeEdge === edgeKey) {
      return {
        fill: "none",
        stroke: "var(--accent)",
        strokeWidth: 2.5,
        transition: "stroke .5s",
      };
    }
    if (completedEdges.has(edgeKey)) {
      return {
        fill: "none",
        stroke: "var(--ok)",
        strokeWidth: 1.5,
        transition: "stroke .5s",
      };
    }
    return {
      fill: "none",
      stroke: "var(--border)",
      strokeWidth: 1.5,
      transition: "stroke .5s",
    };
  };

  return (
    <div style={{ width: "100%" }}>
      <svg
        ref={svgRef}
        viewBox="0 20 600 300"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Workflow state machine graph"
      >
        <defs>
          <marker
            id="aDim"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--border)" />
          </marker>
          <marker
            id="aAct"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--accent)" />
          </marker>
          <marker
            id="aOk"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" fill="var(--ok)" />
          </marker>
        </defs>

        {/* Edges */}
        <path
          id="edge-read-analyze"
          className={edgeClass("read->analyze", activeEdge, completedEdges)}
          style={edgePathStyle("read->analyze")}
          d="M160 170 L220 170"
          markerEnd={edgeMarker("read->analyze", activeEdge, completedEdges)}
        />
        <path
          id="edge-analyze-feedback"
          className={edgeClass("analyze->feedback", activeEdge, completedEdges)}
          style={edgePathStyle("analyze->feedback")}
          d="M350 158 C385 130, 405 105, 420 84"
          markerEnd={edgeMarker("analyze->feedback", activeEdge, completedEdges)}
        />
        <path
          id="edge-analyze-done"
          className={edgeClass("analyze->done", activeEdge, completedEdges)}
          style={edgePathStyle("analyze->done")}
          d="M350 182 C385 210, 405 250, 420 264"
          markerEnd={edgeMarker("analyze->done", activeEdge, completedEdges)}
        />
        <path
          id="edge-feedback-done"
          className={edgeClass("feedback->done", activeEdge, completedEdges)}
          style={edgePathStyle("feedback->done")}
          d="M485 108 L485 240"
          markerEnd={edgeMarker("feedback->done", activeEdge, completedEdges)}
        />

        {/* Traveling dots */}
        <circle
          id="dot-read-analyze"
          r={5}
          fill="var(--accent)"
          style={{ opacity: 0 }}
          cx={0}
          cy={0}
        />
        <circle
          id="dot-analyze-feedback"
          r={5}
          fill="var(--accent)"
          style={{ opacity: 0 }}
          cx={0}
          cy={0}
        />
        <circle
          id="dot-analyze-done"
          r={5}
          fill="var(--accent)"
          style={{ opacity: 0 }}
          cx={0}
          cy={0}
        />
        <circle
          id="dot-feedback-done"
          r={5}
          fill="var(--accent)"
          style={{ opacity: 0 }}
          cx={0}
          cy={0}
        />

        {/* Edge labels */}
        <text
          x={190}
          y={156}
          fill="var(--dim)"
          fontFamily="var(--fm)"
          fontSize={10}
          textAnchor="middle"
          opacity={0.5}
        >
          analyzed
        </text>
        <text
          x={385}
          y={118}
          fill="var(--dim)"
          fontFamily="var(--fm)"
          fontSize={10}
          textAnchor="middle"
          opacity={0.5}
        >
          found issues
        </text>
        <text
          x={385}
          y={228}
          fill="var(--dim)"
          fontFamily="var(--fm)"
          fontSize={10}
          textAnchor="middle"
          opacity={0.5}
        >
          looks good
        </text>
        <text
          x={500}
          y={175}
          fill="var(--dim)"
          fontFamily="var(--fm)"
          fontSize={10}
          textAnchor="start"
          opacity={0.5}
        >
          reviewed
        </text>

        {/* Nodes */}
        <g id="node-read">
          <rect
            style={nodeStyle("read")}
            x={30}
            y={146}
            width={130}
            height={48}
            rx={10}
          />
          <text style={labelStyle("read")} x={95} y={170}>
            read
          </text>
        </g>
        <g id="node-analyze">
          <rect
            style={nodeStyle("analyze")}
            x={220}
            y={146}
            width={130}
            height={48}
            rx={10}
          />
          <text style={labelStyle("analyze")} x={285} y={170}>
            analyze
          </text>
        </g>
        <g id="node-feedback">
          <rect
            style={nodeStyle("feedback")}
            x={420}
            y={60}
            width={130}
            height={48}
            rx={10}
          />
          <text style={labelStyle("feedback")} x={485} y={84}>
            feedback
          </text>
        </g>
        <g id="node-done">
          <rect
            style={nodeStyle("done")}
            x={420}
            y={240}
            width={130}
            height={48}
            rx={10}
          />
          <text style={labelStyle("done")} x={485} y={264}>
            done
          </text>
        </g>
      </svg>

      <div
        style={{
          textAlign: "center",
          marginTop: 14,
          fontFamily: "var(--fm)",
          fontSize: "0.6rem",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--dim)",
          opacity: 0.5,
        }}
      >
        Live State Machine
      </div>
    </div>
  );
});
