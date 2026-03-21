import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { createChannelServer } from "../core/channel-server.js";
import { registerReplyTool } from "../core/reply-tool.js";

const CHANNEL_DIR = path.join(os.homedir(), ".claude", "channels", "github-issues");
const STATE_FILE = path.join(CHANNEL_DIR, "state.json");
const REPOS_FILE = path.join(CHANNEL_DIR, "repos.json");

export async function loadEnv(): Promise<Record<string, string>> {
  const envPath = path.join(CHANNEL_DIR, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf-8");
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
    return env;
  } catch {
    return {};
  }
}

interface PollState {
  lastEventTime: string | null;
}

async function readState(): Promise<PollState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastEventTime: null };
  }
}

async function writeState(state: PollState): Promise<void> {
  await fs.mkdir(CHANNEL_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

async function readRepos(): Promise<string[]> {
  try {
    const raw = await fs.readFile(REPOS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function main(): Promise<void> {
  const env = await loadEnv();
  const token = env.GITHUB_TOKEN || process.env.GITHUB_TOKEN;

  if (!token) {
    console.error("Missing GITHUB_TOKEN. Run /github-issues:configure to set up.");
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  const { server, notify, connect } = createChannelServer({
    name: "github-issues",
    version: "0.0.1",
    instructions: [
      'GitHub issue and comment events arrive as <channel source="github-issues" repo="..." issue_number="..." action="...">.',
      "Reply with the comment tool to post a comment on an issue, passing repo and issue_number from the tag.",
    ].join(" "),
    twoWay: true,
  });

  registerReplyTool(
    server,
    async (chatId: string, text: string) => {
      // chatId format: "owner/repo#number"
      const match = chatId.match(/^(.+?)\/(.+?)#(\d+)$/);
      if (!match) throw new Error(`Invalid chat_id format: ${chatId}`);
      const [, owner, repo, number] = match;
      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: Number.parseInt(number, 10),
        body: text,
      });
    },
    { toolName: "comment", toolDescription: "Post a comment on a GitHub issue" },
  );

  await connect();

  const pollInterval =
    Number.parseInt(process.env.POLL_INTERVAL_MS || "", 10) || 60_000;
  const state = await readState();

  const poll = async () => {
    const repos = await readRepos();
    if (repos.length === 0) return;

    for (const repoFull of repos) {
      const [owner, repo] = repoFull.split("/");
      if (!owner || !repo) continue;

      try {
        const params: {
          owner: string;
          repo: string;
          sort: "updated";
          direction: "desc";
          per_page: number;
          since?: string;
        } = {
          owner,
          repo,
          sort: "updated",
          direction: "desc",
          per_page: 10,
        };
        if (state.lastEventTime) {
          params.since = state.lastEventTime;
        }

        const { data: issues, headers } = await octokit.issues.listForRepo(params);

        const remaining = Number.parseInt(
          headers["x-ratelimit-remaining"] || "100",
          10,
        );
        if (remaining < 10) {
          console.error(`GitHub rate limit low: ${remaining} remaining. Backing off.`);
          return;
        }

        if (!state.lastEventTime && issues.length > 0) {
          state.lastEventTime = issues[0].updated_at;
          await writeState(state);
          return;
        }

        for (const issue of issues.reverse()) {
          if (state.lastEventTime && issue.updated_at <= state.lastEventTime) {
            continue;
          }

          await notify(
            `${issue.pull_request ? "PR" : "Issue"} #${issue.number}: ${issue.title}`,
            {
              repo: repoFull,
              issue_number: String(issue.number),
              action: "updated",
              chat_id: `${repoFull}#${issue.number}`,
              author: issue.user?.login || "unknown",
            },
          );
        }

        if (issues.length > 0) {
          state.lastEventTime = issues[0].updated_at;
          await writeState(state);
        }
      } catch (err) {
        console.error(`GitHub poll error for ${repoFull}:`, err);
      }
    }
  };

  setInterval(poll, pollInterval);
  await poll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
