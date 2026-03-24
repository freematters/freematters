import { DiffEditor } from "@monaco-editor/react";

interface DiffViewProps {
  original: string;
  modified: string;
  title: string;
  onClose: () => void;
}

export function DiffView(props: DiffViewProps) {
  const { original, modified, title, onClose } = props;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClose();
      }}
    >
      <div
        className="modal diff-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            x
          </button>
        </div>
        <div className="diff-editor-container">
          <DiffEditor
            original={original}
            modified={modified}
            language="markdown"
            theme="vs-dark"
            options={{
              readOnly: true,
              originalEditable: false,
              minimap: { enabled: false },
              wordWrap: "on",
              fontSize: 13,
              scrollBeyondLastLine: false,
              renderSideBySide: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
