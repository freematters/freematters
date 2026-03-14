#!/usr/bin/env python3
"""
Poll script for pr-lifecycle.

Monitors a GitHub PR for events and prints RESULT lines for the FSM agent to act on.
The agent cannot generate replies — this script only detects events and exits.

Usage:
    python3 poll_pr.py <owner> <repo> <pr_number> [--target <branch>] [--interval <seconds>]

Exit RESULT lines:
    RESULT: PR merged
    RESULT: PR closed
    RESULT: pipelines finished
    RESULT: bot mention <type>    (type: conversational | code-change)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field


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
    # Use -f query= so we don't need to escape
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


def check_ci(pr: int, owner: str, repo: str) -> str:
    """
    Return CI status:
      'pending'  — at least one check still running
      'finished' — all checks done (pass or fail)
      'none'     — no checks found
    """
    out, rc = run(f"gh pr checks {pr} -R {owner}/{repo} --json name,state,bucket 2>/dev/null")
    if rc != 0 or not out:
        return "none"
    try:
        checks = json.loads(out)
    except json.JSONDecodeError:
        return "none"
    if not checks:
        return "none"
    if any(c.get("state") == "PENDING" for c in checks):
        return "pending"
    return "finished"


def check_target_branch_updated(target: str) -> bool:
    """Return True if the target branch has commits ahead of HEAD."""
    run(f"git fetch origin {target} --quiet")
    out, _ = run(f"git rev-list --count HEAD..origin/{target}")
    try:
        return int(out) > 0
    except (ValueError, TypeError):
        return False


def find_unhandled_bot_mentions(
    owner: str, repo: str, pr: int
) -> list[BotMention]:
    """
    Scan for unhandled @bot mentions in:
      1. Inline review threads (GraphQL)
      2. Issue/PR-level comments (REST API)

    Dedup rules:
      - Inline threads: a mention is handled if a subsequent note starts with '[from bot]'
      - Issue comments: a mention is handled if a ✅ reaction from any user exists
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
            # Walk comments in order looking for unhandled @bot mentions
            for i, comment in enumerate(comments):
                body = comment.get("body", "")
                author_type = comment.get("author", {}).get("__typename", "")
                # Skip bot-authored comments
                if author_type == "Bot":
                    continue
                if "@bot" not in body.lower():
                    continue
                # Check if any subsequent comment starts with [from bot]
                handled = False
                for later in comments[i + 1 :]:
                    if later.get("body", "").startswith("[from bot]"):
                        handled = True
                        break
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
    # Fetch all issue comments and check for unhandled @bot mentions.
    # Dedup: a @bot comment is handled if a subsequent comment starts with [from bot].
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
        if "@bot" not in body.lower():
            continue
        # Check if any subsequent comment starts with [from bot]
        handled = False
        for later in all_issue_comments[i + 1 :]:
            if later.get("body", "").startswith("[from bot]"):
                handled = True
                break
        if not handled:
            mentions.append(BotMention(
                source="issue_comment",
                comment_body=body,
                comment_id=comment.get("id"),
                author=comment.get("user", {}).get("login", "unknown"),
            ))

    return mentions


# Code-change intent detection keywords
_CODE_CHANGE_VERBS = re.compile(
    r"\b(fix|add|remove|delete|change|update|refactor|rename|replace|rewrite|move|"
    r"extract|inline|implement|create|modify|convert|migrate|swap|introduce|insert)\b",
    re.IGNORECASE,
)
_CONVERSATIONAL_PATTERNS = re.compile(
    r"\b(why|how|what|explain|describe|clarify|tell me|can you explain|"
    r"what does|what is|how does|how do|could you)\b",
    re.IGNORECASE,
)


def classify_mention(mention: BotMention) -> str:
    """
    Classify a @bot mention as 'conversational' or 'code-change'.

    Priority: if the comment references specific code/files/lines, prefer code-change.
    If it asks why/how questions without requesting modification, prefer conversational.
    """
    body = mention.comment_body

    # If it's on an inline thread with a file path and has action verbs → code-change
    if mention.source == "inline_thread" and mention.file_path:
        if _CODE_CHANGE_VERBS.search(body):
            return "code-change"

    # Pure questions without action verbs → conversational
    if _CONVERSATIONAL_PATTERNS.search(body) and not _CODE_CHANGE_VERBS.search(body):
        return "conversational"

    # Has action verbs → code-change
    if _CODE_CHANGE_VERBS.search(body):
        return "code-change"

    # Default to conversational
    return "conversational"


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def poll_once(owner: str, repo: str, pr: int, target: str) -> str | None:
    """
    Run a single poll cycle. Returns a RESULT string if an exit condition is met,
    or None to continue polling.
    """
    # 1. PR state
    state = check_pr_state(owner, repo, pr)
    if state == "MERGED":
        return "RESULT: PR merged"
    if state == "CLOSED":
        return "RESULT: PR closed"

    # 2. CI status
    ci = check_ci(pr, owner, repo)
    if ci == "finished":
        return "RESULT: pipelines finished"

    # 3. Target branch updated
    if check_target_branch_updated(target):
        print(f"[poll] target branch '{target}' has new commits", flush=True)
        return "RESULT: pipelines finished"

    # 4. @bot mentions
    mentions = find_unhandled_bot_mentions(owner, repo, pr)
    if mentions:
        for m in mentions:
            intent = classify_mention(m)
            # Add 👀 reaction (visual: "I see this")
            if m.source == "issue_comment":
                run(f"gh api repos/{owner}/{repo}/issues/comments/{m.comment_id}/reactions -f content='eyes'")
            print(f"\n[poll] Unhandled @bot mention ({intent}):", flush=True)
            print(f"  source: {m.source}", flush=True)
            print(f"  author: {m.author}", flush=True)
            print(f"  comment_id: {m.comment_id}", flush=True)
            if m.file_path:
                print(f"  file: {m.file_path}:{m.line}", flush=True)
            if m.thread_id:
                print(f"  thread_id: {m.thread_id}", flush=True)
            # Truncate very long bodies for readability
            body_preview = m.comment_body[:500]
            if len(m.comment_body) > 500:
                body_preview += "..."
            print(f"  body: {body_preview}", flush=True)

        # Check if any are code-change
        has_code_change = any(classify_mention(m) == "code-change" for m in mentions)
        if has_code_change:
            return "RESULT: bot mention code-change"
        return "RESULT: bot mention conversational"

    # Nothing to report
    print(
        f"[poll] PR #{pr} state={state} CI={ci} mentions=0",
        flush=True,
    )
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll a GitHub PR for mr-lifecycle events")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("pr", type=int, help="PR number")
    parser.add_argument("--target", default="main", help="Target branch (default: main)")
    parser.add_argument("--interval", type=int, default=20, help="Poll interval in seconds (default: 20)")
    args = parser.parse_args()

    # Initial inline poll to verify connectivity
    print(f"[poll] Starting poll for {args.owner}/{args.repo}#{args.pr} "
          f"(target={args.target}, interval={args.interval}s)", flush=True)

    result = poll_once(args.owner, args.repo, args.pr, args.target)
    if result:
        print(result, flush=True)
        sys.exit(0)

    # Background loop
    while True:
        time.sleep(args.interval)
        result = poll_once(args.owner, args.repo, args.pr, args.target)
        if result:
            print(result, flush=True)
            sys.exit(0)


if __name__ == "__main__":
    main()
