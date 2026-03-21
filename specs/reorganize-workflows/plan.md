# Implementation Plan: 重组 Workflow 文件结构

## Checklist
- [x] Step 1: 重组 workflow 目录结构、更新代码与文档
- [x] Step 2: Integration Test

---

## Step 1: 重组 workflow 目录结构、更新代码与文档

**Depends on**: none

**Objective**: 将 workflow 文件从扁平格式重组为目录格式，更新搜索逻辑、skill 命名、路径引用、文档和测试。

**Implementation Guidance**:

### 1. 重组目录结构

为每个 workflow 创建子目录，把 `.workflow.yaml` 重命名为 `workflow.yaml` 移入，关联文件一起移入：

| Workflow | 附带文件 |
|----------|----------|
| `spec-gen/` | 无 |
| `spec-to-code/` | `download_spec.py`, `prepare_implementation.py` |
| `pr-lifecycle/` | `poll_pr.py` |
| `code-review/` | `agents/` (原 `code-review-agents/`) |
| `issue-bot/` | `poll_issue.py` |
| `release/` | `release-notes.md` |
| `gamemaker/` | 无 |
| `verifier/` | 无 |

### 2. 更新 resolve-workflow.ts

- `probeDir()`: 改为查找 `join(dir, baseName, "workflow.yaml")`
- 移除 `WORKFLOW_EXTENSIONS` 数组和多扩展名探测逻辑
- 移除 `WORKFLOW_AMBIGUOUS` 错误（不再可能出现）
- `hasWorkflowExtension()` 保留用于判断输入是否为直接文件路径
- 直接路径逻辑（含 `/` 或 `.`）保持不变

### 3. 重命名 skill 目录和 name 字段

- `skills/start/` → `skills/fflow/`，SKILL.md `name: fflow:start` → `name: fflow`
- `skills/create/` → `skills/fflow-create/`，SKILL.md `name: fflow:create` → `name: fflow-create`
- 更新 SKILL.md 内容中引用的旧命令名

### 4. 更新 workflow YAML 内的路径引用

- `spec-to-code/workflow.yaml`: `freefsm/workflows/download_spec.py` → `$SCRIPT_DIR/download_spec.py`，同理 `prepare_implementation.py`
- `code-review/workflow.yaml`: `freefsm/workflows/code-review-agents/` → `$SCRIPT_DIR/agents/`
- `pr-lifecycle/workflow.yaml` 和 `issue-bot/workflow.yaml`：已用 `$SCRIPT_DIR`，不需改
- 更新 YAML 中引用旧命令名的文本（如 `/freefsm:start spec-gen` → `/fflow spec-gen`）

### 5. 更新文档中的命令名引用

- `AGENTS.md` / `CLAUDE.md`：`/fflow:start` → `/fflow`，`/fflow:create` → `/fflow-create`
- `README.md`、`install.ts`、`docs/design.md`
- 用 grep 搜索 `fflow:start`、`fflow:create`、`freefsm:start`、`freeflow-create` 确保无遗漏

### 6. 更新单元测试

- 更新 resolve-workflow 的单元测试 fixture 结构
- 测试按名称搜索 `<name>/workflow.yaml`
- 测试搜索优先级（project-local > user-global > bundled）
- 测试旧格式按名称搜索返回 `WORKFLOW_NOT_FOUND`
- 测试完整路径仍然可用

---

## Step 2: Integration Test

**Depends on**: Step 1

**Objective**: 实现 design.md §6 定义的 integration test。

**Implementation Guidance**:

按 design.md §6 的规格实现 integration test，覆盖：
- `resolve-workflow` + `loadFsm` 跨组件联合验证
- 搜索优先级端到端验证
- `fflow validate` 对所有重组后的 bundled workflow 通过

详细测试场景见 design.md §6 Integration Testing。

