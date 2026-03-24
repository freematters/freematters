# codoc

Claude Code plugin for collaborative markdown editing between AI agents and humans.

Humans edit in the browser (Monaco Editor), agents edit via CLI. Collaboration happens through structured HTML comments embedded in the document.

## Install

Tell this to your coding agent:

```
Read https://github.com/freematters/freematters/blob/main/packages/codoc/README.md to install codoc
```

Or install manually:

```bash
npm install -g @freematters/codoc
```

Plugin auto-registers with Claude Code on install. To manually register:

```bash
codoc install claude
```

### Config

Create `~/.codoc/config.json` before first use. `tunnel` is required — no default:

```json
{
  "tunnel": "cloudflare",
  "port": 3000,
  "defaultName": "browser_user"
}
```

Set `tunnel` to `"cloudflare"` (expose via Cloudflare Tunnel, auto-downloads `cloudflared`) or `null` (local only). Add `"callbackScript": "command"` to run a shell command on every save. **Security note:** `callbackScript` is executed as a raw shell command via `/bin/sh -c`. Protect `~/.codoc/config.json` with appropriate file permissions (`chmod 600`).

### From source

```bash
git clone https://github.com/freematters/freematters.git && cd freematters
npm install && npm --prefix packages/codoc/frontend install
npm run build -w packages/codoc
npm link -w packages/codoc
codoc install claude
```

Requires Node.js 20+ and git.

## How It Works

1. Agent runs `codoc share /path/to/doc.md` — gets Edit URL + Readonly URL
2. Human opens URL in browser — sees Monaco editor + markdown preview (dark theme)
3. Human adds a comment via the "+" button — a reply placeholder is inserted for the agent
4. Agent runs `codoc poll <token>` — blocks until the human saves
5. Agent reads the file, replaces reply placeholders with responses
6. Repeat 3-5

Server auto-starts on Claude Code session start and stops when the last session ends (ref-counted). PostToolUse hook passively notifies the agent of changes between poll cycles.

## Comment Format

Comments are multi-line `<!-- ... -->` blocks:

```
<!--
@user[tid:t1][cid:abc]: question here
@agent[tid:t1][cid:def][reply:abc]: response here
[REPLY_TEMPLATE] @agent[tid:t1][cid:ghi][reply:def]: your response here (use \n for newlines)
-->
```

To reply, replace the `[REPLY_TEMPLATE]` line (keep format, remove prefix). Escape `-->` as `\-\-\>`, newlines as `\n`.

## CLI (Local)

| Command | Description |
|---------|-------------|
| `codoc server` | Start daemon (auto-started by SessionStart hook) |
| `codoc share <file>` | Register file, get Edit + Readonly URLs |
| `codoc poll <token>` | Block until human edits, output diff |
| `codoc stop` | End session (server stops when last session ends) |
| `codoc stop --force` | Force stop server regardless of active sessions |
| `codoc install claude` | Register plugin with Claude Code |

## Remote CLI

Users on other machines (no codoc installed) use the server-distributed CLI:

```bash
# Set up alias
alias codoc='bash <(curl -sf https://your-server/codoc.sh)'

# Commands
codoc edit <token> <author>    # Open in $EDITOR, upload on save
codoc poll <token> <author>    # Block until changes
codoc who <token>              # Show who's online
```

## Presence

The server tracks who's online per document:
- Browser users join automatically (write mode if editable, read if readonly)
- Remote CLI users join via `edit` (write) or `poll` (read)
- Toolbar shows "N online" with author names and modes
- `codoc who <token>` shows online users from CLI
- Sessions auto-expire after 60s without heartbeat

## Development

```bash
npm run build -w packages/codoc    # tsc + vite
npm run test -w packages/codoc     # 202 tests
npx playwright test                # browser E2E tests (from packages/codoc/)
```
