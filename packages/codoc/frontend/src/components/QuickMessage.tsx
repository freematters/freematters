import { formatCommentBlock } from "@shared/comment-parser";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateId } from "../utils";

interface QuickMessageProps {
  username: string;
  onSend: (message: string) => void;
}

export function QuickMessage(props: QuickMessageProps) {
  const { username, onSend } = props;
  const [open, setOpen] = useState<boolean>(false);
  const [text, setText] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
    setText("");
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    const cid = generateId();
    const block = formatCommentBlock([
      {
        username,
        text: trimmed,
        cid,
      },
      {
        username: "agent",
        text: "...",
        replyTo: cid,
        isReplyTemplate: true,
      },
    ]);
    onSend(block.trimEnd());
    setText("");
    setOpen(false);
  }, [text, username, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setText("");
      }
    },
    [handleSend],
  );

  return (
    <div className="quick-message-wrapper">
      <button type="button" className="btn" onClick={handleToggle}>
        Comment on Document<span className="btn-shortcut">⇧⌘↵</span>
      </button>
      {open && (
        <div className="quick-message-popup">
          <input
            ref={inputRef}
            className="quick-message-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
          />
          <button type="button" className="btn btn-primary" onClick={handleSend}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
