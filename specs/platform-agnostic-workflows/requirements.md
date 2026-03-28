# Requirements

### Q1: Platform差异处理方式
**Q**: 在统一 workflow 里如何处理 GitHub/GitLab 差异？
**A**: 在同一个 prompt 里用条件分支处理 platform 差异（类似 spec-to-code 现有的 `source_mode` + `platform` 模式）。

### Q2: Python 脚本合并策略
**Q**: 现有的 4 对 GitHub/GitLab Python 脚本是否合并？
**A**: 保持分开，不合并脚本。Workflow prompt 里根据 platform 调用不同脚本。

### Q3: issue-to-spec 命名
**Q**: `*-spec-gen` 重命名为 `issue-to-spec`，本地 `spec-gen` 保持不变？
**A**: 是。`issue-to-spec` 只替代 `github-spec-gen` 和 `gitlab-spec-gen`。

### Q4: Lite 模式处理
**Q**: `*-lite` 变体如何处理？
**A**: 作为模式参数（`--lite`），不再用独立 workflow。在 YAML state prompt 里加 "if lite mode" 条件分支。删除所有 `*-lite` workflow。

### Q5: issue-to-pr 子 workflow 引用
**Q**: 合并后 issue-to-pr 的子 workflow 引用如何变化？
**A**: `github-spec-gen` → `issue-to-spec`，`github-pr-lifecycle` → `pr-lifecycle`。`spec-to-code` 不动。

### Q6: Platform 自动检测
**Q**: 如何检测 GitHub 还是 GitLab？
**A**: 参数格式 + `git remote get-url origin`，同 spec-to-code 现有方式。

### Q7: 迁移策略
**Q**: 旧 workflow 如何处理？
**A**: 直接删除，无兼容期。删除列表：`github-spec-gen`、`github-spec-gen-lite`、`gitlab-spec-gen`、`github-pr-lifecycle`、`gitlab-mr-lifecycle`、`gitlab-issue-to-mr`、`issue-to-pr-lite`、`spec-gen-lite`。

### Q8: Gate state 处理
**Q**: `issue-to-pr` 中的 gate state（如 `confirm-implement`）的 poll 机制如何处理？
**A**: 走 platform 条件分支。

### Q9: E2E 测试
**Q**: 是否需要 e2e 测试？
**A**: 需要。GitHub 测试仓库：`freematters/testbed`，GitLab 测试仓库：`ran.xian/testproj`。测完关闭 PR/MR 和 issue。
