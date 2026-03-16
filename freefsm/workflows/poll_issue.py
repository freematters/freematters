#!/usr/bin/env python3
"""Poll a GitHub issue for new comments from a specific user.

Usage:
    poll_issue_comments.py <owner> <repo> <issue_number> <creator>
        --run-id <run_id> [--interval <seconds>] [--wf-dir <path>]

The script polls the issue's comment count and, when new comments arrive,
fetches and filters them. Only comments from <creator> are reported.

Output:
    Prints "NEW_COMMENT: <body>" for each new comment from the creator.
    Reacts with 👀 to every new comment (regardless of author).

State:
    Persists the last-seen comment count in <wf-dir>/comment_count
    (or ~/.freefsm/runs/<run_id>/comment_count if --wf-dir is not set).
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def gh_api(endpoint: str, jq: str | None = None, paginate: bool = False) -> str:
    cmd = ["gh", "api", endpoint]
    if jq:
        cmd += ["--jq", jq]
    if paginate:
        cmd.append("--paginate")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[poll] gh api error: {result.stderr.strip()}", file=sys.stderr)
        return ""
    return result.stdout.strip()


def react_eyes(owner: str, repo: str, comment_id: int) -> None:
    subprocess.run(
        ["gh", "api", f"repos/{owner}/{repo}/issues/comments/{comment_id}/reactions",
         "-f", "content=eyes"],
        capture_output=True,
    )


def get_comment_count(owner: str, repo: str, issue_number: int) -> int:
    raw = gh_api(f"repos/{owner}/{repo}/issues/{issue_number}", jq=".comments")
    try:
        return int(raw)
    except ValueError:
        return -1


def get_comments_since(
    owner: str, repo: str, issue_number: int, since_count: int
) -> list[dict]:
    """Fetch all comments and return those after index `since_count`."""
    raw = gh_api(
        f"repos/{owner}/{repo}/issues/{issue_number}/comments",
        jq=".[] | {id, body, user_login: .user.login}",
        paginate=True,
    )
    if not raw:
        return []
    comments = []
    for line in raw.strip().split("\n"):
        if line.strip():
            try:
                comments.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    # Return comments after the old count
    return comments[since_count:]


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll GitHub issue for new comments")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("issue_number", type=int, help="Issue number")
    parser.add_argument("creator", help="Issue creator username to filter for")
    parser.add_argument("--run-id", required=True, help="FSM run ID")
    parser.add_argument("--interval", type=int, default=1, help="Poll interval in seconds")
    parser.add_argument("--wf-dir", help="Workflow directory (default: ~/.freefsm/runs/<run_id>)")
    args = parser.parse_args()

    wf_dir = Path(args.wf_dir) if args.wf_dir else Path.home() / ".freefsm" / "runs" / args.run_id
    count_file = wf_dir / "comment_count"

    # Read persisted count or fetch current
    if count_file.exists():
        last_count = int(count_file.read_text().strip())
    else:
        last_count = get_comment_count(args.owner, args.repo, args.issue_number)
        wf_dir.mkdir(parents=True, exist_ok=True)
        count_file.write_text(str(last_count))

    print(
        f"[poll] Polling {args.owner}/{args.repo}#{args.issue_number} "
        f"for comments from {args.creator} (last_count={last_count}, interval={args.interval}s)",
        file=sys.stderr,
    )

    while True:
        new_count = get_comment_count(args.owner, args.repo, args.issue_number)
        if new_count > last_count:
            # Fetch all new comments since last_count
            new_comments = get_comments_since(
                args.owner, args.repo, args.issue_number, last_count
            )

            for comment in new_comments:
                # React with 👀 to every new comment
                react_eyes(args.owner, args.repo, comment["id"])

                # Only report comments from the creator
                if comment["user_login"] == args.creator:
                    print(f"NEW_COMMENT: {comment['body']}")
                    sys.stdout.flush()

            # Persist new count and exit (one batch at a time)
            count_file.write_text(str(new_count))
            break

        time.sleep(args.interval)


if __name__ == "__main__":
    main()
