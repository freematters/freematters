import type { ChannelConfig } from "../core/types.js";

export const githubIssuesConfig: ChannelConfig = {
  name: "github-issues",
  version: "0.0.1",
  description:
    "GitHub Issues channel for Claude Code — issue and comment notifications",
  keywords: ["github", "issues"],
  twoWay: true,
  tokens: [
    { envVar: "GITHUB_TOKEN", hint: "from github.com/settings/tokens with repo scope" },
  ],
  skills: { configure: "override", access: false },
  pollIntervalMs: 60_000,
};
