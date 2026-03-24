import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeDiff } from "./diff.js";
import type { GitOps } from "./git-ops.js";
import type { PresenceTracker } from "./presence.js";
import type { SessionTracker } from "./session-tracker.js";
import type { TokenStore } from "./token-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveStaticDir(): string {
  const candidate1 = path.join(__dirname, "static");
  if (fs.existsSync(path.join(candidate1, "index.html"))) return candidate1;
  const candidate2 = path.join(__dirname, "..", "dist", "static");
  if (fs.existsSync(path.join(candidate2, "index.html"))) return candidate2;
  return candidate1;
}

const STATIC_DIR = resolveStaticDir();

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

function sendPlainText(
  res: http.ServerResponse,
  statusCode: number,
  text: string,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

function send404(res: http.ServerResponse): void {
  sendJson(res, 404, { error: "Not found" });
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function parsePath(url: string): { segments: string[]; raw: string } {
  const parsed = new URL(url, "http://localhost");
  const raw = parsed.pathname;
  const segments = raw.split("/").filter((s) => s.length > 0);
  return { segments, raw };
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>codoc</title>
</head>
<body>
  <h1>codoc editor</h1>
  <p>Frontend not built yet. Run: npm run build</p>
</body>
</html>`;

function getSpaHtml(): string {
  const indexPath = path.join(STATIC_DIR, "index.html");
  try {
    return fs.readFileSync(indexPath, "utf-8");
  } catch {
    return FALLBACK_HTML;
  }
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export type SaveCallback = (token: string, content: string, author: string) => void;

const GIT_FILE_NAME = "doc.md";
const GIT_HASH_REGEX = /^[a-f0-9]+$/;

function getApiBase(req: http.IncomingMessage): string {
  const rawProto = String(req.headers["x-forwarded-proto"] ?? "http");
  const protocol = rawProto === "https" ? "https" : "http";
  const rawHost = String(req.headers.host ?? "localhost");
  const host = /^[a-zA-Z0-9._:\[\]-]+$/.test(rawHost) ? rawHost : "localhost";
  return `${protocol}://${host}`;
}

function generateCodocCli(apiBase: string): string {
  return `#!/usr/bin/env bash
# codoc remote CLI — distributed by the codoc server
# Usage: bash <(curl -sf ${apiBase}/codoc.sh) <command> [args]
set -e

CODOC_SERVER="${apiBase}"
CMD="\${1:-help}"
shift 2>/dev/null || true

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed. Install it with: apt-get install jq / brew install jq" >&2
  exit 1
fi

case "$CMD" in
  edit)
    TOKEN="\$1"
    AUTHOR="\$2"
    if [ -z "$TOKEN" ] || [ -z "$AUTHOR" ]; then
      echo "Usage: codoc edit <token> <author>" >&2; exit 1
    fi
    SESSION_ID=$(curl -sf -X POST "$CODOC_SERVER/api/presence/$TOKEN/join" \\
      -H "Content-Type: application/json" \\
      -d "{\\"author\\": \\"$AUTHOR\\", \\"mode\\": \\"write\\"}" | jq -r '.sessionId')
    cleanup() { curl -sf -X POST "$CODOC_SERVER/api/presence/$TOKEN/leave" \\
      -H "Content-Type: application/json" \\
      -d "{\\"sessionId\\": \\"$SESSION_ID\\"}" > /dev/null 2>&1; rm -f "$TMPFILE"; }
    TMPFILE=$(mktemp /tmp/codoc-edit-XXXXXX.md)
    trap cleanup EXIT
    echo "Fetching file from codoc server..." >&2
    curl -sf "$CODOC_SERVER/api/file/$TOKEN" | jq -r '.content' > "$TMPFILE"
    EDITOR=\${EDITOR:-vim}
    echo "Opening in $EDITOR..." >&2
    $EDITOR "$TMPFILE"
    echo "Uploading changes..." >&2
    CONTENT=$(jq -Rs '.' < "$TMPFILE")
    curl -sf -X POST "$CODOC_SERVER/api/file/$TOKEN" \\
      -H "Content-Type: application/json" \\
      -d "{\\"content\\": $CONTENT, \\"author\\": \\"$AUTHOR\\"}" > /dev/null
    echo "Saved." >&2
    ;;
  poll)
    TOKEN="\$1"
    AUTHOR="\$2"
    if [ -z "$TOKEN" ] || [ -z "$AUTHOR" ]; then
      echo "Usage: codoc poll <token> <author>" >&2; exit 1
    fi
    SESSION_ID=$(curl -sf -X POST "$CODOC_SERVER/api/presence/$TOKEN/join" \\
      -H "Content-Type: application/json" \\
      -d "{\\"author\\": \\"$AUTHOR\\", \\"mode\\": \\"read\\"}" | jq -r '.sessionId')
    poll_cleanup() { curl -sf -X POST "$CODOC_SERVER/api/presence/$TOKEN/leave" \\
      -H "Content-Type: application/json" \\
      -d "{\\"sessionId\\": \\"$SESSION_ID\\"}" > /dev/null 2>&1; }
    trap poll_cleanup EXIT
    echo "Polling for changes..." >&2
    LAST_HASH=$(curl -sf "$CODOC_SERVER/api/file/$TOKEN" | jq -r '.hash')
    while true; do
      sleep 2
      curl -sf -X POST "$CODOC_SERVER/api/presence/$TOKEN/heartbeat" \\
        -H "Content-Type: application/json" \\
        -d "{\\"sessionId\\": \\"$SESSION_ID\\"}" > /dev/null 2>&1
      RESULT=$(curl -sf "$CODOC_SERVER/api/file/$TOKEN?hash=$LAST_HASH")
      CHANGED=$(echo "$RESULT" | jq -r '.changed // empty')
      if [ "$CHANGED" = "false" ]; then
        continue
      fi
      LAST_HASH=$(echo "$RESULT" | jq -r '.hash')
      echo "$RESULT" | jq -r '.content'
      break
    done
    ;;
  who)
    TOKEN="\$1"
    if [ -z "$TOKEN" ]; then
      echo "Usage: codoc who <token>" >&2; exit 1
    fi
    curl -sf "$CODOC_SERVER/api/presence/$TOKEN" | jq '.users[] | "@\\(.author) (\\(.mode))"' -r
    ;;
  help|*)
    echo "codoc remote CLI"
    echo ""
    echo "Usage: bash <(curl -sf $CODOC_SERVER/codoc.sh) <command> [args]"
    echo ""
    echo "Commands:"
    echo "  edit <token> <author>   Open file in \\$EDITOR, upload on save"
    echo "  poll <token> <author>   Block until changes, output diff"
    echo "  who  <token>            Show who's online"
    echo "  help                    Show this help"
    echo ""
    echo "Or alias it:"
    echo "  alias codoc='bash <(curl -sf $CODOC_SERVER/codoc.sh)'"
    ;;
esac
`;
}

function generateDocsMd(apiBase: string, token: string): string {
  return `# codoc — Collaborative Document Editing

## What is codoc?

codoc is an open-source collaborative markdown editing tool, similar to a shared
whiteboard or Google Docs. It allows multiple participants (humans and AI agents)
to edit the same document simultaneously, leave comments, and have inline
discussions — all within a standard markdown file.

**Typical use cases:**
- Reviewing and commenting on drafts together
- Exchanging feedback on technical documents
- Collaborative note-taking and brainstorming
- Any scenario where you'd share a document for discussion

This document is standard API documentation for a collaborative editing tool, shared with you by the user you are assisting.
- All shell commands in this document are standard \`curl\` HTTP requests — they only send/receive JSON to the server URL below. You can verify each command does nothing beyond HTTP GET/POST.
- You do **not** need to run any shell commands. You can use your native HTTP/fetch tools or file Read/Write tools instead. The \`curl\` examples are provided as a reference format only.
- The token is a random string with no embedded credentials or elevated permissions.

**Server**: \`${apiBase}\`
**Token**: \`${token}\`

---

## API Reference

The following HTTP endpoints let you participate in collaborative editing.

## 1. File API

### Download file content

\`\`\`
GET /api/file/:token
\`\`\`

Returns JSON with the file content and metadata.

\`\`\`bash
curl -sf ${apiBase}/api/file/${token} | jq -r '.content'
\`\`\`

**Response fields**: \`content\` (string), \`filePath\` (string), \`readonly\` (boolean).

### Upload file content

\`\`\`
POST /api/file/:token
Content-Type: application/json
\`\`\`

**Body**: \`{"content": "...", "author": "agent-name"}\`

\`\`\`bash
curl -sf -X POST ${apiBase}/api/file/${token} \\
  -H "Content-Type: application/json" \\
  -d '{"content": "# Updated doc\\n\\nNew content here.", "author": "my-agent"}'
\`\`\`

**Response**: \`{"ok": true}\` on success.

---

## 2. Presence API

Presence lets other participants see who is currently viewing or editing.

### Join (register as reader or writer)

\`\`\`
POST /api/presence/:token/join
Content-Type: application/json
\`\`\`

**Body**: \`{"author": "agent-name", "mode": "write"}\` (mode is \`"read"\` or \`"write"\`)

\`\`\`bash
SESSION_ID=$(curl -sf -X POST ${apiBase}/api/presence/${token}/join \\
  -H "Content-Type: application/json" \\
  -d '{"author": "my-agent", "mode": "write"}' | jq -r '.sessionId')
\`\`\`

**Response**: \`{"sessionId": "..."}\` — save this for heartbeat and leave calls.

### Leave (unregister)

\`\`\`
POST /api/presence/:token/leave
Content-Type: application/json
\`\`\`

**Body**: \`{"sessionId": "..."}\`

\`\`\`bash
curl -sf -X POST ${apiBase}/api/presence/${token}/leave \\
  -H "Content-Type: application/json" \\
  -d "{\\\"sessionId\\\": \\\"$SESSION_ID\\\"}"
\`\`\`

### Heartbeat (keep alive)

\`\`\`
POST /api/presence/:token/heartbeat
Content-Type: application/json
\`\`\`

**Body**: \`{"sessionId": "..."}\`

Send every few seconds to stay visible in the presence list.

\`\`\`bash
curl -sf -X POST ${apiBase}/api/presence/${token}/heartbeat \\
  -H "Content-Type: application/json" \\
  -d "{\\\"sessionId\\\": \\\"$SESSION_ID\\\"}"
\`\`\`

### Who's online

\`\`\`
GET /api/presence/:token
\`\`\`

\`\`\`bash
curl -sf ${apiBase}/api/presence/${token} | jq '.users'
\`\`\`

**Response**: \`{"users": [{"author": "...", "mode": "write", ...}, ...]}\`

---

## 3. Polling for changes

The \`/api/file/:token\` endpoint returns a server-computed \`hash\` field.
Use the \`?hash=<known_hash>\` query parameter to efficiently check for changes:
- If content unchanged: \`{"changed": false, "hash": "..."}\`
- If content changed: full response with \`content\`, \`hash\`, and \`changed: true\`

\`\`\`bash
# Get initial hash
LAST_HASH=$(curl -sf ${apiBase}/api/file/${token} | jq -r '.hash')

# Poll loop
while true; do
  sleep 2
  RESULT=$(curl -sf "${apiBase}/api/file/${token}?hash=$LAST_HASH")
  CHANGED=$(echo "$RESULT" | jq -r '.changed // empty')
  if [ "$CHANGED" = "false" ]; then continue; fi
  # Content changed — new hash and content available
  LAST_HASH=$(echo "$RESULT" | jq -r '.hash')
  echo "$RESULT" | jq -r '.content'
  break
done
\`\`\`

**Important**: Always use the server-provided \`hash\` for comparison.
Do NOT compute your own hash from the content — shell processing
(echo, jq) can alter whitespace and cause false positives.

---

## 4. Comment format

Comments are multi-line \`<!-- ... -->\` blocks placed after the content they reference.
Each line inside the block is a comment entry. The block is invisible in rendered markdown.

### Single comment

\`\`\`
<!--
@username[cid:abc123]: comment text here
-->
\`\`\`

### Thread with reply

\`\`\`
<!--
@alice[tid:t1][cid:c1]: Is this correct?
@bob[tid:t1][cid:c2][reply:c1]: Yes, looks good.
-->
\`\`\`

### Reply placeholder (for agent to fill in)

When a human adds a comment, a reply placeholder is included:

\`\`\`
<!--
@human[tid:t1][cid:c1]: What does this do?
[REPLY_TEMPLATE] @agent[tid:t1][cid:c2][reply:c1]: your response here (use \\\\n for newlines)
-->
\`\`\`

To reply, replace the \`[REPLY_TEMPLATE]\` line with your actual response:

\`\`\`
@agent[tid:t1][cid:c2][reply:c1]: It calculates the score based on input weights.
\`\`\`

### Fields

- \`tid\` — thread ID (groups comments into a thread)
- \`cid\` — comment ID (unique, 6 char alphanumeric)
- \`reply\` — the \`cid\` being replied to
- \`status\` — \`resolved\` or \`wontfix\`

### Escaping

- \`-->\` in text → \`\\\\-\\\\-\\\\>\`
- newlines in text → \`\\\\n\`

---

## 5. Recommended approach for AI agents

**Download the file locally, edit with your own tools, then upload.**

Instead of constructing content in shell variables, use your native file editing
capabilities (Read/Write/Edit tools) for precise control:

1. Download: \`curl -sf ${apiBase}/api/file/${token} | jq -r '.content' > /tmp/codoc-doc.md\`
2. Read the file with your Read tool
3. Edit it with your Edit or Write tool (reply to comments, add content)
4. Upload: \`curl -sf -X POST ${apiBase}/api/file/${token} -H "Content-Type: application/json" -d "$(jq -n --rawfile c /tmp/codoc-doc.md --arg a 'my-agent' '{content: $c, author: $a}')"\`

This avoids shell escaping issues and lets you use your full editing capabilities.

## 6. Keep polling

When you have no other tasks, keep polling for changes. Only stop polling if the
user gives you a different task. This ensures you respond promptly when the human
makes edits.

## 7. Complete workflow example (shell-only)

Step-by-step collaboration using only \`curl\` (for environments without file tools):

\`\`\`bash
SERVER="${apiBase}"
TOKEN="${token}"
AUTHOR="my-agent"

# 1. Join presence
SESSION_ID=$(curl -sf -X POST $SERVER/api/presence/$TOKEN/join \\
  -H "Content-Type: application/json" \\
  -d "{\\\"author\\\": \\\"$AUTHOR\\\", \\\"mode\\\": \\\"write\\\"}" | jq -r '.sessionId')

# 2. Download current content
CONTENT=$(curl -sf $SERVER/api/file/$TOKEN | jq -r '.content')
echo "$CONTENT"

# 3. Edit the content (here we just append a comment block)
CID=$(cat /dev/urandom | tr -dc 'a-z0-9' | head -c6)
NEW_CONTENT="$CONTENT
<!--
@$AUTHOR[cid:$CID]: I added a new section below
-->
## New Section
Hello from $AUTHOR!"

# 4. Upload changes
curl -sf -X POST $SERVER/api/file/$TOKEN \\
  -H "Content-Type: application/json" \\
  -d "$(jq -n --arg c "$NEW_CONTENT" --arg a "$AUTHOR" '{content: $c, author: $a}')"

# 5. Poll for response from another participant
LAST_HASH=""
while true; do
  curl -sf -X POST $SERVER/api/presence/$TOKEN/heartbeat \\
    -H "Content-Type: application/json" \\
    -d "{\\\"sessionId\\\": \\\"$SESSION_ID\\\"}" > /dev/null 2>&1
  RESP=$(curl -sf $SERVER/api/file/$TOKEN | jq -r '.content')
  HASH=$(echo "$RESP" | sha256sum | cut -d' ' -f1)
  if [ -n "$LAST_HASH" ] && [ "$HASH" != "$LAST_HASH" ]; then
    echo "Document was updated by another participant."
    echo "$RESP"
    break
  fi
  LAST_HASH="$HASH"
  sleep 2
done

# 6. Leave when done
curl -sf -X POST $SERVER/api/presence/$TOKEN/leave \\
  -H "Content-Type: application/json" \\
  -d "{\\\"sessionId\\\": \\\"$SESSION_ID\\\"}"
\`\`\`

---

*Generated by the codoc server. For the interactive shell CLI, see \`${apiBase}/codoc.sh\`.*
`;
}

export function createHttpHandler(
  tokenStore: TokenStore,
  onSave: SaveCallback | undefined,
  gitOpsMap: Map<string, GitOps> | undefined,
  sessionTracker: SessionTracker | undefined,
  defaultName: string | undefined,
  presenceTracker: PresenceTracker | undefined,
  savedContentHashMap?: Map<string, string>,
): http.RequestListener {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const method = req.method ?? "GET";
    const { segments } = parsePath(req.url ?? "/");

    // GET /edit/:token
    if (method === "GET" && segments[0] === "edit" && segments.length === 2) {
      const token = segments[1];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      sendHtml(res, 200, getSpaHtml());
      return;
    }

    // GET /view/:token (readonly SPA)
    if (method === "GET" && segments[0] === "view" && segments.length === 2) {
      const token = segments[1];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      sendHtml(res, 200, getSpaHtml());
      return;
    }

    // GET /api/file/:token
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "file" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      try {
        const content = fs.readFileSync(entry.filePath, "utf-8");
        const contentHash = crypto.createHash("sha256").update(content).digest("hex");

        const url = new URL(req.url ?? "/", "http://localhost");
        const knownHash = url.searchParams.get("hash");
        if (knownHash && knownHash === contentHash) {
          sendJson(res, 200, { changed: false, hash: contentHash });
          return;
        }

        const responseData: Record<string, unknown> = {
          content,
          hash: contentHash,
          fileName: path.basename(entry.filePath),
          readonly: entry.readonly,
        };
        if (knownHash) {
          responseData.changed = true;
        }
        if (defaultName) {
          responseData.defaultName = defaultName;
        }
        if (entry.readonlyToken) {
          responseData.readonlyToken = entry.readonlyToken;
        }
        sendJson(res, 200, responseData);
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") {
          sendJson(res, 404, { error: `File not found: ${entry.filePath}` });
        } else {
          sendJson(res, 500, { error: e.message });
        }
      }
      return;
    }

    // POST /api/file/:token
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "file" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      if (entry.readonly) {
        sendJson(res, 403, { error: "Read-only file" });
        return;
      }
      readBody(req)
        .then(async (rawBody) => {
          try {
            const parsed = JSON.parse(rawBody);
            const author: string = parsed.author ?? defaultName ?? "browser_user";
            const gitOps = gitOpsMap ? gitOpsMap.get(token) : undefined;

            if (parsed.baseContent && gitOps) {
              const currentContent = fs.readFileSync(entry.filePath, "utf-8");
              if (currentContent !== parsed.baseContent) {
                const mergeResult = await gitOps.mergeFile(
                  parsed.baseContent,
                  currentContent,
                  parsed.content,
                );
                if (mergeResult.conflict) {
                  sendJson(res, 409, { conflict: true, content: mergeResult.content });
                  return;
                }
                parsed.content = mergeResult.content;
              }
            }

            if (typeof parsed.content !== "string") {
              sendJson(res, 400, { error: "content must be a string" });
              return;
            }
            if (savedContentHashMap) {
              savedContentHashMap.set(
                entry.filePath,
                crypto.createHash("sha256").update(parsed.content).digest("hex"),
              );
            }
            fs.writeFileSync(entry.filePath, parsed.content);

            if (gitOps) {
              fs.copyFileSync(
                entry.filePath,
                path.join(gitOps.getWorkTree(), GIT_FILE_NAME),
              );
              await gitOps.commit(GIT_FILE_NAME, "save", author);
            }

            if (onSave) {
              onSave(token, parsed.content, author);
            }
            sendJson(res, 200, { ok: true });
          } catch (err: unknown) {
            const e = err as Error;
            sendJson(res, 400, { error: e.message });
          }
        })
        .catch((err: Error) => {
          if (err.message === "BODY_TOO_LARGE") {
            sendJson(res, 413, { error: "Request body too large" });
          } else {
            sendJson(res, 500, { error: err.message });
          }
        });
      return;
    }

    // GET /api/blame/:token
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "blame" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const gitOps = gitOpsMap ? gitOpsMap.get(token) : undefined;
      if (!gitOps) {
        sendJson(res, 404, { error: "No git history for this file" });
        return;
      }
      gitOps
        .blame(GIT_FILE_NAME)
        .then((blame) => {
          sendJson(res, 200, blame);
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // GET /api/history/:token (log) or GET /api/history/:token/:hash (show)
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "history" &&
      segments.length >= 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const gitOps = gitOpsMap ? gitOpsMap.get(token) : undefined;
      if (!gitOps) {
        sendJson(res, 404, { error: "No git history for this file" });
        return;
      }

      if (segments.length === 3) {
        gitOps
          .log(GIT_FILE_NAME, 100)
          .then((log) => {
            sendJson(res, 200, log);
          })
          .catch((err: Error) => {
            sendJson(res, 500, { error: err.message });
          });
        return;
      }

      if (segments.length === 4) {
        const hash = segments[3];
        if (!GIT_HASH_REGEX.test(hash)) {
          sendJson(res, 400, { error: "Invalid git hash" });
          return;
        }
        gitOps
          .show(hash, GIT_FILE_NAME)
          .then((content) => {
            sendJson(res, 200, { content });
          })
          .catch((err: Error) => {
            sendJson(res, 500, { error: err.message });
          });
        return;
      }
    }

    // POST /api/revert/:token/:hash
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "revert" &&
      segments.length === 4
    ) {
      const token = segments[2];
      const hash = segments[3];
      if (!GIT_HASH_REGEX.test(hash)) {
        sendJson(res, 400, { error: "Invalid git hash" });
        return;
      }
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const gitOps = gitOpsMap ? gitOpsMap.get(token) : undefined;
      if (!gitOps) {
        sendJson(res, 404, { error: "No git history for this file" });
        return;
      }
      gitOps
        .revert(GIT_FILE_NAME, hash)
        .then(async (content) => {
          fs.writeFileSync(entry.filePath, content);
          const commitHash = await gitOps.commit(
            GIT_FILE_NAME,
            "revert",
            "browser_user",
          );
          if (onSave) {
            onSave(token, content, "browser_user");
          }
          sendJson(res, 200, { ok: true, content, hash: commitHash });
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // GET /api/diff/:token
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "diff" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const gitOps = gitOpsMap ? gitOpsMap.get(token) : undefined;
      if (!gitOps) {
        sendJson(res, 404, { error: "No git history for this file" });
        return;
      }
      gitOps
        .show("HEAD", GIT_FILE_NAME)
        .then((lastSavedContent) => {
          const currentContent = fs.readFileSync(entry.filePath, "utf-8");
          const diff = computeDiff(lastSavedContent, currentContent);
          sendJson(res, 200, {
            original: lastSavedContent,
            modified: currentContent,
            diff,
          });
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // POST /api/merge — 3-way merge
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "merge" &&
      segments.length === 2
    ) {
      readBody(req)
        .then(async (rawBody) => {
          try {
            const parsed = JSON.parse(rawBody);
            const { base, ours, theirs } = parsed;
            if (
              typeof base !== "string" ||
              typeof ours !== "string" ||
              typeof theirs !== "string"
            ) {
              sendJson(res, 400, { error: "base, ours, theirs are required strings" });
              return;
            }
            const { execFile: execFileCb } = await import("node:child_process");
            const os = await import("node:os");
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codoc-merge-"));
            const basePath = path.join(tmpDir, "base");
            const oursPath = path.join(tmpDir, "ours");
            const theirsPath = path.join(tmpDir, "theirs");
            fs.writeFileSync(basePath, base);
            fs.writeFileSync(oursPath, ours);
            fs.writeFileSync(theirsPath, theirs);
            execFileCb(
              "git",
              ["merge-file", "-p", oursPath, basePath, theirsPath],
              { maxBuffer: 10 * 1024 * 1024 },
              (error, stdout) => {
                fs.rmSync(tmpDir, { recursive: true, force: true });
                const conflict = error !== null;
                sendJson(res, 200, { content: stdout, conflict });
              },
            );
          } catch (err: unknown) {
            const e = err as Error;
            sendJson(res, 400, { error: e.message });
          }
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // GET /codoc.sh — universal CLI shell script
    if (method === "GET" && segments[0] === "codoc.sh" && segments.length === 1) {
      const apiBase = getApiBase(req);
      sendPlainText(res, 200, generateCodocCli(apiBase));
      return;
    }

    // GET /HOWTO_FOR_AGENT/:token.md
    if (
      method === "GET" &&
      segments[0] === "HOWTO_FOR_AGENT" &&
      segments.length === 2 &&
      segments[1].endsWith(".md")
    ) {
      const docToken = segments[1].slice(0, -3);
      const entry = tokenStore.resolve(docToken);
      if (!entry) {
        send404(res);
        return;
      }
      const apiBase = getApiBase(req);
      const md = generateDocsMd(apiBase, docToken);
      res.writeHead(200, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Length": Buffer.byteLength(md),
      });
      res.end(md);
      return;
    }

    // GET /api/status/:token
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "status" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const agentOnline = sessionTracker ? sessionTracker.isAgentOnline(token) : false;
      sendJson(res, 200, { agentOnline });
      return;
    }

    // GET /api/presence/:token
    if (
      method === "GET" &&
      segments[0] === "api" &&
      segments[1] === "presence" &&
      segments.length === 3
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      const users = presenceTracker ? presenceTracker.getUsers(token) : [];
      sendJson(res, 200, { users });
      return;
    }

    // POST /api/presence/:token/join
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "presence" &&
      segments.length === 4 &&
      segments[3] === "join"
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      readBody(req)
        .then((rawBody) => {
          try {
            const parsed = JSON.parse(rawBody);
            const author = parsed.author;
            const mode = parsed.mode;
            if (!author || typeof author !== "string") {
              sendJson(res, 400, { error: "Missing author" });
              return;
            }
            if (mode !== "write" && mode !== "read") {
              sendJson(res, 400, { error: "mode must be 'write' or 'read'" });
              return;
            }
            if (!presenceTracker) {
              sendJson(res, 500, { error: "Presence tracking not available" });
              return;
            }
            const sessionId = presenceTracker.join(token, author, mode);
            sendJson(res, 200, { sessionId });
          } catch (err: unknown) {
            const e = err as Error;
            sendJson(res, 400, { error: e.message });
          }
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // POST /api/presence/:token/leave
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "presence" &&
      segments.length === 4 &&
      segments[3] === "leave"
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      readBody(req)
        .then((rawBody) => {
          try {
            const parsed = JSON.parse(rawBody);
            const sessionId = parsed.sessionId;
            if (!sessionId || typeof sessionId !== "string") {
              sendJson(res, 400, { error: "Missing sessionId" });
              return;
            }
            if (!presenceTracker) {
              sendJson(res, 500, { error: "Presence tracking not available" });
              return;
            }
            presenceTracker.leave(sessionId);
            sendJson(res, 200, { ok: true });
          } catch (err: unknown) {
            const e = err as Error;
            sendJson(res, 400, { error: e.message });
          }
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // POST /api/presence/:token/heartbeat
    if (
      method === "POST" &&
      segments[0] === "api" &&
      segments[1] === "presence" &&
      segments.length === 4 &&
      segments[3] === "heartbeat"
    ) {
      const token = segments[2];
      const entry = tokenStore.resolve(token);
      if (!entry) {
        send404(res);
        return;
      }
      readBody(req)
        .then((rawBody) => {
          try {
            const parsed = JSON.parse(rawBody);
            const sessionId = parsed.sessionId;
            if (!sessionId || typeof sessionId !== "string") {
              sendJson(res, 400, { error: "Missing sessionId" });
              return;
            }
            if (!presenceTracker) {
              sendJson(res, 500, { error: "Presence tracking not available" });
              return;
            }
            const found = presenceTracker.heartbeat(sessionId);
            if (!found) {
              sendJson(res, 404, { error: "Session not found" });
              return;
            }
            sendJson(res, 200, { ok: true });
          } catch (err: unknown) {
            const e = err as Error;
            sendJson(res, 400, { error: e.message });
          }
        })
        .catch((err: Error) => {
          sendJson(res, 500, { error: err.message });
        });
      return;
    }

    // GET /static/* or GET /assets/*
    if (
      method === "GET" &&
      (segments[0] === "static" || segments[0] === "assets") &&
      segments.length >= 2
    ) {
      const subSegments = segments[0] === "static" ? segments.slice(1) : segments;
      const filePath = path.join(STATIC_DIR, ...subSegments);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(STATIC_DIR))) {
        send404(res);
        return;
      }
      try {
        const content = fs.readFileSync(resolved);
        const ext = path.extname(resolved);
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": content.length,
        });
        res.end(content);
      } catch {
        send404(res);
      }
      return;
    }

    send404(res);
  };
}
