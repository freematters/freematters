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

After the PR is merged (workflow reaches `done` state), print cleanup instructions for the user:
```
To clean up the worktree, run:
  cd <original_repo_root>
  git worktree remove .claude/worktrees/<branch_name>
  git checkout <DEFAULT_BRANCH> && git pull
```
Do NOT execute the cleanup yourself — removing the worktree from within it breaks the session.

Start the unified pr-lifecycle workflow:
  /fflow pr-lifecycle
