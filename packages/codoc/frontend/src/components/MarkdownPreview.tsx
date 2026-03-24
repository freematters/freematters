import {
  type CommentThread,
  MULTILINE_BLOCK_REGEX,
  formatCommentBlock,
  groupThreads,
  parseComments,
} from "@shared/comment-parser";
import { useCallback, useMemo, useRef, useState } from "react";
import { generateId } from "../utils";

declare global {
  interface Window {
    markdownit?: (options: { html: boolean }) => { render: (src: string) => string };
  }
}

function stripComments(content: string): string {
  MULTILINE_BLOCK_REGEX.lastIndex = 0;
  return content.replace(MULTILINE_BLOCK_REGEX, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface MarkdownPreviewProps {
  content: string;
  username: string;
  onInsertReply: (replyText: string, thread: CommentThread) => void;
  onResolveThread: (thread: CommentThread) => void;
}

interface ThreadBlockProps {
  thread: CommentThread;
  username: string;
  onInsertReply: (replyText: string, thread: CommentThread) => void;
  onResolveThread: (thread: CommentThread) => void;
  threadIndex: number;
  totalThreads: number;
  onNavigateThread: (targetIndex: number) => void;
  registerRef: (globalIndex: number, el: HTMLTextAreaElement | null) => void;
}

function ThreadBlock(props: ThreadBlockProps) {
  const {
    thread,
    username,
    onInsertReply,
    onResolveThread,
    threadIndex,
    totalThreads,
    onNavigateThread,
    registerRef,
  } = props;
  const [showReplyForm, setShowReplyForm] = useState<boolean>(false);
  const [replyText, setReplyText] = useState<string>("");

  const handleToggleReply = useCallback(() => {
    setShowReplyForm((prev) => !prev);
    setReplyText("");
  }, []);

  const handleSubmitReply = useCallback(() => {
    const trimmed = replyText.trim();
    if (trimmed.length === 0) return;

    const cid = generateId();
    const lastComment = thread.comments[thread.comments.length - 1];
    const replyToCid = lastComment?.cid || undefined;

    const block = formatCommentBlock([
      {
        username,
        text: trimmed,
        tid: thread.threadId || undefined,
        cid,
        replyTo: replyToCid,
      },
      {
        username: "agent",
        text: "...",
        tid: thread.threadId || undefined,
        replyTo: cid,
        isReplyTemplate: true,
      },
    ]);

    onInsertReply(block, thread);
    setReplyText("");
    setShowReplyForm(false);
  }, [replyText, username, thread, onInsertReply]);

  const handleResolve = useCallback(() => {
    onResolveThread(thread);
  }, [thread, onResolveThread]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmitReply();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowReplyForm(false);
        setReplyText("");
      }
      if (e.key === "ArrowUp" && threadIndex > 0) {
        e.preventDefault();
        onNavigateThread(threadIndex - 1);
      }
      if (e.key === "ArrowDown" && threadIndex < totalThreads - 1) {
        e.preventDefault();
        onNavigateThread(threadIndex + 1);
      }
    },
    [handleSubmitReply, threadIndex, totalThreads, onNavigateThread],
  );

  return (
    <div className="preview-inline-thread">
      {thread.comments.map((c, i) => {
        const isReply = !!c.replyTo;
        const className = isReply
          ? "preview-inline-thread-comment preview-inline-thread-reply"
          : "preview-inline-thread-comment";
        return (
          <div key={c.cid || `comment-${i}`} className={className}>
            <span className="preview-thread-user">@{c.username}</span>
            {c.status && <span className="preview-thread-status">{c.status}</span>}
            <span className="preview-thread-text"> {c.text}</span>
          </div>
        );
      })}
      <div className="preview-thread-actions">
        <button
          type="button"
          className="preview-thread-reply-btn"
          onClick={handleToggleReply}
        >
          {showReplyForm ? "Cancel" : "Reply"}
        </button>
        <button
          className="preview-thread-resolve-btn"
          onClick={handleResolve}
          title="Resolve thread"
        >
          Resolve
        </button>
      </div>
      {showReplyForm && (
        <div className="preview-inline-reply-form">
          <textarea
            ref={(el) => registerRef(threadIndex, el)}
            className="preview-inline-reply-input"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Reply as @${username}...`}
          />
          <div className="preview-inline-reply-actions">
            <button className="btn btn-sm" onClick={handleToggleReply}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSubmitReply}>
              Reply (Cmd+Enter)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MarkdownPreview(props: MarkdownPreviewProps) {
  const { content, username, onInsertReply, onResolveThread } = props;

  const threadReplyRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());
  const globalThreadCounter = useRef<number>(0);

  const registerThreadRef = useCallback(
    (globalIndex: number, el: HTMLTextAreaElement | null) => {
      if (el) {
        threadReplyRefs.current.set(globalIndex, el);
      } else {
        threadReplyRefs.current.delete(globalIndex);
      }
    },
    [],
  );

  const handleNavigateThread = useCallback((targetGlobalIndex: number) => {
    const targetEl = threadReplyRefs.current.get(targetGlobalIndex);
    if (targetEl) {
      targetEl.focus();
    }
  }, []);

  const { htmlParts, threadData } = useMemo(() => {
    const md = window.markdownit?.({ html: false });
    if (!md) {
      return { htmlParts: ["<p><em>markdown-it not loaded</em></p>"], threadData: [] };
    }

    const threads = groupThreads(parseComments(content));
    const originalLines = content.split("\n");

    const BLOCK_INNER_LINE_RE =
      /^@[^\[\]]+?(?:\[tid:\w+\])?(?:\[cid:\w+\])?(?:\[reply:\w+\])?(?:\[status:\w+\])?: /;
    const BLOCK_RT_LINE_RE = /^\[REPLY_TEMPLATE\] @\w+/;
    const isCommentLine = (line: string): boolean => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("<!--") && trimmed.endsWith("-->")) return true;
      if (trimmed === "<!--" || trimmed === "-->") return true;
      if (BLOCK_INNER_LINE_RE.test(trimmed)) return true;
      if (BLOCK_RT_LINE_RE.test(trimmed)) return true;
      return false;
    };

    const origToStripped = new Map<number, number>();
    let strippedIdx = 0;
    const strippedLines: string[] = [];
    for (let i = 0; i < originalLines.length; i++) {
      if (!isCommentLine(originalLines[i])) {
        origToStripped.set(i, strippedIdx);
        strippedLines.push(originalLines[i]);
        strippedIdx++;
      }
    }

    const threadsByStrippedLine = new Map<number, CommentThread[]>();
    for (const thread of threads) {
      const mapped = origToStripped.get(thread.anchorLine);
      const targetLine = mapped !== undefined ? mapped : strippedLines.length - 1;
      const existing = threadsByStrippedLine.get(targetLine);
      if (existing) {
        existing.push(thread);
      } else {
        threadsByStrippedLine.set(targetLine, [thread]);
      }
    }

    const parts: string[] = [];
    const tData: { index: number; threads: CommentThread[] }[] = [];
    let currentChunk: string[] = [];
    let partIndex = 0;

    for (let i = 0; i < strippedLines.length; i++) {
      currentChunk.push(strippedLines[i]);

      const lineThreads = threadsByStrippedLine.get(i);
      if (lineThreads) {
        parts.push(md.render(currentChunk.join("\n")));
        partIndex++;
        parts.push("");
        tData.push({ index: partIndex, threads: lineThreads });
        partIndex++;
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      parts.push(md.render(currentChunk.join("\n")));
    }

    if (threads.length > 0) {
      const unmapped = threads.filter(
        (t) => origToStripped.get(t.anchorLine) === undefined,
      );
      if (unmapped.length > 0) {
        parts.push("");
        tData.push({ index: parts.length - 1, threads: unmapped });
      }
    }

    return { htmlParts: parts, threadData: tData };
  }, [content]);

  const totalThreadCount = threadData.reduce((sum, td) => sum + td.threads.length, 0);
  globalThreadCounter.current = 0;

  return (
    <div className="preview-content">
      {htmlParts.map((part, i) => {
        const threadInfo = threadData.find((t) => t.index === i);
        if (threadInfo) {
          return (
            <div key={i}>
              {threadInfo.threads.map((thread, j) => {
                const globalIndex = globalThreadCounter.current;
                globalThreadCounter.current++;
                return (
                  <ThreadBlock
                    key={j}
                    thread={thread}
                    username={username}
                    onInsertReply={onInsertReply}
                    onResolveThread={onResolveThread}
                    threadIndex={globalIndex}
                    totalThreads={totalThreadCount}
                    onNavigateThread={handleNavigateThread}
                    registerRef={registerThreadRef}
                  />
                );
              })}
            </div>
          );
        }
        if (part) {
          return <div key={i} dangerouslySetInnerHTML={{ __html: part }} />;
        }
        return null;
      })}
    </div>
  );
}
