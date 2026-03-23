## research/gitlab-mr-api.md

### Summary

GitLab's REST API for merge requests and issues closely mirrors GitHub's, with key structural differences in identifiers (project ID vs owner/repo), terminology (MR vs PR, notes vs comments, award emoji vs reactions), and authentication. The `glab` CLI provides a near 1:1 command mapping to `gh`.

### Key Findings

1. **MR creation**: `POST /api/v4/projects/:id/merge_requests` — requires `source_branch`, `target_branch`, `title`; auth via `PRIVATE-TOKEN` header
2. **Issue API**: Uses `iid` (project-scoped) not global `id`; comments are called "notes" at `/issues/:iid/notes`
3. **Reactions**: Called "award emoji" — supports any emoji name (not limited like GitHub's fixed set); endpoint: `/award_emoji`
4. **CI status**: Embedded in MR object (`head_pipeline.status`, `detailed_merge_status`) — no separate check-runs API
5. **`glab` CLI**: Official GitLab CLI with near-identical commands: `glab mr create`, `glab issue create`, `glab issue note`, `glab ci status`

### Trade-offs: `glab` CLI vs Raw API

| Approach | Pros | Cons |
|----------|------|------|
| **`glab` CLI** | Simpler scripting, auto-detects project, handles auth | Requires installation, may not be available |
| **`curl` + REST API** | No dependency, full control, works with existing token | More verbose, must handle project ID encoding |
| **Hybrid** | Best of both worlds | Complexity in the workflow instructions |

### API Mapping: GitHub → GitLab

| Operation | GitHub (`gh`) | GitLab (`glab` / API) |
|-----------|---------------|----------------------|
| Create PR/MR | `gh pr create` | `glab mr create` / `POST .../merge_requests` |
| Create issue | `gh issue create` | `glab issue create` / `POST .../issues` |
| Comment on issue | `gh issue comment N` | `glab issue note N` / `POST .../issues/:iid/notes` |
| React to comment | `gh api .../reactions -f content=eyes` | `POST .../notes/:id/award_emoji -d name=eyes` |
| Check CI | `gh pr checks` | `glab ci status` / MR's `head_pipeline.status` |
| Edit issue body | `gh issue edit N --body` | `PUT .../issues/:iid` with `description` field |
| View MR status | `gh pr view` | `glab mr view` / `GET .../merge_requests/:iid` |
| List MR threads | `gh api graphql` | `GET .../merge_requests/:iid/discussions` |
| Resolve thread | GraphQL mutation | `PUT .../discussions/:id?resolved=true` (simpler!) |

### Key Differences for Workflow Adaptation

1. **Identifiers**: Replace `owner/repo` → project ID or URL-encoded path throughout
2. **Comments → Notes**: Different endpoint names and parameter names
3. **Thread resolution**: GitLab uses simple REST `PUT` instead of GraphQL mutations — actually simpler
4. **Draft MRs**: Same concept, `draft: true` parameter or `Draft:` title prefix
5. **CI integration**: MR object contains pipeline status directly — fewer API calls needed
6. **Auth**: `PRIVATE-TOKEN` header (token from `~/.metabit/mg/config.yml`)

### Recommendations

1. **Use `curl` + REST API** for the workflow — avoids `glab` installation dependency, and the existing token at `~/.metabit/mg/config.yml` is already available
2. **Thread resolution is simpler on GitLab** — REST PUT vs GraphQL mutation; this simplifies the `address` state
3. **CI status is simpler on GitLab** — embedded in MR object, no separate check-runs query
4. **Project identification** will need a setup step to resolve `owner/repo` → project ID (or use URL-encoded path)

### References

- [Merge requests API | GitLab Docs](https://docs.gitlab.com/api/merge_requests/)
- [Issues API | GitLab Docs](https://docs.gitlab.com/api/issues/)
- [Notes API | GitLab Docs](https://docs.gitlab.com/api/notes/)
- [Emoji reactions API | GitLab Docs](https://docs.gitlab.com/api/emoji_reactions/)
- [GitLab CLI (glab)](https://docs.gitlab.com/cli/)
