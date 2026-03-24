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

export function BlameGutter(props: BlameGutterProps) {
  const { editor, monaco, blameEntries, latestCommitHash } = props;
  const decorationCollection = useRef<{
    clear: () => void;
    set: (d: unknown[]) => void;
  } | null>(null);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!editor || !monaco || blameEntries.length === 0) return;

    const monacoNs = monaco as {
      Range: new (
        startLine: number,
        startCol: number,
        endLine: number,
        endCol: number,
      ) => unknown;
    };

    const editorInstance = editor as {
      createDecorationsCollection: (decorations: unknown[]) => {
        clear: () => void;
        set: (decorations: unknown[]) => void;
      };
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

    const decorations: unknown[] = [];
    for (const entry of blameEntries) {
      const isLatest = latestCommitHash && entry.hash === latestCommitHash;
      const cssClass = entry.isAgent ? "codoc-blame-agent" : "codoc-blame-human";
      decorations.push({
        range: new monacoNs.Range(entry.lineStart, 1, entry.lineEnd, 1),
        options: {
          isWholeLine: true,
          marginClassName: cssClass,
          minimap: {
            color: entry.isAgent ? AGENT_COLOR : HUMAN_COLOR,
            position: 1,
          },
          overviewRuler: isLatest
            ? {
                color: entry.isAgent ? AGENT_COLOR : HUMAN_COLOR,
                position: 1,
              }
            : undefined,
        },
      });
    }

    if (decorationCollection.current) {
      decorationCollection.current.set(decorations);
    } else {
      decorationCollection.current =
        editorInstance.createDecorationsCollection(decorations);
    }

    return () => {
      if (decorationCollection.current) {
        decorationCollection.current.clear();
        decorationCollection.current = null;
      }
    };
  }, [editor, monaco, blameEntries, latestCommitHash]);

  return null;
}
