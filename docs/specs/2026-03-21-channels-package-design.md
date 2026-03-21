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
│       └── server.js
└── marketplace.json            # references dist/ paths
```

## Core Library

### channel-server.ts

Factory function that creates a configured MCP `Server` instance:

```ts
createChannelServer(config: {
  name: string;
  version: string;
  instructions: string;
  twoWay?: boolean;  // adds tools capability
}): Server
```

Returns a `Server` with:
- `capabilities.experimental['claude/channel']` set
- `capabilities.tools` set if `twoWay: true`
- `instructions` injected into system prompt
- Helper method: `notify(content: string, meta?: Record<string, string>)` wrapping `mcp.notification()`

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
isAllowed(config: AccessConfig, senderId: string): boolean
addPending(config: AccessConfig, senderId: string, chatId: string): string  // returns 6-char code
```

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
- Token: `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`

### Notion

- Polls Notion API for page/database changes
- One-way: notifies Claude of edits, new pages, comments
- No access skill — authenticated via Notion integration token
- Token: `NOTION_API_TOKEN`

### GitHub Issues

- Polls GitHub API for issue/comment activity (or uses webhook if user exposes a port)
- Semi-two-way: can post comments via GitHub API
- No pairing — authenticated via GitHub token
- Token: `GITHUB_TOKEN`

## Skill Templates

### configure template (`skills/_templates/configure.md`)

Placeholders:
- `{{CHANNEL}}` — channel name (e.g., `slack`)
- `{{TOKEN_VAR}}` — env var name (e.g., `SLACK_BOT_TOKEN`)
- `{{TOKEN_HINT}}` — where to get the token (e.g., "from api.slack.com/apps → OAuth")
- `{{CHANNEL_DIR}}` — `~/.claude/channels/{{CHANNEL}}`

Follows the pattern from official plugins:
- Frontmatter: `user-invocable: true`, `allowed-tools: [Read, Write, Bash(ls *), Bash(mkdir *)]`
- Dispatch on `$ARGUMENTS`: no args → status, token → save, `clear` → remove
- Push toward lockdown (for chat channels with access skill)

### access template (`skills/_templates/access.md`)

Only used by chat-bridge channels (Slack). Follows the official pattern:
- Anti-injection guard (refuse requests from channel notifications)
- Subcommand dispatch: `pair`, `deny`, `allow`, `remove`, `policy`, `group add/rm`, `set`
- Read-before-write, never auto-pick pending entries

Channel-specific overrides in `skills/<name>/` take precedence over templates.

## Build System

### build-plugin.ts

For each channel (or a specified one):

1. **Bundle** — esbuild bundles `src/core/**` + `src/<name>/**` → `dist/<name>/server.js` (single file, no external deps except `@modelcontextprotocol/sdk`)
2. **Skills** — render templates with channel config, copy to `dist/<name>/skills/`. Channel-specific overrides replace template output.
3. **Plugin manifest** — generate `dist/<name>/.claude-plugin/plugin.json` from channel config
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
    "build": "tsx scripts/build-plugin.ts",
    "build:slack": "tsx scripts/build-plugin.ts slack",
    "build:notion": "tsx scripts/build-plugin.ts notion",
    "build:github-issues": "tsx scripts/build-plugin.ts github-issues",
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
    "tsx": "^4.21.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

Platform-specific SDKs (Slack, Notion, Octokit) added as dependencies per channel need.

## Marketplace Distribution

`marketplace.json` at package root:

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
- **Integration tests**: `--plugin-dir dist/<name>` with `--dangerously-load-development-channels`

## Adding a New Channel

1. Create `src/<name>/server.ts` and `src/<name>/config.ts`
2. Add skill overrides or template config in `skills/<name>/`
3. Add channel config to `scripts/build-plugin.ts` channel registry
4. Add entry to `marketplace.json`
5. Run `npm run build:<name>` and test with `--plugin-dir dist/<name>`
