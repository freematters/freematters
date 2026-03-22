import { describe, expect, it } from "vitest";
import {
  type Comment,
  MULTILINE_BLOCK_REGEX,
  escapeCommentText,
  formatCommentBlock,
  formatCommentLine,
  groupThreads,
  parseComments,
} from "../comment-parser.js";

describe("MULTILINE_BLOCK_REGEX", () => {
  it("should match a multi-line block with single comment", () => {
    const input = "<!--\n@alice: hello world\n-->\n";
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
    const match = MULTILINE_BLOCK_REGEX.exec(input);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("@alice: hello world");
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
  });

  it("should match a multi-line block with multiple comments", () => {
    const input =
      "<!--\n@alice[tid:t1][cid:c1]: first\n@bob[tid:t1][cid:c2][reply:c1]: second\n-->\n";
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
    const match = MULTILINE_BLOCK_REGEX.exec(input);
    expect(match).not.toBeNull();
    expect(match?.[1]).toContain("@alice");
    expect(match?.[1]).toContain("@bob");
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
  });

  it("should match block without trailing newline after -->", () => {
    const input = "<!--\n@alice: hello\n-->";
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
    const match = MULTILINE_BLOCK_REGEX.exec(input);
    expect(match).not.toBeNull();
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
  });

  it("should not match non-comment HTML", () => {
    const input = "<div>not a comment</div>\n";
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
    const match = MULTILINE_BLOCK_REGEX.exec(input);
    expect(match).toBeNull();
    MULTILINE_BLOCK_REGEX.lastIndex = 0;
  });
});

describe("parseComments", () => {
  it("should parse a single comment", () => {
    const content = "# Title\n<!--\n@alice[tid:t1][cid:c1]: hello\n-->\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe("alice");
    expect(comments[0].text).toBe("hello");
    expect(comments[0].tid).toBe("t1");
    expect(comments[0].cid).toBe("c1");
    expect(comments[0].anchorLine).toBe(0);
  });

  it("should parse multiple comments in separate blocks", () => {
    const content = `${[
      "# Title",
      "<!--",
      "@alice[tid:t1][cid:c1]: first",
      "-->",
      "<!--",
      "@bob[tid:t1][cid:c2][reply:c1]: second",
      "-->",
      "## Section",
      "<!--",
      "@alice[cid:c3]: third",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(3);
    expect(comments[0].username).toBe("alice");
    expect(comments[1].username).toBe("bob");
    expect(comments[1].replyTo).toBe("c1");
    expect(comments[2].username).toBe("alice");
  });

  it("should parse multiple comments in a single block", () => {
    const content = `${[
      "# Title",
      "<!--",
      "@alice[tid:t1][cid:c1]: first",
      "@bob[tid:t1][cid:c2][reply:c1]: second",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(2);
    expect(comments[0].username).toBe("alice");
    expect(comments[0].text).toBe("first");
    expect(comments[1].username).toBe("bob");
    expect(comments[1].replyTo).toBe("c1");
  });

  it("should compute anchorLine as the first non-comment line above", () => {
    const content = `${[
      "Line 0 content",
      "Line 1 content",
      "<!--",
      "@alice: comment on line 1",
      "@bob: also on line 1",
      "-->",
      "Line 6 content",
      "<!--",
      "@charlie: comment on line 6",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(3);
    expect(comments[0].anchorLine).toBe(1);
    expect(comments[1].anchorLine).toBe(1);
    expect(comments[2].anchorLine).toBe(6);
  });

  it("should handle empty text", () => {
    const content = "# Title\n<!--\n@alice: \n-->\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("");
  });

  it("should handle escaped --> in body", () => {
    const content = "# Title\n<!--\n@alice: use \\-\\-\\> to close\n-->\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("use --> to close");
  });

  it("should handle special characters in text", () => {
    const content = '# Title\n<!--\n@alice: <b>bold</b> & "quotes"\n-->\n';
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('<b>bold</b> & "quotes"');
  });

  it("should skip reply templates", () => {
    const content = `${[
      "# Title",
      "<!--",
      "@alice[tid:t1][cid:c1]: question",
      "[REPLY_TEMPLATE] @agent[tid:t1][cid:NEW_ID][reply:c1]: reply here",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe("alice");
  });

  it("should handle comment at the very start of document (anchorLine 0)", () => {
    const content = "<!--\n@alice: first line comment\n-->\nSome content\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].anchorLine).toBe(0);
  });

  it("should handle status field", () => {
    const content = "# Title\n<!--\n@alice[status:wontfix]: not doing this\n-->\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].status).toBe("wontfix");
  });

  it("should return empty array for content with no comments", () => {
    const content = "# Title\n\nJust regular markdown.\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(0);
  });

  it("should handle escaped newlines in comment text", () => {
    const content = "# Title\n<!--\n@alice: line1\\nline2\n-->\n";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("line1\nline2");
  });

  it("should parse thread with reply in block", () => {
    const content = `${[
      "Line 0 content",
      "<!--",
      "@alice[tid:t1][cid:c1]: question",
      "@bob[tid:t1][cid:c2][reply:c1]: answer",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(2);
    expect(comments[0].tid).toBe("t1");
    expect(comments[1].tid).toBe("t1");
    expect(comments[1].replyTo).toBe("c1");
    expect(comments[0].anchorLine).toBe(0);
    expect(comments[1].anchorLine).toBe(0);
  });

  it("should handle block at end of document without trailing newline after -->", () => {
    const content = "# Title\n<!--\n@alice[cid:c1]: last\n-->";
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].username).toBe("alice");
    expect(comments[0].text).toBe("last");
  });

  it("should handle comment with all fields in block", () => {
    const content = `${[
      "# Title",
      "<!--",
      "@alice[tid:t1][cid:c1][reply:c0][status:resolved]: done",
      "-->",
    ].join("\n")}\n`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(1);
    expect(comments[0].tid).toBe("t1");
    expect(comments[0].cid).toBe("c1");
    expect(comments[0].replyTo).toBe("c0");
    expect(comments[0].status).toBe("resolved");
    expect(comments[0].text).toBe("done");
  });

  it("should round-trip: formatCommentBlock then parseComments recovers all fields", () => {
    const block = formatCommentBlock([
      { username: "alice", text: "hello world", tid: "t1", cid: "c1" },
      { username: "bob", text: "reply", tid: "t1", cid: "c2", replyTo: "c1" },
    ]);
    const content = `# Title\n${block}`;
    const comments = parseComments(content);
    expect(comments).toHaveLength(2);
    expect(comments[0].username).toBe("alice");
    expect(comments[0].text).toBe("hello world");
    expect(comments[0].tid).toBe("t1");
    expect(comments[0].cid).toBe("c1");
    expect(comments[1].username).toBe("bob");
    expect(comments[1].replyTo).toBe("c1");
  });
});

describe("formatCommentBlock", () => {
  it("should format a single entry", () => {
    const result = formatCommentBlock([
      { username: "alice", text: "hello", cid: "c1" },
    ]);
    expect(result).toBe("<!--\n@alice[cid:c1]: hello\n-->\n");
  });

  it("should format multiple entries (comment + reply template)", () => {
    const result = formatCommentBlock([
      { username: "alice", text: "question", tid: "t1", cid: "c1" },
      {
        username: "agent",
        text: "reply here",
        tid: "t1",
        cid: "c2",
        replyTo: "c1",
        isReplyTemplate: true,
      },
    ]);
    expect(result).toContain("<!--\n");
    expect(result).toContain("@alice[tid:t1][cid:c1]: question");
    expect(result).toContain("[REPLY_TEMPLATE] @agent[tid:t1][cid:");
    expect(result).toContain("[reply:c1]: your response here");
    expect(result).toContain("\n-->\n");
  });

  it("should format entries with markdown in text", () => {
    const result = formatCommentBlock([
      { username: "alice", text: "use `code` and [link](url)", cid: "c1" },
    ]);
    expect(result).toBe("<!--\n@alice[cid:c1]: use `code` and [link](url)\n-->\n");
  });

  it("should escape --> in text", () => {
    const result = formatCommentBlock([
      { username: "alice", text: "use --> to close", cid: "c1" },
    ]);
    expect(result).toContain("\\-\\-\\>");
    expect(result).not.toMatch(/@alice.*: .*-->/);
  });

  it("should escape newlines in text", () => {
    const result = formatCommentBlock([
      { username: "alice", text: "line1\nline2", cid: "c1" },
    ]);
    expect(result).toContain("line1\\nline2");
  });
});

describe("formatCommentLine", () => {
  it("should return inner line without <!-- --> wrapping", () => {
    const result = formatCommentLine({
      username: "alice",
      text: "hello",
      cid: "c1",
    });
    expect(result).toBe("@alice[cid:c1]: hello");
    expect(result).not.toContain("<!--");
    expect(result).not.toContain("-->");
  });

  it("should include all fields", () => {
    const result = formatCommentLine({
      username: "alice",
      text: "hello",
      tid: "t1",
      cid: "c1",
      replyTo: "c0",
      status: "resolved",
    });
    expect(result).toBe("@alice[tid:t1][cid:c1][reply:c0][status:resolved]: hello");
  });

  it("should format reply template line", () => {
    const result = formatCommentLine({
      username: "agent",
      text: "reply here",
      tid: "t1",
      replyTo: "c1",
      isReplyTemplate: true,
    });
    expect(result).toContain("[REPLY_TEMPLATE] @agent");
    expect(result).toMatch(/\[cid:\w{6}\]/);
    expect(result).toContain("[reply:c1]");
    expect(result).not.toContain("<!--");
  });
});

describe("groupThreads", () => {
  it("should group comments by tid", () => {
    const comments: Comment[] = [
      { username: "alice", text: "q1", tid: "t1", cid: "c1", anchorLine: 1 },
      {
        username: "bob",
        text: "a1",
        tid: "t1",
        cid: "c2",
        replyTo: "c1",
        anchorLine: 1,
      },
      { username: "charlie", text: "standalone", cid: "c3", anchorLine: 5 },
    ];
    const threads = groupThreads(comments);
    expect(threads).toHaveLength(2);

    const t1 = threads.find((t) => t.threadId === "t1");
    expect(t1).toBeDefined();
    expect(t1?.comments).toHaveLength(2);
    expect(t1?.anchorLine).toBe(1);
  });

  it("should create single-comment threads for comments without tid", () => {
    const comments: Comment[] = [
      { username: "alice", text: "standalone", cid: "c1", anchorLine: 3 },
    ];
    const threads = groupThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].threadId).toBe("c1");
    expect(threads[0].comments).toHaveLength(1);
  });

  it("should order comments within a thread by their original file position", () => {
    const comments: Comment[] = [
      {
        username: "bob",
        text: "reply",
        tid: "t1",
        cid: "c2",
        replyTo: "c1",
        anchorLine: 3,
      },
      { username: "alice", text: "question", tid: "t1", cid: "c1", anchorLine: 2 },
    ];
    const threads = groupThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments[0].cid).toBe("c1");
    expect(threads[0].comments[1].cid).toBe("c2");
  });

  it("should use earliest anchorLine for thread", () => {
    const comments: Comment[] = [
      { username: "alice", text: "q", tid: "t1", cid: "c1", anchorLine: 5 },
      {
        username: "bob",
        text: "a",
        tid: "t1",
        cid: "c2",
        replyTo: "c1",
        anchorLine: 3,
      },
    ];
    const threads = groupThreads(comments);
    expect(threads[0].anchorLine).toBe(3);
  });

  it("should return empty array for empty input", () => {
    const threads = groupThreads([]);
    expect(threads).toHaveLength(0);
  });

  it("should generate threadId for comments without tid or cid", () => {
    const comments: Comment[] = [{ username: "alice", text: "no ids", anchorLine: 1 }];
    const threads = groupThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].threadId).toBeTruthy();
  });
});

describe("escapeCommentText", () => {
  it("should escape --> sequence", () => {
    const result = escapeCommentText("use --> to close");
    expect(result).toBe("use \\-\\-\\> to close");
    expect(result).not.toContain("-->");
  });

  it("should escape newlines", () => {
    const result = escapeCommentText("line1\nline2");
    expect(result).toBe("line1\\nline2");
  });

  it("should handle text with no dangerous sequences", () => {
    const result = escapeCommentText("safe text here");
    expect(result).toBe("safe text here");
  });

  it("should handle empty string", () => {
    const result = escapeCommentText("");
    expect(result).toBe("");
  });

  it("should handle multiple --> sequences", () => {
    const result = escapeCommentText("a --> b --> c");
    expect(result).not.toContain("-->");
  });

  it("should escape carriage return + newline", () => {
    const result = escapeCommentText("line1\r\nline2");
    expect(result).toBe("line1\\nline2");
  });
});
