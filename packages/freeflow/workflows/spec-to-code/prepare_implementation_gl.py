#!/usr/bin/env python3
"""Prepare a GitLab issue for implementation.

Usage:
    prepare_implementation_gl.py <project_path> <iid> <slug>

What it does:
    1. Creates a working branch: issue-<iid>-<slug>
    2. Adds the "doing" label to the issue via glab api
    3. Posts a [from bot] note announcing implementation start

Outputs (JSON to stdout):
    { "branch_name": "issue-41-my-feature", "slug": "my-feature" }

Uses `glab api` for all GitLab API interactions.
Requires GITLAB_TOKEN env var or `glab auth login`.
"""

import argparse
import json
import subprocess
import sys
from urllib.parse import quote as url_quote


def run(cmd: str) -> str:
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def detect_hostname() -> str | None:
    """Auto-detect GitLab hostname from git remote origin URL."""
    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            url = result.stdout.strip()
            # SSH: git@hostname:path
            if "@" in url and "://" not in url:
                return url.split("@")[1].split(":")[0]
            # HTTPS: https://hostname/path
            if "://" in url:
                return url.split("://")[1].split("/")[0]
    except Exception:
        pass
    return None


_hostname: str | None = None


def glab_api(method: str, endpoint: str, fields: dict[str, str] | None = None) -> str:
    cmd = ["glab", "api"]
    if _hostname:
        cmd += ["--hostname", _hostname]
    if method != "GET":
        cmd += ["-X", method]
    cmd.append(endpoint)
    if fields:
        for k, v in fields.items():
            cmd += ["-f", f"{k}={v}"]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a GitLab issue for implementation")
    parser.add_argument("project_path", help="GitLab project path (e.g., group/project)")
    parser.add_argument("iid", type=int, help="Issue iid")
    parser.add_argument("slug", help="Slug for the branch name")
    parser.add_argument("--hostname", default=None, help="GitLab hostname (default: auto-detect from git remote)")
    args = parser.parse_args()

    global _hostname
    _hostname = args.hostname or detect_hostname()

    branch_name = f"issue-{args.iid}-{args.slug}"
    encoded_path = url_quote(args.project_path, safe="")

    # 1. Create working branch (or switch to it if it already exists)
    try:
        run(f"git checkout -b {branch_name}")
    except RuntimeError:
        try:
            run(f"git checkout {branch_name}")
        except RuntimeError:
            # Already on this branch (e.g. in a worktree), continue
            pass

    # 2. Add "doing" label via glab api
    try:
        glab_api(
            "PUT",
            f"projects/{encoded_path}/issues/{args.iid}",
            {"add_labels": "doing"},
        )
    except RuntimeError as e:
        print(f"Warning: could not add 'doing' label: {e}", file=sys.stderr)

    # 3. Post start note via glab api
    comment = f"[from bot] Starting implementation. Tracking on branch `{branch_name}`."
    try:
        glab_api(
            "POST",
            f"projects/{encoded_path}/issues/{args.iid}/notes",
            {"body": comment},
        )
    except RuntimeError as e:
        print(f"Warning: could not post start comment: {e}", file=sys.stderr)

    # Output result as JSON
    print(json.dumps({"branch_name": branch_name, "slug": args.slug}))


if __name__ == "__main__":
    main()
