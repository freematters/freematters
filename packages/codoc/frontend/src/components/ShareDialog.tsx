import { useCallback, useState } from "react";

interface ShareDialogProps {
  token: string;
  readonlyToken: string | null;
  onClose: () => void;
}

function buildUrl(pathPrefix: string, token: string): string {
  return `${window.location.origin}/${pathPrefix}/${token}`;
}

export function ShareDialog(props: ShareDialogProps) {
  const { token, readonlyToken, onClose } = props;
  const [copiedWritable, setCopiedWritable] = useState<boolean>(false);
  const [copiedReadonly, setCopiedReadonly] = useState<boolean>(false);

  const writableUrl = buildUrl("edit", token);
  const readonlyUrl = readonlyToken ? buildUrl("view", readonlyToken) : null;

  const handleCopyWritable = useCallback(() => {
    navigator.clipboard
      .writeText(writableUrl)
      .then(() => {
        setCopiedWritable(true);
        setTimeout(() => {
          setCopiedWritable(false);
        }, 2000);
      })
      .catch(() => {});
  }, [writableUrl]);

  const handleCopyReadonly = useCallback(() => {
    if (!readonlyUrl) return;
    navigator.clipboard
      .writeText(readonlyUrl)
      .then(() => {
        setCopiedReadonly(true);
        setTimeout(() => {
          setCopiedReadonly(false);
        }, 2000);
      })
      .catch(() => {});
  }, [readonlyUrl]);

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClose();
      }}
    >
      <div
        className="modal share-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title">Share</span>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            x
          </button>
        </div>

        <div className="share-section">
          <label className="share-label" htmlFor="share-writable-url">
            Writable URL
          </label>
          <div className="share-row">
            <input
              id="share-writable-url"
              className="share-input"
              type="text"
              readOnly
              value={writableUrl}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              type="button"
              className={copiedWritable ? "btn btn-copied" : "btn"}
              onClick={handleCopyWritable}
            >
              {copiedWritable ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {readonlyUrl && (
          <div className="share-section">
            <label className="share-label" htmlFor="share-readonly-url">
              Readonly URL
            </label>
            <div className="share-row">
              <input
                id="share-readonly-url"
                className="share-input"
                type="text"
                readOnly
                value={readonlyUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                className={copiedReadonly ? "btn btn-copied" : "btn"}
                onClick={handleCopyReadonly}
              >
                {copiedReadonly ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
