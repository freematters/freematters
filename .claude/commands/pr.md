---
description: Start PR lifecycle workflow
---

Before starting the workflow, check if the current branch is the repo's default branch:

```bash
DEFAULT_BRANCH=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')
CURRENT_BRANCH=$(git branch --show-current)
```

If `CURRENT_BRANCH == DEFAULT_BRANCH`:
1. Ask the user for a branch name (suggest one based on recent commits if possible).
2. Create and check out the new branch: `git checkout -b <branch_name>`

Then proceed with the workflow:

/freefsm:start pr-lifecycle
