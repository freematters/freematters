#!/usr/bin/env python3
"""
Poll script for pr-lifecycle.

Monitors a GitHub PR for events and prints RESULT lines for the FSM agent to act on.
Writes pr_status.json to WF_DIR on every cycle for other states to consume.

Usage:
    python3 poll_pr.py <owner> <repo> <pr_number> --wf-dir <path> [--target <branch>] [--interval <seconds>]

Exit RESULT lines:
    RESULT: PR merged
    RESULT: PR closed
    RESULT: needs rebase
    RESULT: needs fix
    RESULT: needs address
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run(cmd: str) -> tuple[str, int]:
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode


def gh_api(endpoint: str) -> tuple[dict | list | None, int]:
    out, rc = run(f"gh api {endpoint}")
    if rc != 0 or not out:
        return None, rc
    try:
        return json.loads(out), 0
    except json.JSONDecodeError:
        return None, 1


def gh_graphql(query: str) -> dict | None:
    out, rc = run(f"gh api graphql -f query='{query}'")
    if rc != 0 or not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class BotMention:
    """An unhandled @bot mention found during polling."""
    source: str          # "inline_thread" or "issue_comment"
    comment_body: str    # full text of the @bot comment
    comment_id: int      # database ID of the comment
    author: str          # who wrote the @bot comment
    file_path: str | None = None   # for inline threads
    line: int | None = None        # for inline threads
    thread_id: str | None = None   # GraphQL node ID for inline threads


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_pr_state(owner: str, repo: str, pr: int) -> str | None:
    """Return PR state: OPEN, MERGED, CLOSED, or None on error."""
    out, rc = run(f"gh pr view {pr} -R {owner}/{repo} --json state -q '.state'")
    return out if rc == 0 else None


def check_ci(pr: int, owner: str, repo: str) -> dict:
    """
    Return CI status dict:
      { "status": "pending"|"finished"|"none", "checks": [...] }
    """
    out, rc = run(f"gh pr checks {pr} -R {owner}/{repo} --json name,state,bucket 2>/dev/null")
    if rc != 0 or not out:
        return {"status": "none", "checks": []}
    try:
        checks = json.loads(out)
    except json.JSONDecodeError:
        return {"status": "none", "checks": []}
    if not checks:
        return {"status": "none", "checks": []}
    if any(c.get("state") == "PENDING" for c in checks):
        return {"status": "pending", "checks": checks}
    return {"status": "finished", "checks": checks}


def check_target_branch_updated(target: str) -> bool:
    """Return True if the target branch has commits ahead of HEAD."""
    run(f"git fetch origin {target} --quiet")
    out, _ = run(f"git rev-list --count HEAD..origin/{target}")
    try:
        return int(out) > 0
    except (ValueError, TypeError):
        return False


def parse_severity(body: str) -> str:
    """
    Parse severity from a bot review comment body.

    Matches patterns: **blocker**, **major**, **minor**, [BLOCKER], [MAJOR], [MINOR],
    <!-- severity: blocker -->, leading **blocker**: ...

    Returns "blocker", "major", "minor", or "unknown".
    """
    lower = body.lower()
    for level in ("blocker", "major", "minor"):
        if f"**{level}**" in lower:
            return level
        if f"[{level.upper()}]" in body:
            return level
        if f"<!-- severity: {level}" in lower:
            return level
    return "unknown"


def fetch_bot_review_threads(owner: str, repo: str, pr: int) -> list[dict]:
    """Fetch all unresolved bot-authored review threads with full comments and severity."""
    query = (
        f'query {{ repository(owner: "{owner}", name: "{repo}") {{ '
        f'pullRequest(number: {pr}) {{ '
        f'reviewThreads(first: 100) {{ nodes {{ '
        f'id isResolved path line '
        f'comments(first: 50) {{ nodes {{ '
        f'databaseId body createdAt author {{ login __typename }} '
        f'}} }} }} }} }} }} }}'
    )
    data = gh_graphql(query)
    if not data:
        return []
    threads = (
        data.get("data", {})
        .get("repository", {})
        .get("pullRequest", {})
        .get("reviewThreads", {})
        .get("nodes", [])
    )
    # Return unresolved bot-authored threads
    result = []
    for thread in threads:
        if thread.get("isResolved"):
            continue
        comments = thread.get("comments", {}).get("nodes", [])
        if not comments:
            continue
        first = comments[0]
        if first.get("author", {}).get("__typename") == "Bot":
            first_body = first.get("body", "")
            result.append({
                "thread_id": thread.get("id"),
                "path": thread.get("path"),
                "line": thread.get("line"),
                "first_comment_body": first_body,
                "first_comment_author": first.get("author", {}).get("login", ""),
                "comment_count": len(comments),
                "severity": parse_severity(first_body),
            })
    return result


def find_unhandled_bot_mentions(
    owner: str, repo: str, pr: int
) -> list[BotMention]:
    """
    Scan for unhandled @bot mentions in:
      1. Inline review threads (GraphQL)
      2. Issue/PR-level comments (REST API)

    Dedup: a @bot mention is handled if a subsequent note/comment starts with '[from bot]'.
    """
    mentions: list[BotMention] = []

    # --- 1. Inline review threads ---
    query = (
        f'query {{ repository(owner: "{owner}", name: "{repo}") {{ '
        f'pullRequest(number: {pr}) {{ '
        f'reviewThreads(first: 100) {{ nodes {{ '
        f'id isResolved path line '
        f'comments(first: 50) {{ nodes {{ '
        f'databaseId body createdAt author {{ login __typename }} '
        f'}} }} }} }} }} }} }}'
    )
    data = gh_graphql(query)
    if data:
        threads = (
            data.get("data", {})
            .get("repository", {})
            .get("pullRequest", {})
            .get("reviewThreads", {})
            .get("nodes", [])
        )
        for thread in threads:
            if thread.get("isResolved"):
                continue
            comments = thread.get("comments", {}).get("nodes", [])
            for i, comment in enumerate(comments):
                body = comment.get("body", "")
                if body.startswith("[from bot]"):
                    continue
                author_type = comment.get("author", {}).get("__typename", "")
                if author_type == "Bot":
                    continue
                if "@bot" not in body.lower():
                    continue
                handled = any(
                    later.get("body", "").startswith("[from bot]")
                    for later in comments[i + 1 :]
                )
                if not handled:
                    mentions.append(BotMention(
                        source="inline_thread",
                        comment_body=body,
                        comment_id=comment.get("databaseId", 0),
                        author=comment.get("author", {}).get("login", "unknown"),
                        file_path=thread.get("path"),
                        line=thread.get("line"),
                        thread_id=thread.get("id"),
                    ))

    # --- 2. Issue/PR-level comments ---
    all_issue_comments: list[dict] = []
    page = 1
    while True:
        comments_data, rc = gh_api(
            f"repos/{owner}/{repo}/issues/{pr}/comments?per_page=100&page={page}"
        )
        if rc != 0 or not comments_data or not isinstance(comments_data, list):
            break
        all_issue_comments.extend(comments_data)
        if len(comments_data) < 100:
            break
        page += 1

    for i, comment in enumerate(all_issue_comments):
        body = comment.get("body", "")
        if body.startswith("[from bot]"):
            continue
        if "@bot" not in body.lower():
            continue
        handled = any(
            later.get("body", "").startswith("[from bot]")
            for later in all_issue_comments[i + 1 :]
        )
        if not handled:
            mentions.append(BotMention(
                source="issue_comment",
                comment_body=body,
                comment_id=comment.get("id"),
                author=comment.get("user", {}).get("login", "unknown"),
            ))

    return mentions


# ---------------------------------------------------------------------------
# pr_status.json
# ---------------------------------------------------------------------------

def write_pr_status(
    wf_dir: Path,
    *,
    pr_state: str | None,
    ci: dict,
    rebase_needed: bool,
    bot_review_threads: list[dict],
    mentions: list[BotMention],
) -> None:
    """Write pr_status.json to WF_DIR."""
    status = {
        "pr_state": pr_state,
        "ci": ci,
        "rebase_needed": rebase_needed,
        "bot_review_threads": bot_review_threads,
        "mentions": [asdict(m) for m in mentions],
    }
    wf_dir.mkdir(parents=True, exist_ok=True)
    (wf_dir / "pr_status.json").write_text(json.dumps(status, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def poll_once(
    owner: str, repo: str, pr: int, target: str, wf_dir: Path
) -> str | None:
    """
    Run a single poll cycle. Writes pr_status.json every cycle.
    Returns a RESULT string if an exit condition is met, or None to continue.
    """
    # 1. PR state
    pr_state = check_pr_state(owner, repo, pr)

    # 2. CI status
    ci = check_ci(pr, owner, repo)

    # 3. Target branch
    rebase_needed = check_target_branch_updated(target)

    # 4. Bot review threads
    bot_review_threads = fetch_bot_review_threads(owner, repo, pr)

    # 5. @bot mentions
    mentions = find_unhandled_bot_mentions(owner, repo, pr)

    # Write status file every cycle
    write_pr_status(
        wf_dir,
        pr_state=pr_state,
        ci=ci,
        rebase_needed=rebase_needed,
        bot_review_threads=bot_review_threads,
        mentions=mentions,
    )

    # --- Evaluate exit conditions (priority order) ---

    # 1. Terminal states
    if pr_state == "MERGED":
        return "RESULT: PR merged"
    if pr_state == "CLOSED":
        return "RESULT: PR closed"

    # 2. Rebase (highest operational priority)
    if rebase_needed:
        print(f"[poll] target branch '{target}' has new commits", flush=True)
        return "RESULT: needs rebase"

    # 3. CI failures (only when ALL checks finished AND has failures)
    if ci["status"] == "finished":
        has_failure = any(c.get("bucket") == "fail" for c in ci.get("checks", []))
        if has_failure:
            return "RESULT: needs fix"

    # 4. Address (blocker bot reviews or @bot mentions)
    has_blocker = any(t.get("severity") == "blocker" for t in bot_review_threads)
    if has_blocker or mentions:
        for m in mentions:
            # Add 👀 reaction (visual: "I see this")
            if m.source == "issue_comment":
                run(f"gh api repos/{owner}/{repo}/issues/comments/{m.comment_id}/reactions -f content='eyes'")
            print(f"\n[poll] Unhandled @bot mention:", flush=True)
            print(f"  source: {m.source}", flush=True)
            print(f"  author: {m.author}", flush=True)
            print(f"  comment_id: {m.comment_id}", flush=True)
            if m.file_path:
                print(f"  file: {m.file_path}:{m.line}", flush=True)
            if m.thread_id:
                print(f"  thread_id: {m.thread_id}", flush=True)
            body_preview = m.comment_body[:500]
            if len(m.comment_body) > 500:
                body_preview += "..."
            print(f"  body: {body_preview}", flush=True)
        return "RESULT: needs address"

    # All clear — continue polling
    print(
        f"[poll] PR #{pr} state={pr_state} CI={ci['status']} "
        f"reviews={len(bot_review_threads)} mentions=0",
        flush=True,
    )
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll a GitHub PR for pr-lifecycle events")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("pr", type=int, help="PR number")
    parser.add_argument("--target", default="main", help="Target branch (default: main)")
    parser.add_argument("--interval", type=int, default=20, help="Poll interval in seconds (default: 20)")
    parser.add_argument("--wf-dir", required=True, help="Workflow directory (WF_DIR) for pr_status.json")
    args = parser.parse_args()

    wf_dir = Path(os.path.expanduser(args.wf_dir))

    print(f"[poll] Starting poll for {args.owner}/{args.repo}#{args.pr} "
          f"(target={args.target}, interval={args.interval}s, wf_dir={wf_dir})", flush=True)

    result = poll_once(args.owner, args.repo, args.pr, args.target, wf_dir)
    if result:
        print(result, flush=True)
        sys.exit(0)

    while True:
        time.sleep(args.interval)
        result = poll_once(args.owner, args.repo, args.pr, args.target, wf_dir)
        if result:
            print(result, flush=True)
            sys.exit(0)


if __name__ == "__main__":
    main()
