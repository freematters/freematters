import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Octokit } from "@octokit/rest";
import { createChannelServer } from "../core/channel-server.js";
import { registerReplyTool } from "../core/reply-tool.js";

const CHANNEL_DIR = path.join(os.homedir(), ".claude", "channels", "github-issues");
const STATE_FILE = path.join(CHANNEL_DIR, "state.json");
const REPOS_FILE = path.join(CHANNEL_DIR, "repos.json");
const FILTER_FILE = path.join(CHANNEL_DIR, "filter.json");

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
  lastCommentTime: string | null;
  lastReviewCommentTime: string | null;
}

async function readState(): Promise<PollState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastEventTime: null, lastCommentTime: null, lastReviewCommentTime: null };
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

interface FilterConfig {
  allowFrom: string[];
  ignoreFrom: string[];
}

async function readFilter(): Promise<FilterConfig | null> {
  try {
    const raw = await fs.readFile(FILTER_FILE, "utf-8");
    return JSON.parse(raw) as FilterConfig;
  } catch {
    return null;
  }
}

function isSenderAllowed(
  filter: FilterConfig | null,
  sender: string,
): boolean {
  if (!filter) return true;
  if (filter.ignoreFrom.length > 0 && filter.ignoreFrom.includes(sender))
    return false;
  if (filter.allowFrom.length > 0) return filter.allowFrom.includes(sender);
  return true;
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
      'GitHub events arrive as <channel source="github-issues" repo="..." issue_number="..." kind="..." author="...">.',
      'kind is one of: "issue_updated", "comment", "review_comment".',
      "For comments, the body text is the comment content. For review_comment, the path and diff_hunk attributes show the code context.",
      "Reply with the comment tool to post a comment, passing the chat_id from the tag (format: owner/repo#number).",
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

  function checkRateLimit(
    headers: Record<string, string | number | undefined>,
  ): boolean {
    const remaining = Number.parseInt(
      String(headers["x-ratelimit-remaining"] ?? "100"),
      10,
    );
    if (remaining < 10) {
      console.error(`GitHub rate limit low: ${remaining} remaining. Backing off.`);
      return false;
    }
    return true;
  }

  async function pollIssues(
    owner: string,
    repo: string,
    repoFull: string,
    filter: FilterConfig | null,
  ): Promise<void> {
    const params: {
      owner: string;
      repo: string;
      sort: "updated";
      direction: "desc";
      per_page: number;
      since?: string;
    } = { owner, repo, sort: "updated", direction: "desc", per_page: 10 };
    if (state.lastEventTime) params.since = state.lastEventTime;

    const { data: issues, headers } = await octokit.issues.listForRepo(params);
    if (!checkRateLimit(headers)) return;

    if (!state.lastEventTime && issues.length > 0) {
      state.lastEventTime = issues[0].updated_at;
      await writeState(state);
      return;
    }

    for (const issue of issues.reverse()) {
      if (state.lastEventTime && issue.updated_at <= state.lastEventTime) continue;
      if (!isSenderAllowed(filter, issue.user?.login || "")) continue;

      await notify(
        `${issue.pull_request ? "PR" : "Issue"} #${issue.number}: ${issue.title}`,
        {
          repo: repoFull,
          issue_number: String(issue.number),
          kind: "issue_updated",
          chat_id: `${repoFull}#${issue.number}`,
          author: issue.user?.login || "unknown",
        },
      );
    }

    if (issues.length > 0) {
      state.lastEventTime = issues[0].updated_at;
      await writeState(state);
    }
  }

  async function pollComments(
    owner: string,
    repo: string,
    repoFull: string,
    filter: FilterConfig | null,
  ): Promise<void> {
    const params: {
      owner: string;
      repo: string;
      sort: "updated";
      direction: "desc";
      per_page: number;
      since?: string;
    } = { owner, repo, sort: "updated", direction: "desc", per_page: 20 };
    if (state.lastCommentTime) params.since = state.lastCommentTime;

    const { data: comments, headers } =
      await octokit.issues.listCommentsForRepo(params);
    if (!checkRateLimit(headers)) return;

    if (!state.lastCommentTime && comments.length > 0) {
      state.lastCommentTime = comments[0].updated_at;
      await writeState(state);
      return;
    }

    for (const comment of comments.reverse()) {
      if (
        state.lastCommentTime &&
        comment.updated_at &&
        comment.updated_at <= state.lastCommentTime
      )
        continue;

      if (!isSenderAllowed(filter, comment.user?.login || "")) continue;

      // Extract issue number from issue_url
      const issueMatch = comment.issue_url?.match(/\/issues\/(\d+)$/);
      const issueNumber = issueMatch ? issueMatch[1] : "unknown";

      await notify(comment.body || "(empty comment)", {
        repo: repoFull,
        issue_number: issueNumber,
        kind: "comment",
        chat_id: `${repoFull}#${issueNumber}`,
        author: comment.user?.login || "unknown",
        comment_id: String(comment.id),
      });
    }

    if (comments.length > 0 && comments[0].updated_at) {
      state.lastCommentTime = comments[0].updated_at;
      await writeState(state);
    }
  }

  async function pollReviewComments(
    owner: string,
    repo: string,
    repoFull: string,
    filter: FilterConfig | null,
  ): Promise<void> {
    const params: {
      owner: string;
      repo: string;
      sort: "updated";
      direction: "desc";
      per_page: number;
      since?: string;
    } = { owner, repo, sort: "updated", direction: "desc", per_page: 20 };
    if (state.lastReviewCommentTime) params.since = state.lastReviewCommentTime;

    const { data: comments, headers } =
      await octokit.pulls.listReviewCommentsForRepo(params);
    if (!checkRateLimit(headers)) return;

    if (!state.lastReviewCommentTime && comments.length > 0) {
      state.lastReviewCommentTime = comments[0].updated_at;
      await writeState(state);
      return;
    }

    for (const comment of comments.reverse()) {
      if (
        state.lastReviewCommentTime &&
        comment.updated_at <= state.lastReviewCommentTime
      )
        continue;

      if (!isSenderAllowed(filter, comment.user?.login || "")) continue;

      // Extract PR number from pull_request_url
      const prMatch = comment.pull_request_url?.match(/\/pulls\/(\d+)$/);
      const prNumber = prMatch ? prMatch[1] : "unknown";

      await notify(comment.body || "(empty review comment)", {
        repo: repoFull,
        issue_number: prNumber,
        kind: "review_comment",
        chat_id: `${repoFull}#${prNumber}`,
        author: comment.user?.login || "unknown",
        path: comment.path || "",
        diff_hunk: comment.diff_hunk || "",
        comment_id: String(comment.id),
      });
    }

    if (comments.length > 0) {
      state.lastReviewCommentTime = comments[0].updated_at;
      await writeState(state);
    }
  }

  const poll = async () => {
    const repos = await readRepos();
    if (repos.length === 0) return;

    const filter = await readFilter();

    for (const repoFull of repos) {
      const [owner, repo] = repoFull.split("/");
      if (!owner || !repo) continue;

      try {
        await pollIssues(owner, repo, repoFull, filter);
        await pollComments(owner, repo, repoFull, filter);
        await pollReviewComments(owner, repo, repoFull, filter);
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
