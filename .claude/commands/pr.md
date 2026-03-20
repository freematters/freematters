---
description: Start PR lifecycle workflow
---

Before starting the workflow, check if the current branch is the repo's default branch:

```bash
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
CURRENT_BRANCH=$(git branch --show-current)
```

If `CURRENT_BRANCH == DEFAULT_BRANCH`:
1. Determine a branch name automatically from recent commits (e.g., `feat/short-description` or `fix/short-description` using conventional commit style).
2. Create a worktree in `.claude/worktrees/<branch_name>` and check it out:
   ```bash
   git worktree add .claude/worktrees/<branch_name> -b <branch_name>
   cd .claude/worktrees/<branch_name>
   ```
3. Proceed with the workflow from the worktree directory.

After the PR is merged (workflow reaches `done` state):
1. Return to the original repo root.
2. Remove the worktree: `git worktree remove .claude/worktrees/<branch_name>`
3. Check out the default branch: `git checkout $DEFAULT_BRANCH && git pull`

Then proceed with the workflow:

/fflow:start pr-lifecycle
