import type { ChannelConfig } from "../core/types.js";

export const slackConfig: ChannelConfig = {
  name: "slack",
  version: "0.0.1",
  description:
    "Slack channel for Claude Code — chat bridge with access control",
  keywords: ["slack", "messaging"],
  twoWay: true,
  tokens: [
    { envVar: "SLACK_BOT_TOKEN", hint: "from api.slack.com/apps → OAuth" },
    {
      envVar: "SLACK_APP_TOKEN",
      hint: "from api.slack.com/apps → Basic Information → App-Level Tokens",
    },
  ],
  skills: { configure: "override", access: true },
};
