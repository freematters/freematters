import type { ChannelConfig } from "../core/types.js";

export const notionConfig: ChannelConfig = {
  name: "notion",
  version: "0.0.1",
  description:
    "Notion channel for Claude Code — page and database change notifications",
  keywords: ["notion", "documents"],
  twoWay: true,
  tokens: [{ envVar: "NOTION_API_TOKEN", hint: "from notion.so/my-integrations" }],
  skills: { configure: "override", access: false },
  pollIntervalMs: 30_000,
};
