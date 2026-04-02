---
name: spec-driven
description: End-to-end pipeline from rough idea to merged pull request.
---

# Spec Driven

Before starting the workflow, check if the current branch is the repo's default branch:

```bash
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if echo "$REMOTE_URL" | grep -qi 'github'; then
  DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
else
  DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's|refs/remotes/origin/||')
fi
DEFAULT_BRANCH=${DEFAULT_BRANCH:-main}
CURRENT_BRANCH=$(git branch --show-current)
```

If `CURRENT_BRANCH == DEFAULT_BRANCH`:
1. Determine a branch name automatically from the user's idea (e.g., `feat/short-description` or `fix/short-description` using conventional commit style).
2. Create a worktree in `.claude/worktrees/<branch_name>` and switch your working directory to it:
   ```bash
   git worktree add .claude/worktrees/<branch_name> -b <branch_name>
   ```
   Then enter the worktree and use it as your working directory.
3. Proceed with the workflow from the worktree directory. All subsequent commands must run from the worktree path.

Run `/fflow spec-driven` with any arguments passed to this skill.
