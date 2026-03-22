import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parseComments } from "../comment-parser.js";
import { computeDiff } from "../diff.js";
import { TokenStore } from "../token-store.js";

export interface SessionState {
  watchedTokens: string[];
  baselines: Record<string, { mtime: number; contentHash: string; content: string }>;
  lastCheckAt: number;
}

export interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

const RATE_LIMIT_MS = 10000;

function computeHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export async function handlePostToolUse(
  sessionId: string,
  sessionsDir: string,
  tokensPath: string,
): Promise<HookOutput | null> {
  const sessionFile = path.join(sessionsDir, `${sessionId}.json`);

  let state: SessionState;
  try {
    state = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
  } catch {
    let tokenStore: TokenStore;
    try {
      tokenStore = new TokenStore(tokensPath);
    } catch {
      return null;
    }
    const allTokens = tokenStore.list();
    if (allTokens.length === 0) {
      return null;
    }
    const baselines: Record<
      string,
      { mtime: number; contentHash: string; content: string }
    > = {};
    for (const entry of allTokens) {
      try {
        const content = fs.readFileSync(entry.filePath, "utf-8");
        const fileStat = fs.statSync(entry.filePath);
        baselines[entry.token] = {
          mtime: fileStat.mtimeMs,
          contentHash: computeHash(content),
          content,
        };
      } catch {}
    }
    state = {
      watchedTokens: allTokens.map((e) => e.token),
      baselines,
      lastCheckAt: 0,
    };
    const dir = path.dirname(sessionFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(sessionFile, JSON.stringify(state, null, 2));
  }

  if (state.watchedTokens.length === 0) {
    return null;
  }

  const now = Date.now();
  if (now - state.lastCheckAt < RATE_LIMIT_MS) {
    return null;
  }

  let tokenStore: TokenStore;
  try {
    tokenStore = new TokenStore(tokensPath);
  } catch {
    return null;
  }

  const changes: string[] = [];

  for (const token of state.watchedTokens) {
    const entry = tokenStore.resolve(token);
    if (!entry) continue;

    let fileStat: fs.Stats;
    try {
      fileStat = fs.statSync(entry.filePath);
    } catch {
      continue;
    }

    const baseline = state.baselines[token];
    if (baseline && fileStat.mtimeMs === baseline.mtime) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(entry.filePath, "utf-8");
    } catch {
      continue;
    }

    const newHash = computeHash(content);
    if (baseline && newHash === baseline.contentHash) {
      state.baselines[token] = {
        mtime: fileStat.mtimeMs,
        contentHash: newHash,
        content,
      };
      continue;
    }

    const oldContent = baseline ? baseline.content : "";

    const diff = computeDiff(oldContent, content);
    if (diff) {
      const newComments = parseComments(content);
      const commentSummary =
        newComments.length > 0 ? `\n${newComments.length} comment(s) found.` : "";
      changes.push(`[codoc] File changed: ${entry.filePath}\n${diff}${commentSummary}`);
    }

    state.baselines[token] = {
      mtime: fileStat.mtimeMs,
      contentHash: newHash,
      content,
    };
  }

  state.lastCheckAt = now;
  fs.writeFileSync(sessionFile, JSON.stringify(state, null, 2));

  if (changes.length === 0) {
    return null;
  }

  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: changes.join("\n\n"),
    },
  };
}
