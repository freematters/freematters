import { formatCommentBlock } from "@shared/comment-parser";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateId } from "../utils";

interface CommentPopupProps {
  lineNumber: number;
  endLineNumber: number;
  username: string;
  onSubmit: (commentText: string, replyTemplateText: string) => void;
  onClose: () => void;
}

export function CommentPopup(props: CommentPopupProps) {
  const { lineNumber, endLineNumber, username, onSubmit, onClose } = props;
  const [text, setText] = useState<string>("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    if (text.trim() === "") return;

    const tid = generateId();
    const cid = generateId();

    const block = formatCommentBlock([
      {
        username,
        text: text.trim(),
        tid,
        cid,
      },
      {
        username: "agent",
        text: "reply here",
        tid,
        replyTo: cid,
        isReplyTemplate: true,
      },
    ]);

    onSubmit(block, "");
  }, [text, username, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [handleSubmit, onClose],
  );

  return (
    <div className="comment-popup">
      <div className="comment-popup-header">
        Comment on{" "}
        {lineNumber === endLineNumber
          ? `line ${lineNumber + 1}`
          : `lines ${lineNumber + 1}-${endLineNumber + 1}`}{" "}
        as <strong>@{username}</strong>
      </div>
      <textarea
        ref={inputRef}
        className="comment-popup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your comment..."
      />
      <div className="comment-popup-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSubmit}>
          Comment (Cmd+Enter)
        </button>
      </div>
    </div>
  );
}
