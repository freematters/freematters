# PR polling script for pr-lifecycle workflow
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

def run(cmd: list[str]) -> tuple[str, int]:
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode


def gh_api(endpoint: str) -> tuple[dict | list | None, int]:
    out, rc = run(["gh", "api", endpoint])
    if rc != 0 or not out:
        return None, rc
    try:
        return json.loads(out), 0
    except json.JSONDecodeError:
        return None, 1


def gh_graphql(query: str) -> dict | None:
    out, rc = run(["gh", "api", "graphql", "-f", f"query={query}"])
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
    out, rc = run(["gh", "pr", "view", str(pr), "-R", f"{owner}/{repo}", "--json", "state", "-q", ".state"])
    return out if rc == 0 else None


def check_ci(pr: int, owner: str, repo: str) -> dict:
    """
    Return CI status dict:
      { "status": "pending"|"finished"|"none", "checks": [...] }
    """
    out, rc = run(["gh", "pr", "checks", str(pr), "-R", f"{owner}/{repo}", "--json", "name,state,bucket"])
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
    run(["git", "fetch", "origin", target, "--quiet"])
    out, _ = run(["git", "rev-list", "--count", f"HEAD..origin/{target}"])
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


def fetch_review_threads_raw(owner: str, repo: str, pr: int) -> list[dict]:
    """Fetch all review threads with full comments via GraphQL (single round-trip)."""
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
    return (
        data.get("data", {})
        .get("repository", {})
        .get("pullRequest", {})
        .get("reviewThreads", {})
        .get("nodes", [])
    )


def extract_bot_review_threads(threads: list[dict]) -> list[dict]:
    """Extract unresolved bot-authored review threads with severity from raw threads."""
    result = []
    for thread in threads:
        if thread.get("isResolved"):
            continue
        comments = thread.get("comments", {}).get("nodes", [])
        if not comments:
            continue
        first = comments[0]
        if first.get("author", {}).get("__typename") == "Bot":
            # Skip if already addressed — a [from bot] reply means pr-lifecycle handled it
            has_bot_reply = any(
                c.get("body", "").startswith("[from bot]")
                for c in comments[1:]
            )
            if has_bot_reply:
                continue
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
    owner: str, repo: str, pr: int, threads: list[dict] | None = None
) -> list[BotMention]:
    """
    Scan for unhandled @bot mentions in:
      1. Inline review threads (from pre-fetched threads)
      2. Issue/PR-level comments (REST API)

    Dedup:
      - Inline threads: handled if a subsequent note starts with '[from bot]'
      - Issue comments: handled if the comment has a 🚀 (rocket) reaction
    """
    mentions: list[BotMention] = []

    # --- 1. Inline review threads ---
    if threads is None:
        threads = fetch_review_threads_raw(owner, repo, pr)
    if threads:
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

    # For issue comments, dedup via 👍 (+1) reaction on the comment.
    # Unlike review threads, issue comments are flat — [from bot] reply pairing
    # doesn't work because replies aren't linked to specific mentions.
    for comment in all_issue_comments:
        body = comment.get("body", "")
        if body.startswith("[from bot]"):
            continue
        # Skip bot-authored comments (e.g., code-review summary containing @bot)
        if comment.get("user", {}).get("type") == "Bot":
            continue
        if "@bot" not in body.lower():
            continue
        # Check for 🚀 (rocket) reaction as dedup signal (added by push state)
        reactions = comment.get("reactions", {})
        if reactions.get("rocket", 0) > 0:
            continue
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

    # 4. Fetch review threads once (shared by bot review + @bot mention detection)
    raw_threads = fetch_review_threads_raw(owner, repo, pr)
    bot_review_threads = extract_bot_review_threads(raw_threads)

    # 5. @bot mentions
    mentions = find_unhandled_bot_mentions(owner, repo, pr, threads=raw_threads)

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
            # Add 👀 (eyes) reaction on detection
            if m.source == "issue_comment":
                run(["gh", "api", f"repos/{owner}/{repo}/issues/comments/{m.comment_id}/reactions", "-f", "content=eyes"])
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
        f"reviews={len(bot_review_threads)} mentions={len(mentions)}",
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
    parser.add_argument("--once", action="store_true", help="Run a single poll cycle and exit (writes pr_status.json, prints RESULT if any)")
    args = parser.parse_args()

    wf_dir = Path(os.path.expanduser(args.wf_dir))

    if args.once:
        result = poll_once(args.owner, args.repo, args.pr, args.target, wf_dir)
        if result:
            print(result, flush=True)
        sys.exit(0)

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
