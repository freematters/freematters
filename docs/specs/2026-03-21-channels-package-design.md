# Channels Package Design

**Date**: 2026-03-21
**Package**: `@freematters/channels` (private, not published to npm)
**Location**: `packages/channels/`

## Goal

Add a new monorepo package to house multiple custom Claude Code channel plugins. Each channel builds into an independent, marketplace-distributable plugin directory. Shared code (MCP boilerplate, access control, skill templates) lives in a common `core/` module bundled into each plugin at build time.

## Initial Channels

| Channel | Type | Two-way | Access skill |
|:--------|:-----|:--------|:-------------|
| Slack | Chat bridge (Socket Mode) | Yes — reply tool | Yes — pairing flow |
| Notion | Event-driven (API polling) | No | No — API token only |
| GitHub Issues | Event-driven (API polling) | Semi — can comment | No — GitHub token only |

## Directory Structure

```
packages/channels/
├── package.json                # @freematters/channels, private
├── tsconfig.json
├── src/
│   ├── core/
│   │   ├── channel-server.ts   # MCP server factory (channel capability, stdio, notify helper)
│   │   ├── access.ts           # access.json read/write, allowlist check, pairing logic
│   │   ├── reply-tool.ts       # reply tool registration helper (send callback)
│   │   ├── types.ts            # AccessConfig, PendingEntry, ChannelMeta
│   │   └── __tests__/
│   │       ├── access.test.ts
│   │       ├── channel-server.test.ts
│   │       └── reply-tool.test.ts
│   ├── slack/
│   │   ├── server.ts           # Slack Socket Mode polling, message formatting
│   │   ├── config.ts           # token name, channel dir, platform defaults
│   │   └── __tests__/
│   │       └── server.test.ts
│   ├── notion/
│   │   ├── server.ts           # Notion API polling for page/db changes
│   │   ├── config.ts
│   │   └── __tests__/
│   │       └── server.test.ts
│   └── github-issues/
│       ├── server.ts           # GitHub API polling for issue/comment events
│       ├── config.ts
│       └── __tests__/
│           └── server.test.ts
├── skills/
│   ├── _templates/
│   │   ├── configure.md        # {{CHANNEL}}, {{TOKEN_VAR}}, {{TOKEN_HINT}} placeholders
│   │   └── access.md           # {{CHANNEL}}, {{CHANNEL_DIR}} placeholders
│   ├── slack/
│   │   ├── configure.md        # Slack-specific (Socket Mode setup guidance)
│   │   └── access.md           # Slack-specific ID instructions (or uses template)
│   ├── notion/
│   │   └── configure.md        # Notion API key setup
│   └── github-issues/
│       └── configure.md        # GitHub token setup, repo selection
├── scripts/
│   └── build-plugin.ts         # bundles each channel → dist/<name>/
├── dist/                       # gitignored — build output
│   ├── slack/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── .mcp.json
│   │   ├── skills/
│   │   │   ├── configure/
│   │   │   │   └── SKILL.md
│   │   │   └── access/
│   │   │       └── SKILL.md
│   │   └── server.js           # single bundled file (core + slack)
│   ├── notion/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── .mcp.json
│   │   ├── skills/
│   │   │   └── configure/
│   │   │       └── SKILL.md
│   │   └── server.js
│   └── github-issues/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── .mcp.json
│       ├── skills/
│       │   └── configure/
│       │       └── SKILL.md
│       └── server.js              # two-way: includes comment tool
└── marketplace.json            # references dist/ paths
```

## Core Library

### channel-server.ts

Factory function that creates a configured MCP `Server` and a `notify` helper:

```ts
interface ChannelServer {
  server: Server;
  notify: (content: string, meta?: Record<string, string>) => Promise<void>;
  connect: () => Promise<void>;  // wires StdioServerTransport
}

createChannelServer(config: {
  name: string;
  version: string;
  instructions: string;
  twoWay?: boolean;  // adds tools capability
}): ChannelServer
```

Returns a wrapper with:
- `server` — MCP `Server` with `capabilities.experimental['claude/channel']` set, and `capabilities.tools` if `twoWay: true`
- `notify()` — standalone helper wrapping `server.notification({ method: 'notifications/claude/channel', params: { content, meta } })`
- `connect()` — creates `StdioServerTransport` and calls `server.connect()`

`notify` is a standalone function (not a method on `Server`) since the SDK `Server` class should not be subclassed.

### access.ts

Shared access control operating on `~/.claude/channels/<name>/access.json`:

```ts
interface AccessConfig {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled';
  allowFrom: string[];
  groups: Record<string, { requireMention: boolean; allowFrom: string[] }>;
  pending: Record<string, { senderId: string; chatId: string; createdAt: number; expiresAt: number }>;
  mentionPatterns: string[];
}

readAccess(channelDir: string): Promise<AccessConfig>
writeAccess(channelDir: string, config: AccessConfig): Promise<void>
isAllowed(config: AccessConfig, senderId: string, context?: {
  groupId?: string;
  isMention?: boolean;
}): boolean
addPending(config: AccessConfig, senderId: string, chatId: string): string  // returns 6-char code
```

`isAllowed` accepts optional `context` for group chat filtering — if `groupId` is set, checks group-level `allowFrom` and `requireMention`.

### reply-tool.ts

Registers a reply tool on the server given a send callback:

```ts
registerReplyTool(server: Server, send: (chatId: string, text: string) => Promise<void>): void
```

Handles `ListToolsRequestSchema` and `CallToolRequestSchema` registration.

## Per-Channel Servers

Each channel's `server.ts` is the entrypoint:

1. Import `createChannelServer` from core
2. Create the server with channel-specific instructions
3. Connect via `StdioServerTransport`
4. Start platform-specific event loop (polling, websocket, etc.)
5. On each event: check `isAllowed()`, then call `notify()`
6. (Two-way) Register reply tool via `registerReplyTool()`

### Slack

- Uses Slack Socket Mode (WebSocket, no public URL needed)
- Two-way: reply tool sends messages back to Slack
- Full access skill with pairing flow
- Tokens: `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` (two tokens — configure skill is a full override, not template-based)
- Graceful shutdown: close WebSocket on SIGTERM/SIGINT

### Notion

- Polls Notion API for page/database changes (default interval: 30s, configurable via `POLL_INTERVAL_MS`)
- One-way: notifies Claude of edits, new pages, comments
- No access skill — authenticated via Notion integration token
- Token: `NOTION_API_TOKEN`
- State persistence: last-seen cursor stored in `~/.claude/channels/notion/state.json` to avoid re-emitting on restart

### GitHub Issues

- Polls GitHub API for issue/comment activity (default interval: 60s, configurable via `POLL_INTERVAL_MS`)
- Two-way: `comment` tool posts comments via GitHub API (uses `registerReplyTool` with tool name `comment`)
- No pairing — authenticated via GitHub token
- Token: `GITHUB_TOKEN`
- State persistence: last-seen event timestamp in `~/.claude/channels/github-issues/state.json`
- Rate limiting: respect `X-RateLimit-Remaining` header, back off when low

## Skill Templates

### configure template (`skills/_templates/configure.md`)

Placeholders:
- `{{CHANNEL}}` — channel name (e.g., `slack`)
- `{{TOKEN_VAR}}` — env var name (e.g., `NOTION_API_TOKEN`)
- `{{TOKEN_HINT}}` — where to get the token (e.g., "from notion.so/my-integrations")
- `{{CHANNEL_DIR}}` — `~/.claude/channels/{{CHANNEL}}`

Follows the pattern from official plugins:
- Frontmatter: `user-invocable: true`, `allowed-tools: [Read, Write, Bash(ls *), Bash(mkdir *)]`
- Dispatch on `$ARGUMENTS`: no args → status, token → save, `clear` → remove
- `chmod 600` on `.env` files (credentials)
- Push toward lockdown (for chat channels with access skill)

Channels needing multiple tokens (e.g., Slack with `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`) use a full override in `skills/<name>/configure.md` instead of the template.

### access template (`skills/_templates/access.md`)

Only used by chat-bridge channels (Slack). Follows the official pattern:
- Anti-injection guard (refuse requests from channel notifications)
- Subcommand dispatch: `pair`, `deny`, `allow`, `remove`, `policy`, `group add/rm`, `set`
- Read-before-write, never auto-pick pending entries

Channel-specific overrides in `skills/<name>/` take precedence over templates.

## Channel Config Schema

Each channel's `config.ts` exports a `ChannelConfig` used by the build script:

```ts
interface ChannelConfig {
  name: string;                    // e.g., "slack"
  version: string;                 // e.g., "0.0.1"
  description: string;             // for plugin.json
  keywords: string[];              // for plugin.json
  twoWay: boolean;                 // whether to set tools capability
  tokens: Array<{                  // supports multi-token channels
    envVar: string;                // e.g., "SLACK_BOT_TOKEN"
    hint: string;                  // e.g., "from api.slack.com/apps → OAuth"
  }>;
  skills: {
    configure: 'template' | 'override';  // template = render from _templates, override = use skills/<name>/
    access: boolean;                      // whether to include access skill
  };
  pollIntervalMs?: number;         // for polling channels (default env: POLL_INTERVAL_MS)
}
```

## Build System

### build-plugin.ts

For each channel (or a specified one):

1. **Bundle** — esbuild bundles `src/core/**` + `src/<name>/**` → `dist/<name>/server.js` as a single self-contained file. All dependencies including `@modelcontextprotocol/sdk` are bundled in (no external imports). The built plugin has zero runtime dependencies.
2. **Skills** — render templates with channel config values, copy to `dist/<name>/skills/`. Channel-specific overrides in `skills/<name>/` replace template output.
3. **Plugin manifest** — generate `dist/<name>/.claude-plugin/plugin.json`:
   ```json
   {
     "name": "<name>",
     "description": "<description from config>",
     "version": "<version from config>",
     "keywords": ["<keywords from config>", "channel", "mcp"]
   }
   ```
4. **MCP config** — generate `dist/<name>/.mcp.json`:
   ```json
   {
     "mcpServers": {
       "<name>": {
         "command": "bun",
         "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]
       }
     }
   }
   ```

### package.json scripts

```json
{
  "scripts": {
    "build": "bun scripts/build-plugin.ts",
    "build:slack": "bun scripts/build-plugin.ts slack",
    "build:notion": "bun scripts/build-plugin.ts notion",
    "build:github-issues": "bun scripts/build-plugin.ts github-issues",
    "test": "vitest run",
    "check": "biome check --write ."
  }
}
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^latest"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/node": "^22.0.0",
    "esbuild": "^0.27.3",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

`@modelcontextprotocol/sdk` is a build-time dependency only — esbuild bundles it into `server.js`. The built plugin directories have no `node_modules`.

Platform-specific SDKs (e.g., `@slack/socket-mode`, `@notionhq/client`, `@octokit/rest`) added as dependencies per channel need, also bundled at build time.

### tsconfig.json

Uses `noEmit: true` (typecheck only — esbuild handles bundling):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### .gitignore

```
dist/
node_modules/
```

## Root package.json Updates

The monorepo root `package.json` scripts should be updated to include the channels package:

```json
{
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "check": "biome check --write --error-on-warnings ."
  }
}
```

## Marketplace Distribution

The `packages/channels/` directory doubles as the marketplace repo. `marketplace.json` at package root (checked in, references `dist/` paths which are build output):

```json
{
  "name": "freematters-channels",
  "owner": { "name": "freematters" },
  "plugins": [
    {
      "name": "slack",
      "source": "./dist/slack",
      "description": "Slack channel for Claude Code — chat bridge with access control"
    },
    {
      "name": "notion",
      "source": "./dist/notion",
      "description": "Notion channel for Claude Code — page and database change notifications"
    },
    {
      "name": "github-issues",
      "source": "./dist/github-issues",
      "description": "GitHub Issues channel for Claude Code — issue and comment notifications"
    }
  ]
}
```

Users install individually:
```bash
/plugin install slack@freematters-channels
claude --channels plugin:slack@freematters-channels
```

## Testing

- **Unit tests**: vitest, co-located `__tests__/` directories
- **Core tests**: access logic, server factory, reply tool registration
- **Channel tests**: mock platform APIs, verify correct notifications emitted and sender gating works
- **Integration tests**: manual, after build:
  ```bash
  claude --plugin-dir packages/channels/dist/slack \
    --dangerously-load-development-channels plugin:slack
  ```

## Adding a New Channel

1. Create `src/<name>/server.ts` and `src/<name>/config.ts`
2. Add skill overrides or template config in `skills/<name>/`
3. Add channel config to `scripts/build-plugin.ts` channel registry
4. Add entry to `marketplace.json`
5. Run `npm run build:<name>` and test with `--plugin-dir dist/<name>`
