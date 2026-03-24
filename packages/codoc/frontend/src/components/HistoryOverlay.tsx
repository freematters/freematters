import { useCallback, useEffect, useState } from "react";
import {
  type LogEntry,
  fetchDiff,
  fetchHistory,
  fetchHistoryContent,
  revertToCommit,
} from "../api";
import { DiffView } from "./DiffView";

interface HistoryOverlayProps {
  token: string;
  dirty: boolean;
  showLatestDiff: boolean;
  currentContent: string;
  onClose: () => void;
  onRevert: (content: string) => void;
}

export function HistoryOverlay(props: HistoryOverlayProps) {
  const { token, dirty, showLatestDiff, currentContent, onClose, onRevert } = props;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [diffData, setDiffData] = useState<{
    original: string;
    modified: string;
    title: string;
  } | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [autoShownDiff, setAutoShownDiff] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);
    fetchHistory(token)
      .then((data) => {
        setEntries(data);
        setLoading(false);
        if (showLatestDiff && !autoShownDiff && data.length > 0) {
          setAutoShownDiff(true);
          if (data.length >= 2) {
            Promise.all([
              fetchHistoryContent(token, data[1].hash),
              fetchHistoryContent(token, data[0].hash),
            ])
              .then(([prev, latest]) => {
                setDiffData({
                  original: prev,
                  modified: latest,
                  title: `${data[0].author} — ${new Date(data[0].date).toLocaleString()}`,
                });
              })
              .catch(() => {});
          } else {
            fetchHistoryContent(token, data[0].hash)
              .then((content) => {
                setDiffData({
                  original: "",
                  modified: content,
                  title: `${data[0].author} — ${new Date(data[0].date).toLocaleString()}`,
                });
              })
              .catch(() => {});
          }
        }
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [token]);

  const handleRevert = useCallback(
    (hash: string) => {
      setReverting(hash);
      revertToCommit(token, hash)
        .then((data) => {
          onRevert(data.content);
          setReverting(null);
          onClose();
        })
        .catch((err: Error) => {
          setError(err.message);
          setReverting(null);
        });
    },
    [token, onRevert, onClose],
  );

  const handleViewDiff = useCallback(
    (hash: string, index: number) => {
      const entry = entries[index];
      const author = entry.author;
      const date = new Date(entry.date).toLocaleString();
      if (index >= entries.length - 1) {
        fetchHistoryContent(token, hash)
          .then((content) => {
            setDiffData({
              original: "",
              modified: content,
              title: `${author} — ${date}`,
            });
          })
          .catch((err: Error) => {
            setError(err.message);
          });
        return;
      }
      const prevEntry = entries[index + 1];
      Promise.all([
        fetchHistoryContent(token, prevEntry.hash),
        fetchHistoryContent(token, hash),
      ])
        .then(([prevContent, currentContent]) => {
          setDiffData({
            original: prevContent,
            modified: currentContent,
            title: `${author} — ${date}`,
          });
        })
        .catch((err: Error) => {
          setError(err.message);
        });
    },
    [token, entries],
  );

  const handleViewUnsavedDiff = useCallback(() => {
    if (entries.length > 0) {
      fetchHistoryContent(token, entries[0].hash)
        .then((lastSaved) => {
          setDiffData({
            original: lastSaved,
            modified: currentContent,
            title: "Unsaved changes",
          });
        })
        .catch((err: Error) => {
          setError(err.message);
        });
    }
  }, [token, entries, currentContent]);

  const closeDiff = useCallback(() => {
    setDiffData(null);
  }, []);

  if (diffData !== null) {
    return (
      <DiffView
        original={diffData.original}
        modified={diffData.modified}
        title={diffData.title}
        onClose={closeDiff}
      />
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="button"
      tabIndex={0}
    >
      <div
        className="modal history-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div className="modal-header">
          <span className="modal-title">History</span>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            x
          </button>
        </div>

        {loading && <div className="history-loading">Loading...</div>}
        {error && <div className="history-error">{error}</div>}

        {!loading && entries.length === 0 && (
          <div className="history-empty">No history</div>
        )}

        {dirty && (
          <div className="history-entry">
            <div>
              <span className="history-entry-author">Unsaved changes</span>
              <span className="history-entry-time">now</span>
            </div>
            <div className="history-entry-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleViewUnsavedDiff}
              >
                Diff
              </button>
            </div>
          </div>
        )}

        {entries.map((entry, index) => {
          const date = new Date(entry.date);
          const timeStr = date.toLocaleString();
          const isReverting = reverting === entry.hash;
          return (
            <div key={entry.hash} className="history-entry">
              <div>
                <span className="history-entry-author">{entry.author}</span>
                <span className="history-entry-time">{timeStr}</span>
              </div>
              <div className="history-entry-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleViewDiff(entry.hash, index)}
                >
                  Diff
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => handleRevert(entry.hash)}
                  disabled={isReverting}
                >
                  {isReverting ? "Reverting..." : "Revert"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
