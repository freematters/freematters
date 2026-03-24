import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitOps } from "../git-ops.js";
import type { BlameEntry, LogEntry } from "../git-ops.js";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "codoc-git-test-"));
}

function cleanDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

describe("GitOps", () => {
  let gitDir: string;
  let workTree: string;
  let git: GitOps;

  beforeEach(() => {
    const base = makeTempDir();
    gitDir = path.join(base, ".git");
    workTree = base;
    git = new GitOps(gitDir, workTree);
  });

  afterEach(() => {
    cleanDir(workTree);
  });

  describe("init()", () => {
    it("should create a git repo", async () => {
      await git.init();
      expect(fs.existsSync(gitDir)).toBe(true);
      expect(fs.existsSync(path.join(gitDir, "HEAD"))).toBe(true);
    });
  });

  describe("commit()", () => {
    it("should create a commit with correct author and return hash", async () => {
      await git.init();
      const filePath = "doc.md";
      fs.writeFileSync(path.join(workTree, filePath), "# Hello\n");
      const hash = await git.commit(filePath, "initial commit", "alice");
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should create commits with different authors", async () => {
      await git.init();
      const filePath = "doc.md";
      fs.writeFileSync(path.join(workTree, filePath), "# Hello\n");
      const hash1 = await git.commit(filePath, "first", "alice");

      fs.writeFileSync(path.join(workTree, filePath), "# Hello\nLine 2\n");
      const hash2 = await git.commit(filePath, "second", "bob");

      expect(hash1).not.toBe(hash2);
      const entries = await git.log(filePath, 10);
      expect(entries.length).toBe(2);
      expect(entries[0].author).toBe("bob");
      expect(entries[1].author).toBe("alice");
    });
  });

  describe("blame()", () => {
    it("should return per-line authorship", async () => {
      await git.init();
      const filePath = "doc.md";
      fs.writeFileSync(path.join(workTree, filePath), "Line 1\n");
      await git.commit(filePath, "first", "alice");

      fs.writeFileSync(path.join(workTree, filePath), "Line 1\nLine 2\n");
      await git.commit(filePath, "second", "bob");

      const blame = await git.blame(filePath);
      expect(blame.length).toBeGreaterThanOrEqual(2);

      const line1Entry = blame.find((e: BlameEntry) => e.lineStart === 1);
      expect(line1Entry).toBeDefined();
      expect(line1Entry?.author).toBe("alice");

      const line2Entry = blame.find((e: BlameEntry) => e.lineStart === 2);
      expect(line2Entry).toBeDefined();
      expect(line2Entry?.author).toBe("bob");
    });

    it("should set isAgent flag for agent authors", async () => {
      await git.init();
      const filePath = "doc.md";
      fs.writeFileSync(path.join(workTree, filePath), "Line 1\n");
      await git.commit(filePath, "first", "claude");

      const blame = await git.blame(filePath);
      const entry = blame.find((e: BlameEntry) => e.lineStart === 1);
      expect(entry).toBeDefined();
      expect(entry?.isAgent).toBe(true);
    });
  });

  describe("log()", () => {
    it("should return version list in reverse chronological order", async () => {
      await git.init();
      const filePath = "doc.md";

      fs.writeFileSync(path.join(workTree, filePath), "v1\n");
      await git.commit(filePath, "first", "alice");

      fs.writeFileSync(path.join(workTree, filePath), "v2\n");
      await git.commit(filePath, "second", "bob");

      fs.writeFileSync(path.join(workTree, filePath), "v3\n");
      await git.commit(filePath, "third", "alice");

      const entries = await git.log(filePath, 10);
      expect(entries.length).toBe(3);
      expect(entries[0].message).toBe("third");
      expect(entries[1].message).toBe("second");
      expect(entries[2].message).toBe("first");
    });

    it("should respect limit parameter", async () => {
      await git.init();
      const filePath = "doc.md";

      fs.writeFileSync(path.join(workTree, filePath), "v1\n");
      await git.commit(filePath, "first", "alice");

      fs.writeFileSync(path.join(workTree, filePath), "v2\n");
      await git.commit(filePath, "second", "bob");

      fs.writeFileSync(path.join(workTree, filePath), "v3\n");
      await git.commit(filePath, "third", "alice");

      const entries = await git.log(filePath, 2);
      expect(entries.length).toBe(2);
    });

    it("should return LogEntry with required fields", async () => {
      await git.init();
      const filePath = "doc.md";
      fs.writeFileSync(path.join(workTree, filePath), "content\n");
      await git.commit(filePath, "test commit", "alice");

      const entries = await git.log(filePath, 10);
      expect(entries.length).toBe(1);
      const entry: LogEntry = entries[0];
      expect(entry.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.author).toBe("alice");
      expect(entry.date).toBeTruthy();
      expect(entry.message).toBe("test commit");
    });
  });

  describe("show()", () => {
    it("should return file content at specific commit", async () => {
      await git.init();
      const filePath = "doc.md";

      fs.writeFileSync(path.join(workTree, filePath), "version 1\n");
      const hash1 = await git.commit(filePath, "first", "alice");

      fs.writeFileSync(path.join(workTree, filePath), "version 2\n");
      await git.commit(filePath, "second", "bob");

      const content = await git.show(hash1, filePath);
      expect(content).toBe("version 1\n");
    });
  });

  describe("mergeFile()", () => {
    it("should merge non-conflicting concurrent edits cleanly", async () => {
      const base = "Line 1\nLine 2\nLine 3\n";
      const ours = "Line 1 modified\nLine 2\nLine 3\n";
      const theirs = "Line 1\nLine 2\nLine 3 modified\n";

      await git.init();
      const result = await git.mergeFile(base, ours, theirs);
      expect(result.conflict).toBe(false);
      expect(result.content).toContain("Line 1 modified");
      expect(result.content).toContain("Line 3 modified");
    });

    it("should return conflict when concurrent edits overlap", async () => {
      const base = "Line 1\nLine 2\nLine 3\n";
      const ours = "Line 1 OURS\nLine 2\nLine 3\n";
      const theirs = "Line 1 THEIRS\nLine 2\nLine 3\n";

      await git.init();
      const result = await git.mergeFile(base, ours, theirs);
      expect(result.conflict).toBe(true);
      expect(result.content).toContain("<<<<<<<");
      expect(result.content).toContain(">>>>>>>");
    });
  });

  describe("hashObject()", () => {
    it("should return consistent hash for same content", async () => {
      await git.init();
      const hash1 = await git.hashObject("hello world");
      const hash2 = await git.hashObject("hello world");
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{40}$/);
    });

    it("should return different hash for different content", async () => {
      await git.init();
      const hash1 = await git.hashObject("hello");
      const hash2 = await git.hashObject("world");
      expect(hash1).not.toBe(hash2);
    });
  });
});
