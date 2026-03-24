export interface Comment {
  username: string;
  text: string;
  tid?: string;
  cid?: string;
  replyTo?: string;
  status?: "resolved" | "wontfix";
  anchorLine: number;
}

export interface CommentThread {
  threadId: string;
  anchorLine: number;
  comments: Comment[];
}

export const MULTILINE_BLOCK_REGEX = /<!--\n([\s\S]*?)\n-->\n?/g;

const COMMENT_LINE_REGEX =
  /^@([^\[\]]+?)(?:\[tid:(\w+)\])?(?:\[cid:(\w+)\])?(?:\[reply:(\w+)\])?(?:\[status:(\w+)\])?: (.*)$/;

const REPLY_TEMPLATE_LINE_REGEX =
  /^\[REPLY_TEMPLATE\] @(\w+)(?:\[tid:(\w+)\])?(?:\[cid:(\w+)\])(?:\[reply:(\w+)\])?: (.*)$/;

function unescapeCommentText(text: string): string {
  return text.replace(/\\-\\-\\>/g, "-->").replace(/\\n/g, "\n");
}

export function escapeCommentText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/-->/g, "\\-\\-\\>").replace(/\n/g, "\\n");
}

function findAnchorLine(lines: string[], commentLineIndex: number): number {
  for (let i = commentLineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trimStart();
    if (trimmed === "<!--" || trimmed === "-->") continue;
    if (COMMENT_LINE_REGEX.test(trimmed)) continue;
    if (REPLY_TEMPLATE_LINE_REGEX.test(trimmed)) continue;
    return i;
  }
  return 0;
}

export function parseComments(content: string): Comment[] {
  const lines = content.split("\n");
  const comments: Comment[] = [];

  MULTILINE_BLOCK_REGEX.lastIndex = 0;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = MULTILINE_BLOCK_REGEX.exec(content)) !== null) {
    const blockStart = blockMatch.index;
    const blockBody = blockMatch[1];
    const blockLines = blockBody.split("\n");

    let blockStartLineIndex = 0;
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charCount >= blockStart) {
        blockStartLineIndex = i;
        break;
      }
      charCount += lines[i].length + 1;
    }

    const anchorLine = findAnchorLine(lines, blockStartLineIndex);

    for (const line of blockLines) {
      if (REPLY_TEMPLATE_LINE_REGEX.test(line)) {
        continue;
      }

      const lineMatch = COMMENT_LINE_REGEX.exec(line);
      if (lineMatch) {
        const text = unescapeCommentText(lineMatch[6]).trim();

        const comment: Comment = {
          username: lineMatch[1],
          text,
          anchorLine,
        };

        if (lineMatch[2] !== undefined) comment.tid = lineMatch[2];
        if (lineMatch[3] !== undefined) comment.cid = lineMatch[3];
        if (lineMatch[4] !== undefined) comment.replyTo = lineMatch[4];
        if (lineMatch[5] !== undefined)
          comment.status = lineMatch[5] as "resolved" | "wontfix";

        comments.push(comment);
      }
    }
  }

  return comments;
}

export function groupThreads(comments: Comment[]): CommentThread[] {
  if (comments.length === 0) {
    return [];
  }

  const cidToThreadId = new Map<string, string>();
  for (const comment of comments) {
    const tid = comment.tid ?? comment.cid;
    if (tid && comment.cid) {
      cidToThreadId.set(comment.cid, tid);
    }
  }

  const threadMap = new Map<
    string,
    { anchorLine: number; comments: { comment: Comment; index: number }[] }
  >();

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    let threadId: string;
    if (comment.tid) {
      threadId = comment.tid;
    } else if (comment.replyTo && cidToThreadId.has(comment.replyTo)) {
      threadId = cidToThreadId.get(comment.replyTo)!;
    } else {
      threadId = comment.cid ?? `_auto_${i}`;
    }

    if (comment.cid) {
      cidToThreadId.set(comment.cid, threadId);
    }

    const existing = threadMap.get(threadId);
    if (existing) {
      existing.comments.push({ comment, index: i });
      if (comment.anchorLine < existing.anchorLine) {
        existing.anchorLine = comment.anchorLine;
      }
    } else {
      threadMap.set(threadId, {
        anchorLine: comment.anchorLine,
        comments: [{ comment, index: i }],
      });
    }
  }

  const threads: CommentThread[] = [];
  for (const [threadId, data] of threadMap) {
    data.comments.sort(
      (a, b) => a.comment.anchorLine - b.comment.anchorLine || a.index - b.index,
    );
    threads.push({
      threadId,
      anchorLine: data.anchorLine,
      comments: data.comments.map((c) => c.comment),
    });
  }

  return threads;
}

export interface FormatCommentOptions {
  username: string;
  text: string;
  tid?: string;
  cid?: string;
  replyTo?: string;
  status?: string;
  isReplyTemplate?: boolean;
}

export function formatCommentLine(options: FormatCommentOptions): string {
  const escapedText = escapeCommentText(options.text);

  if (options.isReplyTemplate) {
    let result = `[REPLY_TEMPLATE] @${options.username}`;
    if (options.tid !== undefined) {
      result += `[tid:${options.tid}]`;
    }
    const replyCid = Math.random().toString(36).slice(2, 8);
    result += `[cid:${replyCid}]`;
    if (options.replyTo !== undefined) {
      result += `[reply:${options.replyTo}]`;
    }
    result += ": your response here (use \\n for newlines)";
    return result;
  }

  let result = `@${options.username}`;
  if (options.tid !== undefined) {
    result += `[tid:${options.tid}]`;
  }
  if (options.cid !== undefined) {
    result += `[cid:${options.cid}]`;
  }
  if (options.replyTo !== undefined) {
    result += `[reply:${options.replyTo}]`;
  }
  if (options.status !== undefined) {
    result += `[status:${options.status}]`;
  }
  result += `: ${escapedText}`;
  return result;
}

export function formatCommentBlock(entries: FormatCommentOptions[]): string {
  const innerLines = entries.map((e) => formatCommentLine(e));
  return `<!--\n${innerLines.join("\n")}\n-->\n`;
}
