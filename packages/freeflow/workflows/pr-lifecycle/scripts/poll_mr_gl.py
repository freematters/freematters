#!/usr/bin/env python3
"""
Poll script for gitlab-mr-lifecycle.

Monitors a GitLab MR for events and prints RESULT lines for the FSM agent to act on.
Writes mr_status.json to WF_DIR on every cycle for other states to consume.

Usage:
    python3 poll_mr_gl.py <project_path> <mr_iid> --wf-dir <path>
        [--target <branch>] [--interval <seconds>] [--hostname <host>] [--once]

Exit RESULT lines:
    RESULT: MR merged
    RESULT: MR closed
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
import urllib.parse
from dataclasses import asdict, dataclass
from pathlib import Path

# Cache of note IDs that already have rocket emoji (handled).
# Persists across poll cycles to avoid redundant API calls.
_handled_note_cache: set[int] = set()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run(cmd: list[str]) -> tuple[str, int]:
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip(), r.returncode


def glab_api(
    endpoint: str,
    *,
    hostname: str | None = None,
    method: str | None = None,
    fields: list[tuple[str, str]] | None = None,
) -> tuple[dict | list | None, int]:
    """Call glab api and return parsed JSON."""
    cmd = ["glab", "api"]
    if hostname:
        cmd += ["--hostname", hostname]
    if method:
        cmd += ["-X", method]
    if fields:
        for key, value in fields:
            cmd += ["-f", f"{key}={value}"]
    cmd.append(endpoint)
    out, rc = run(cmd)
    if rc != 0 or not out:
        return None, rc
    try:
        return json.loads(out), 0
    except json.JSONDecodeError:
        return None, 1


def encode_project(project_path: str) -> str:
    """URL-encode a GitLab project path for use in API endpoints."""
    return urllib.parse.quote(project_path, safe="")


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class BotMention:
    """An unhandled @bot mention found during polling."""
    source: str          # "discussion" or "note"
    comment_body: str    # full text of the note
    note_id: int         # note ID
    author: str          # who wrote the note
    file_path: str | None = None   # for inline discussions
    line: int | None = None        # for inline discussions
    discussion_id: str | None = None  # discussion ID for threaded replies


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_mr_state(
    project_path: str, mr_iid: int, hostname: str | None = None
) -> dict | None:
    """Fetch MR object and return it, or None on error."""
    encoded = encode_project(project_path)
    data, rc = glab_api(
        f"projects/{encoded}/merge_requests/{mr_iid}",
        hostname=hostname,
    )
    if rc != 0 or not isinstance(data, dict):
        return None
    return data


def extract_pipeline_status(mr_data: dict) -> str:
    """Extract pipeline status from MR data.

    Returns: success/failed/running/pending/none
    """
    pipeline = mr_data.get("head_pipeline")
    if not pipeline:
        return "none"
    return pipeline.get("status", "none")


def extract_needs_rebase(mr_data: dict) -> bool:
    """Check if MR needs rebase from detailed_merge_status."""
    status = mr_data.get("detailed_merge_status", "")
    # GitLab uses "need_rebase" as the detailed_merge_status value
    return status == "need_rebase"


def check_target_branch_updated(target: str) -> bool:
    """Return True if the target branch has commits ahead of HEAD."""
    run(["git", "fetch", "origin", target, "--quiet"])
    out, _ = run(["git", "rev-list", "--count", f"HEAD..origin/{target}"])
    try:
        return int(out) > 0
    except (ValueError, TypeError):
        return False


def fetch_discussions(
    project_path: str, mr_iid: int, hostname: str | None = None
) -> list[dict]:
    """Fetch all MR discussions (threaded comments)."""
    encoded = encode_project(project_path)
    data, rc = glab_api(
        f"projects/{encoded}/merge_requests/{mr_iid}/discussions",
        hostname=hostname,
    )
    if rc != 0 or not isinstance(data, list):
        return []
    return data


def extract_unresolved_discussions(discussions: list[dict]) -> list[dict]:
    """Extract unresolved discussion threads with metadata."""
    result = []
    for disc in discussions:
        notes = disc.get("notes", [])
        if not notes:
            continue
        # Individual notes (not threads) don't have resolvable flag
        first_note = notes[0]
        if not first_note.get("resolvable", False):
            continue
        if first_note.get("resolved", False):
            continue

        # Check if already addressed — a [from bot] reply means lifecycle handled it
        has_bot_reply = any(
            n.get("body", "").startswith("[from bot]")
            for n in notes[1:]
        )
        if has_bot_reply:
            continue

        first_body = first_note.get("body", "")
        result.append({
            "discussion_id": disc.get("id"),
            "path": first_note.get("position", {}).get("new_path")
            or first_note.get("position", {}).get("old_path"),
            "line": first_note.get("position", {}).get("new_line")
            or first_note.get("position", {}).get("old_line"),
            "first_note_body": first_body,
            "first_note_author": first_note.get("author", {}).get("username", ""),
            "note_count": len(notes),
            "severity": parse_severity(first_body),
        })
    return result


def parse_severity(body: str) -> str:
    """
    Parse severity from a review comment body.

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


def find_unhandled_bot_mentions(
    project_path: str,
    mr_iid: int,
    discussions: list[dict],
    hostname: str | None = None,
) -> list[BotMention]:
    """
    Scan for unhandled @bot mentions in:
      1. Discussion threads (inline and MR-level)
      2. Standalone MR notes

    Dedup:
      - Discussions: handled if a subsequent note starts with '[from bot]'
      - Standalone notes: handled if the note has a rocket award emoji
    """
    mentions: list[BotMention] = []

    # --- 1. Discussion threads ---
    for disc in discussions:
        notes = disc.get("notes", [])
        for i, note in enumerate(notes):
            body = note.get("body", "")
            if body.startswith("[from bot]"):
                continue
            if "@bot" not in body.lower():
                continue
            # Check if already handled by a later [from bot] reply
            handled = any(
                later.get("body", "").startswith("[from bot]")
                for later in notes[i + 1:]
            )
            if not handled:
                position = note.get("position", {})
                mentions.append(BotMention(
                    source="discussion",
                    comment_body=body,
                    note_id=note.get("id", 0),
                    author=note.get("author", {}).get("username", "unknown"),
                    file_path=position.get("new_path") or position.get("old_path"),
                    line=position.get("new_line") or position.get("old_line"),
                    discussion_id=disc.get("id"),
                ))

    # --- 2. Standalone MR notes (not in discussions) ---
    encoded = encode_project(project_path)
    notes_data, rc = glab_api(
        f"projects/{encoded}/merge_requests/{mr_iid}/notes?sort=asc&per_page=100",
        hostname=hostname,
    )
    if rc == 0 and isinstance(notes_data, list):
        # Collect note IDs already seen in discussions to avoid duplicates
        discussion_note_ids: set[int] = set()
        for disc in discussions:
            for note in disc.get("notes", []):
                discussion_note_ids.add(note.get("id", 0))

        for note in notes_data:
            note_id = note.get("id", 0)
            if note_id in discussion_note_ids:
                continue
            body = note.get("body", "")
            if body.startswith("[from bot]"):
                continue
            if "@bot" not in body.lower():
                continue

            # Check for rocket emoji as dedup signal (cached)
            if note_id in _handled_note_cache:
                continue
            emoji_data, _ = glab_api(
                f"projects/{encoded}/merge_requests/{mr_iid}/notes/{note_id}/award_emoji",
                hostname=hostname,
            )
            has_rocket = False
            if isinstance(emoji_data, list):
                has_rocket = any(e.get("name") == "rocket" for e in emoji_data)
            if has_rocket:
                _handled_note_cache.add(note_id)
                continue

            mentions.append(BotMention(
                source="note",
                comment_body=body,
                note_id=note_id,
                author=note.get("author", {}).get("username", "unknown"),
            ))

    return mentions


def react_eyes_to_note(
    project_path: str,
    mr_iid: int,
    note_id: int,
    hostname: str | None = None,
) -> None:
    """Add eyes emoji reaction to a MR note."""
    encoded = encode_project(project_path)
    glab_api(
        f"projects/{encoded}/merge_requests/{mr_iid}/notes/{note_id}/award_emoji",
        hostname=hostname,
        method="POST",
        fields=[("name", "eyes")],
    )


# ---------------------------------------------------------------------------
# mr_status.json
# ---------------------------------------------------------------------------

def write_mr_status(
    wf_dir: Path,
    *,
    state: str | None,
    pipeline_status: str,
    needs_rebase: bool,
    discussions: list[dict],
    bot_mentions: list[BotMention],
) -> None:
    """Write mr_status.json to WF_DIR."""
    status = {
        "state": state,
        "pipeline_status": pipeline_status,
        "needs_rebase": needs_rebase,
        "discussions": discussions,
        "bot_mentions": [asdict(m) for m in bot_mentions],
    }
    wf_dir.mkdir(parents=True, exist_ok=True)
    (wf_dir / "mr_status.json").write_text(json.dumps(status, indent=2) + "\n")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def poll_once(
    project_path: str,
    mr_iid: int,
    target: str,
    wf_dir: Path,
    hostname: str | None = None,
) -> str | None:
    """
    Run a single poll cycle. Writes mr_status.json every cycle.
    Returns a RESULT string if an exit condition is met, or None to continue.
    """
    # 1. MR state
    mr_data = check_mr_state(project_path, mr_iid, hostname=hostname)
    if mr_data is None:
        print("[poll] Failed to fetch MR data", flush=True)
        return None

    mr_state = mr_data.get("state", "opened")

    # 2. Pipeline status
    pipeline_status = extract_pipeline_status(mr_data)

    # 3. Rebase needed — check both GitLab status and local git
    needs_rebase = extract_needs_rebase(mr_data) or check_target_branch_updated(target)

    # 4. Discussions (threaded comments)
    raw_discussions = fetch_discussions(project_path, mr_iid, hostname=hostname)
    unresolved_discussions = extract_unresolved_discussions(raw_discussions)

    # 5. @bot mentions
    bot_mentions = find_unhandled_bot_mentions(
        project_path, mr_iid, raw_discussions, hostname=hostname
    )

    # Write status file every cycle
    write_mr_status(
        wf_dir,
        state=mr_state,
        pipeline_status=pipeline_status,
        needs_rebase=needs_rebase,
        discussions=unresolved_discussions,
        bot_mentions=bot_mentions,
    )

    # --- Evaluate exit conditions (priority order) ---

    # 1. Terminal states
    if mr_state == "merged":
        return "RESULT: MR merged"
    if mr_state == "closed":
        return "RESULT: MR closed"

    # 2. Rebase (highest operational priority)
    if needs_rebase:
        print(f"[poll] target branch '{target}' has new commits or MR needs rebase", flush=True)
        return "RESULT: needs rebase"

    # 3. Pipeline failures (only when pipeline finished with failure)
    if pipeline_status == "failed":
        return "RESULT: needs fix"

    # 4. Address (blocker discussions or @bot mentions)
    has_blocker = any(d.get("severity") == "blocker" for d in unresolved_discussions)
    if has_blocker or bot_mentions:
        for m in bot_mentions:
            # Add eyes reaction on detection
            react_eyes_to_note(project_path, mr_iid, m.note_id, hostname=hostname)
            print(f"\n[poll] Unhandled @bot mention:", flush=True)
            print(f"  source: {m.source}", flush=True)
            print(f"  author: {m.author}", flush=True)
            print(f"  note_id: {m.note_id}", flush=True)
            if m.file_path:
                print(f"  file: {m.file_path}:{m.line}", flush=True)
            if m.discussion_id:
                print(f"  discussion_id: {m.discussion_id}", flush=True)
            body_preview = m.comment_body[:500]
            if len(m.comment_body) > 500:
                body_preview += "..."
            print(f"  body: {body_preview}", flush=True)
        return "RESULT: needs address"

    # All clear -- continue polling
    print(
        f"[poll] MR !{mr_iid} state={mr_state} pipeline={pipeline_status} "
        f"discussions={len(unresolved_discussions)} mentions={len(bot_mentions)}",
        flush=True,
    )
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Poll a GitLab MR for gitlab-mr-lifecycle events"
    )
    parser.add_argument("project_path", help="GitLab project path (e.g., group/project)")
    parser.add_argument("mr_iid", type=int, help="MR iid (project-scoped)")
    parser.add_argument("--target", default="main", help="Target branch (default: main)")
    parser.add_argument(
        "--interval", type=int, default=20,
        help="Poll interval in seconds (default: 20)",
    )
    parser.add_argument(
        "--wf-dir", required=True,
        help="Workflow directory (WF_DIR) for mr_status.json",
    )
    parser.add_argument(
        "--run-id",
        help="FSM run ID (used for state persistence if --wf-dir not set)",
    )
    parser.add_argument(
        "--hostname",
        help="GitLab hostname for self-hosted instances (e.g., gitlab.corp.example.com)",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="Run a single poll cycle and exit (writes mr_status.json, prints RESULT if any)",
    )
    args = parser.parse_args()

    wf_dir = Path(os.path.expanduser(args.wf_dir))

    if args.once:
        result = poll_once(
            args.project_path, args.mr_iid, args.target, wf_dir,
            hostname=args.hostname,
        )
        if result:
            print(result, flush=True)
        sys.exit(0)

    print(
        f"[poll] Starting poll for {args.project_path}!{args.mr_iid} "
        f"(target={args.target}, interval={args.interval}s, wf_dir={wf_dir})",
        flush=True,
    )

    result = poll_once(
        args.project_path, args.mr_iid, args.target, wf_dir,
        hostname=args.hostname,
    )
    if result:
        print(result, flush=True)
        sys.exit(0)

    while True:
        time.sleep(args.interval)
        result = poll_once(
            args.project_path, args.mr_iid, args.target, wf_dir,
            hostname=args.hostname,
        )
        if result:
            print(result, flush=True)
            sys.exit(0)


if __name__ == "__main__":
    main()
