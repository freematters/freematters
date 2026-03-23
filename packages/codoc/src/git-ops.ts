import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BlameEntry {
  lineStart: number;
  lineEnd: number;
  author: string;
  hash: string;
  isAgent: boolean;
}

export interface LogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface MergeResult {
  content: string;
  conflict: boolean;
}

const AGENT_NAMES = new Set(["claude", "agent", "assistant", "ai", "bot"]);
const GIT_HASH_REGEX = /^[a-f0-9]+$/;

function isAgentAuthor(author: string): boolean {
  return AGENT_NAMES.has(author.toLowerCase());
}

export class GitOps {
  private gitDir: string;
  private workTree: string;

  constructor(gitDir: string, workTree: string) {
    this.gitDir = gitDir;
    this.workTree = workTree;
  }

  getWorkTree(): string {
    return this.workTree;
  }

  private exec(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        ["--git-dir", this.gitDir, "--work-tree", this.workTree, ...args],
        { maxBuffer: 10 * 1024 * 1024 },
        (error: Error | null, stdout: string, stderr: string) => {
          if (error) {
            reject(
              new Error(`git ${args[0]} failed: ${stderr || (error as Error).message}`),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  async init(): Promise<void> {
    if (!fs.existsSync(this.workTree)) {
      fs.mkdirSync(this.workTree, { recursive: true });
    }
    await this.exec(["init"]);
    await this.exec(["config", "user.email", "codoc@local"]);
    await this.exec(["config", "user.name", "codoc"]);
  }

  async commit(filePath: string, message: string, author: string): Promise<string> {
    await this.exec(["add", filePath]);
    const authorStr = `${author} <${author}@codoc.local>`;
    await this.exec([
      "commit",
      "-m",
      message,
      "--author",
      authorStr,
      "--allow-empty-message",
    ]);
    const stdout = await this.exec(["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async blame(filePath: string): Promise<BlameEntry[]> {
    const stdout = await this.exec(["blame", "--porcelain", filePath]);
    return parseBlameOutput(stdout);
  }

  async log(filePath: string, limit: number): Promise<LogEntry[]> {
    const stdout = await this.exec([
      "log",
      `--max-count=${limit}`,
      "--format=%H%n%an%n%aI%n%s%n---END---",
      "--",
      filePath,
    ]);
    return parseLogOutput(stdout);
  }

  async show(hash: string, filePath: string): Promise<string> {
    if (!GIT_HASH_REGEX.test(hash) && hash !== "HEAD") {
      throw new Error("Invalid git hash");
    }
    return this.exec(["show", `${hash}:${filePath}`]);
  }

  async revert(filePath: string, hash: string): Promise<string> {
    const content = await this.show(hash, filePath);
    const fullPath = path.join(this.workTree, filePath);
    fs.writeFileSync(fullPath, content);
    return content;
  }

  async mergeFile(base: string, ours: string, theirs: string): Promise<MergeResult> {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codoc-merge-"));
    const basePath = path.join(tmpDir, "base");
    const oursPath = path.join(tmpDir, "ours");
    const theirsPath = path.join(tmpDir, "theirs");

    try {
      fs.writeFileSync(basePath, base);
      fs.writeFileSync(oursPath, ours);
      fs.writeFileSync(theirsPath, theirs);

      const result = await new Promise<MergeResult>((resolve) => {
        execFile(
          "git",
          ["merge-file", "-p", oursPath, basePath, theirsPath],
          { maxBuffer: 10 * 1024 * 1024 },
          (error: Error | null, stdout: string) => {
            if (error) {
              const exitCode = (error as unknown as { status?: number }).status ?? 1;
              if (exitCode > 0) {
                resolve({ content: stdout, conflict: true });
                return;
              }
            }
            resolve({ content: stdout, conflict: false });
          },
        );
      });
      return result;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  async hashObject(content: string): Promise<string> {
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "git",
        ["--git-dir", this.gitDir, "hash-object", "--stdin"],
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout.trim());
        },
      );
      child.stdin?.write(content);
      child.stdin?.end();
    });
    return result;
  }
}

function parseBlameOutput(output: string): BlameEntry[] {
  const lines = output.split("\n");
  const entries: BlameEntry[] = [];
  let currentHash = "";
  let currentAuthor = "";
  let currentLineStart = 0;
  let currentLineEnd = 0;

  const authorMap = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const headerMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/);
    if (headerMatch) {
      if (currentHash && currentLineStart > 0) {
        pushOrMerge(
          entries,
          currentHash,
          currentAuthor,
          currentLineStart,
          currentLineEnd,
        );
      }
      currentHash = headerMatch[1];
      currentLineStart = Number.parseInt(headerMatch[3], 10);
      const numLines = headerMatch[4] ? Number.parseInt(headerMatch[4], 10) : 1;
      currentLineEnd = currentLineStart + numLines - 1;
      continue;
    }

    const authorMatch = line.match(/^author (.+)$/);
    if (authorMatch) {
      currentAuthor = authorMatch[1];
      authorMap.set(currentHash, currentAuthor);
      continue;
    }

    if (line.startsWith("\t")) {
      continue;
    }
  }

  if (currentHash && currentLineStart > 0) {
    pushOrMerge(entries, currentHash, currentAuthor, currentLineStart, currentLineEnd);
  }

  return entries;
}

function pushOrMerge(
  entries: BlameEntry[],
  hash: string,
  author: string,
  lineStart: number,
  lineEnd: number,
): void {
  const last = entries[entries.length - 1];
  if (
    last &&
    last.hash === hash &&
    last.author === author &&
    last.lineEnd === lineStart - 1
  ) {
    last.lineEnd = lineEnd;
  } else {
    entries.push({
      lineStart,
      lineEnd,
      author,
      hash,
      isAgent: isAgentAuthor(author),
    });
  }
}

function parseLogOutput(output: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const blocks = output.split("---END---\n");

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    if (lines.length < 4) continue;

    entries.push({
      hash: lines[0],
      author: lines[1],
      date: lines[2],
      message: lines.slice(3).join("\n"),
    });
  }

  return entries;
}
