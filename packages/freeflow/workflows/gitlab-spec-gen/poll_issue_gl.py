#!/usr/bin/env python3
"""Poll a GitLab issue for new comments (notes) from a specific user.

Usage:
    poll_issue_gl.py <project_path> <iid> <creator_username>
        --run-id <run_id> [--interval <seconds>] [--wf-dir <path>]
        [--hostname <host>]

The script polls the issue's notes and, when new notes arrive,
fetches and filters them. Only notes from <creator_username> are reported.

Output:
    Prints "NEW_COMMENT: <body>" for each new note from the creator.
    Reacts with :eyes: to every new note (regardless of author).

State:
    Persists the last-seen note count in <wf-dir>/comment_count
    (or ~/.freeflow/runs/<run_id>/comment_count if --wf-dir is not set).
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path


def glab_api(
    endpoint: str,
    method: str = "GET",
    fields: list[tuple[str, str]] | None = None,
    hostname: str | None = None,
    paginate: bool = False,
) -> str:
    """Call the GitLab API via glab."""
    cmd = ["glab", "api", endpoint]
    if method != "GET":
        cmd += ["-X", method]
    if fields:
        for key, value in fields:
            cmd += ["-f", f"{key}={value}"]
    if paginate:
        cmd.append("--paginate")
    if hostname:
        cmd += ["--hostname", hostname]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"[poll] glab api error: {result.stderr.strip()}", file=sys.stderr)
        return ""
    return result.stdout.strip()


def react_eyes(
    project_path_encoded: str,
    iid: int,
    note_id: int,
    hostname: str | None = None,
) -> None:
    """Add :eyes: emoji reaction to a note."""
    glab_api(
        f"projects/{project_path_encoded}/issues/{iid}/notes/{note_id}/award_emoji",
        method="POST",
        fields=[("name", "eyes")],
        hostname=hostname,
    )


def get_notes(
    project_path_encoded: str,
    iid: int,
    hostname: str | None = None,
) -> list[dict]:
    """Fetch all notes for an issue, sorted by creation date ascending."""
    raw = glab_api(
        f"projects/{project_path_encoded}/issues/{iid}/notes?sort=asc&order_by=created_at",
        hostname=hostname,
        paginate=True,
    )
    if not raw:
        return []
    # glab --paginate may return a JSON array or multiple JSON arrays
    notes: list[dict] = []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            notes = parsed
        else:
            notes = [parsed]
    except json.JSONDecodeError:
        # Try line-by-line (multiple JSON arrays concatenated)
        for line in raw.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
                if isinstance(parsed, list):
                    notes.extend(parsed)
                else:
                    notes.append(parsed)
            except json.JSONDecodeError:
                continue
    # Filter out system notes (e.g. label changes, assignments)
    return [n for n in notes if not n.get("system", False)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll GitLab issue for new notes")
    parser.add_argument("project_path", help="GitLab project path (e.g. group/project)")
    parser.add_argument("iid", type=int, help="Issue IID")
    parser.add_argument("creator_username", help="Issue creator username to filter for")
    parser.add_argument("--run-id", required=True, help="FSM run ID")
    parser.add_argument("--interval", type=int, default=1, help="Poll interval in seconds")
    parser.add_argument("--wf-dir", help="Workflow directory (default: ~/.freeflow/runs/<run_id>)")
    parser.add_argument(
        "--hostname",
        default=None,
        help="GitLab hostname (e.g. gitlab.corp.metabit-trading.com)",
    )
    args = parser.parse_args()

    # URL-encode the project path for API calls
    project_path_encoded = urllib.parse.quote(args.project_path, safe="")

    wf_dir = Path(args.wf_dir) if args.wf_dir else Path.home() / ".freeflow" / "runs" / args.run_id
    count_file = wf_dir / "comment_count"

    # Read persisted count or fetch current
    if count_file.exists():
        last_count = int(count_file.read_text().strip())
    else:
        notes = get_notes(project_path_encoded, args.iid, hostname=args.hostname)
        last_count = len(notes)
        wf_dir.mkdir(parents=True, exist_ok=True)
        count_file.write_text(str(last_count))

    print(
        f"[poll] Polling {args.project_path}#{args.iid} "
        f"for notes from {args.creator_username} (last_count={last_count}, interval={args.interval}s)",
        file=sys.stderr,
    )

    while True:
        all_notes = get_notes(project_path_encoded, args.iid, hostname=args.hostname)
        new_count = len(all_notes)

        if new_count > last_count:
            new_notes = all_notes[last_count:]

            has_user_comment = False
            for note in new_notes:
                body: str = note.get("body", "")
                # Skip bot replies and bot-posted artifact comments
                if body.startswith("[bot reply]") or body.startswith("[from bot]"):
                    continue
                if body.startswith("## ") and body.split("\n", 1)[0].rstrip() in (
                    "## requirements.md",
                    "## design.md",
                    "## plan.md",
                    "## e2e.md",
                    "## Checkpoint Summary",
                    "## Spec Complete!",
                ) or body.startswith("## research/"):
                    continue

                # React with :eyes: to user comments
                note_id = note["id"]
                react_eyes(project_path_encoded, args.iid, note_id, hostname=args.hostname)

                # Only report comments from the creator
                author_username = note.get("author", {}).get("username", "")
                if author_username == args.creator_username:
                    print(f"NEW_COMMENT: {body}")
                    sys.stdout.flush()
                    has_user_comment = True

            # Persist new count
            last_count = new_count
            count_file.write_text(str(new_count))

            # Only exit if we found a real user comment
            if has_user_comment:
                break

        time.sleep(args.interval)


if __name__ == "__main__":
    main()
