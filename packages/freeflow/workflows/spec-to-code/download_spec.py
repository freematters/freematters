#!/usr/bin/env python3
"""Download spec artifacts from a GitHub issue into a local specs directory.

Usage:
    download_spec.py <owner> <repo> <issue_number> --slug <slug> [--specs-dir <path>]

Scans issue comments for artifact headers and saves them as local files:
    ## design.md         → <specs-dir>/<slug>/design.md
    ## plan.md           → <specs-dir>/<slug>/plan.md
    ## requirements.md   → <specs-dir>/<slug>/requirements.md
    ## e2e.md            → <specs-dir>/<slug>/e2e.md
    ## research/<topic>  → <specs-dir>/<slug>/research/<topic>.md

The header line is stripped — file content starts from the line after the header.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# Artifact headers we recognize (order matters: research/ is a prefix match)
ARTIFACT_FILES = {"design.md", "plan.md", "requirements.md", "e2e.md"}
RESEARCH_PREFIX = "research/"


def gh_api(endpoint: str, jq: str | None = None, paginate: bool = False) -> str:
    cmd = ["gh", "api", endpoint]
    if jq:
        cmd += ["--jq", jq]
    if paginate:
        cmd.append("--paginate")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"gh api error: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def parse_artifact_header(first_line: str) -> tuple[str, str] | None:
    """Parse a '## <filename>' header line. Returns (type, relative_path) or None."""
    m = re.match(r"^##\s+(.+)$", first_line.strip())
    if not m:
        return None
    name = m.group(1).strip()
    if name in ARTIFACT_FILES:
        return ("file", name)
    if name.startswith(RESEARCH_PREFIX):
        topic = name[len(RESEARCH_PREFIX):]
        if topic:
            # Ensure .md extension
            if not topic.endswith(".md"):
                topic += ".md"
            return ("research", topic)
    return None


def download_artifacts(owner: str, repo: str, issue_number: int) -> tuple[str, dict[str, str]]:
    """Fetch issue title and artifact comments. Returns (title, {path: content})."""
    # Get issue title
    title = gh_api(f"repos/{owner}/{repo}/issues/{issue_number}", jq=".title")

    # Fetch all comments
    raw = gh_api(
        f"repos/{owner}/{repo}/issues/{issue_number}/comments",
        jq=".[] | {body: .body}",
        paginate=True,
    )

    artifacts: dict[str, str] = {}
    if not raw:
        return title, artifacts

    for line in raw.strip().split("\n"):
        if not line.strip():
            continue
        try:
            comment = json.loads(line)
        except json.JSONDecodeError:
            continue

        body: str = comment.get("body", "")
        lines = body.split("\n")
        if not lines:
            continue

        parsed = parse_artifact_header(lines[0])
        if not parsed:
            continue

        kind, name = parsed
        # Strip the header line; content starts from line after header
        content = "\n".join(lines[1:]).strip() + "\n"

        if kind == "file":
            artifacts[name] = content
        elif kind == "research":
            artifacts[f"research/{name}"] = content

    return title, artifacts


def main() -> None:
    parser = argparse.ArgumentParser(description="Download spec artifacts from a GitHub issue")
    parser.add_argument("owner", help="Repository owner")
    parser.add_argument("repo", help="Repository name")
    parser.add_argument("issue_number", type=int, help="Issue number")
    parser.add_argument("--specs-dir", default="./specs", help="Base specs directory (default: ./specs)")
    parser.add_argument("--slug", required=True, help="Slug for the spec directory")
    args = parser.parse_args()

    title, artifacts = download_artifacts(args.owner, args.repo, args.issue_number)

    if not title:
        print("Could not fetch issue title", file=sys.stderr)
        sys.exit(1)

    slug = args.slug
    specs_dir = Path(args.specs_dir) / slug

    if not artifacts:
        print(f"No spec artifacts found in {args.owner}/{args.repo}#{args.issue_number}", file=sys.stderr)
        sys.exit(1)

    # Write artifacts to disk
    for rel_path, content in artifacts.items():
        dest = specs_dir / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)
        print(f"  {dest}")

    print(f"\nDownloaded {len(artifacts)} artifact(s) to {specs_dir}/")


if __name__ == "__main__":
    main()
