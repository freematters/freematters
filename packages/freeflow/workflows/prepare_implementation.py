#!/usr/bin/env python3
"""Prepare a GitHub issue for implementation.

Usage:
    prepare_implementation.py <owner> <repo> <issue_number> <slug>

What it does:
    1. Creates a working branch: issue-<number>-<slug>
    2. Adds the "doing" label to the issue
    3. Posts a [from bot] comment announcing implementation start

Outputs (JSON to stdout):
    { "branch_name": "issue-41-my-feature", "slug": "my-feature" }
"""

import argparse
import json
import subprocess
import sys


def run(cmd: str) -> str:
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def gh(args: str) -> str:
    return run(f"gh {args}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare a GitHub issue for implementation")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("issue_number", type=int, help="Issue number")
    parser.add_argument("slug", help="Slug for the branch name")
    args = parser.parse_args()

    branch_name = f"issue-{args.issue_number}-{args.slug}"

    # 1. Create working branch (or switch to it if it already exists)
    try:
        run(f"git checkout -b {branch_name}")
    except RuntimeError:
        try:
            run(f"git checkout {branch_name}")
        except RuntimeError:
            # Already on this branch (e.g. in a worktree), continue
            pass

    # 2. Add "doing" label
    try:
        gh(f'label create doing --repo {args.owner}/{args.repo} --description "Implementation in progress" --color FBCA04')
    except RuntimeError:
        pass  # Label already exists
    gh(f"issue edit {args.issue_number} --repo {args.owner}/{args.repo} --add-label doing")

    # 3. Post start comment
    comment = f"[from bot] Starting implementation. Tracking on branch `{branch_name}`."
    gh(f'issue comment {args.issue_number} --repo {args.owner}/{args.repo} --body "{comment}"')

    # Output result as JSON
    print(json.dumps({"branch_name": branch_name, "slug": args.slug}))


if __name__ == "__main__":
    main()
