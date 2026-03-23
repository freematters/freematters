#!/usr/bin/env python3
"""Download spec artifacts from a GitLab issue into a local specs directory.

Usage:
    download_spec_gl.py <project_path> <iid> --slug <slug> [--specs-dir <path>]

Scans issue notes for artifact headers and saves them as local files:
    ## design.md         → <specs-dir>/<slug>/design.md
    ## plan.md           → <specs-dir>/<slug>/plan.md
    ## requirements.md   → <specs-dir>/<slug>/requirements.md
    ## e2e.md            → <specs-dir>/<slug>/e2e.md
    ## research/<topic>  → <specs-dir>/<slug>/research/<topic>.md

The header line is stripped — file content starts from the line after the header.

Uses `glab api` for all GitLab API interactions.
Requires GITLAB_TOKEN env var or `glab auth login`.
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote as url_quote

# Artifact headers we recognize (order matters: research/ is a prefix match)
ARTIFACT_FILES = {"design.md", "plan.md", "requirements.md", "e2e.md"}
RESEARCH_PREFIX = "research/"


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


def glab_api(endpoint: str, jq: str | None = None, paginate: bool = False) -> str:
    cmd = ["glab", "api", endpoint]
    if _hostname:
        cmd += ["--hostname", _hostname]
    if jq:
        cmd += ["--jq", jq]
    if paginate:
        cmd.append("--paginate")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"glab api error: {result.stderr.strip()}", file=sys.stderr)
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


def download_artifacts(project_path: str, iid: int) -> tuple[str, dict[str, str]]:
    """Fetch issue title and artifact notes. Returns (title, {path: content})."""
    encoded_path = url_quote(project_path, safe="")

    # Get issue title
    title = glab_api(f"projects/{encoded_path}/issues/{iid}", jq=".title")

    # Fetch all notes
    raw = glab_api(
        f"projects/{encoded_path}/issues/{iid}/notes",
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
            note = json.loads(line)
        except json.JSONDecodeError:
            continue

        body: str = note.get("body", "")
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
    parser = argparse.ArgumentParser(description="Download spec artifacts from a GitLab issue")
    parser.add_argument("project_path", help="GitLab project path (e.g., group/project)")
    parser.add_argument("iid", type=int, help="Issue iid")
    parser.add_argument("--specs-dir", default="./specs", help="Base specs directory (default: ./specs)")
    parser.add_argument("--slug", required=True, help="Slug for the spec directory")
    parser.add_argument("--hostname", default=None, help="GitLab hostname (default: auto-detect from git remote)")
    args = parser.parse_args()

    global _hostname
    _hostname = args.hostname or detect_hostname()

    title, artifacts = download_artifacts(args.project_path, args.iid)

    if not title:
        print("Could not fetch issue title", file=sys.stderr)
        sys.exit(1)

    slug = args.slug
    specs_dir = Path(args.specs_dir) / slug

    if not artifacts:
        print(f"No spec artifacts found in {args.project_path}#{args.iid}", file=sys.stderr)
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
