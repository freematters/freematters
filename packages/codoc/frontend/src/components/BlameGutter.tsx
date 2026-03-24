import { useCallback, useEffect, useRef } from "react";
import { type BlameEntry, fetchBlame } from "../api";

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
  const { token, editor, monaco, refreshTrigger, blameEntries, latestCommitHash } =
    props;
  const decorationIds = useRef<string[]>([]);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);

  const applyDecorations = useCallback(
    (
      entries: BlameEntry[],
      monacoNs: {
        editor: { TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: number } };
        Range: new (
          startLine: number,
          startCol: number,
          endLine: number,
          endCol: number,
        ) => unknown;
      },
      editorInstance: {
        deltaDecorations: (oldIds: string[], newDecorations: unknown[]) => string[];
        getModel: () => { getLineCount: () => number } | null;
      },
      latestHash: string | null,
    ) => {
      const decorations: unknown[] = [];

      if (!latestHash) {
        decorationIds.current = editorInstance.deltaDecorations(
          decorationIds.current,
          [],
        );
        return;
      }

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

      for (const entry of entries) {
        const isLatest = latestHash && entry.hash === latestHash;
        const cssClass = entry.isAgent ? "codoc-blame-agent" : "codoc-blame-human";
        for (let line = entry.lineStart; line <= entry.lineEnd; line++) {
          decorations.push({
            range: new monacoNs.Range(line, 1, line, 1),
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
      }

      decorationIds.current = editorInstance.deltaDecorations(
        decorationIds.current,
        decorations,
      );
    },
    [],
  );

  const updateBlame = useCallback(() => {
    if (!editor || !monaco) return;

    const monacoNs = monaco as {
      editor: {
        TrackedRangeStickiness: { NeverGrowsWhenTypingAtEdges: number };
      };
      Range: new (
        startLine: number,
        startCol: number,
        endLine: number,
        endCol: number,
      ) => unknown;
    };

    const editorInstance = editor as {
      deltaDecorations: (oldIds: string[], newDecorations: unknown[]) => string[];
      getModel: () => { getLineCount: () => number } | null;
    };

    if (blameEntries.length === 0) {
      fetchBlame(token)
        .then((entries: BlameEntry[]) => {
          applyDecorations(entries, monacoNs, editorInstance, latestCommitHash);
        })
        .catch(() => {});
    } else {
      applyDecorations(blameEntries, monacoNs, editorInstance, latestCommitHash);
    }
  }, [token, editor, monaco, blameEntries, latestCommitHash, applyDecorations]);

  useEffect(() => {
    updateBlame();
  }, [updateBlame, refreshTrigger]);

  return null;
}
