import { useEffect, useRef } from "react";
import type { BlameEntry } from "../api";

interface BlameGutterProps {
  token: string;
  editor: unknown;
  monaco: unknown;
  refreshTrigger: number;
  blameEntries: BlameEntry[];
  latestCommitHash: string | null;
}

const HUMAN_COLOR = "#3b82f6";
const AGENT_COLOR = "#22c55e";

function buildDecorations(
  entries: BlameEntry[],
  latestHash: string | null,
  Range: new (s: number, sc: number, e: number, ec: number) => unknown,
): unknown[] {
  const decorations: unknown[] = [];
  for (const entry of entries) {
    const isLatest = latestHash && entry.hash === latestHash;
    const cssClass = entry.isAgent ? "codoc-blame-agent" : "codoc-blame-human";
    decorations.push({
      range: new Range(entry.lineStart, 1, entry.lineEnd, 1),
      options: {
        isWholeLine: true,
        marginClassName: cssClass,
        minimap: {
          color: entry.isAgent ? AGENT_COLOR : HUMAN_COLOR,
          position: 1,
        },
        overviewRuler: isLatest
          ? { color: entry.isAgent ? AGENT_COLOR : HUMAN_COLOR, position: 1 }
          : undefined,
      },
    });
  }
  return decorations;
}

export function BlameGutter(props: BlameGutterProps) {
  const { editor, monaco, blameEntries, latestCommitHash } = props;
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);
  const entriesRef = useRef(blameEntries);
  const latestHashRef = useRef(latestCommitHash);
  entriesRef.current = blameEntries;
  latestHashRef.current = latestCommitHash;

  useEffect(() => {
    if (!editor || !monaco || blameEntries.length === 0) return;

    const monacoNs = monaco as {
      Range: new (s: number, sc: number, e: number, ec: number) => unknown;
    };
    const editorInstance = editor as {
      deltaDecorations: (old: string[], dec: unknown[]) => string[];
      getModel: () => {
        onDidChangeContent: (cb: () => void) => { dispose: () => void };
      } | null;
    };

    if (!injectedStyleRef.current) {
      const style = document.createElement("style");
      style.setAttribute("data-blame-gutter", "true");
      style.textContent = [
        `.codoc-blame-agent { background: ${AGENT_COLOR} !important; width: 4px !important; margin-left: 3px !important; }`,
        `.codoc-blame-human { background: ${HUMAN_COLOR} !important; width: 4px !important; margin-left: 3px !important; }`,
      ].join("\n");
      document.head.appendChild(style);
      injectedStyleRef.current = style;
    }

    let ids: string[] = [];

    const apply = () => {
      const decs = buildDecorations(
        entriesRef.current,
        latestHashRef.current,
        monacoNs.Range,
      );
      ids = editorInstance.deltaDecorations(ids, decs);
    };

    apply();

    // Re-apply after programmatic content replacement (setValue destroys decorations)
    const model = editorInstance.getModel();
    const disposable = model?.onDidChangeContent(() => {
      // Use setTimeout to batch with React re-renders
      setTimeout(apply, 0);
    });

    return () => {
      editorInstance.deltaDecorations(ids, []);
      disposable?.dispose();
    };
  }, [editor, monaco, blameEntries, latestCommitHash]);

  return null;
}
