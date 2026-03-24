import { computeChangedLines } from "@shared/diff";
import { useEffect, useRef } from "react";

interface DiffGutterProps {
  editor: unknown;
  monaco: unknown;
  savedContent: string;
  currentContent: string;
}

const ADDED_COLOR = "#2ea04370";
const MODIFIED_COLOR = "#d29922";

export function DiffGutter(props: DiffGutterProps) {
  const { editor, monaco, savedContent, currentContent } = props;
  const decorationIds = useRef<string[]>([]);
  const injectedStyleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    if (!editor || !monaco) return;

    const monacoNs = monaco as {
      Range: new (s: number, sc: number, e: number, ec: number) => unknown;
    };
    const editorInstance = editor as {
      deltaDecorations: (old: string[], dec: unknown[]) => string[];
    };

    if (!injectedStyleRef.current) {
      const style = document.createElement("style");
      style.setAttribute("data-diff-gutter", "true");
      style.textContent = [
        `.codoc-diff-added { background: ${ADDED_COLOR} !important; width: 4px !important; margin-left: 3px !important; }`,
        `.codoc-diff-modified { background: ${MODIFIED_COLOR} !important; width: 4px !important; margin-left: 3px !important; }`,
      ].join("\n");
      document.head.appendChild(style);
      injectedStyleRef.current = style;
    }

    if (savedContent === currentContent) {
      decorationIds.current = editorInstance.deltaDecorations(
        decorationIds.current,
        [],
      );
      return;
    }

    const changedLineNumbers = computeChangedLines(savedContent, currentContent);
    const decorations = changedLineNumbers.map((lineNum) => ({
      range: new monacoNs.Range(lineNum, 1, lineNum, 1),
      options: {
        isWholeLine: true,
        marginClassName: "codoc-diff-added",
      },
    }));

    decorationIds.current = editorInstance.deltaDecorations(
      decorationIds.current,
      decorations,
    );
  }, [editor, monaco, savedContent, currentContent]);

  return null;
}
