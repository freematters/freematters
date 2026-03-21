# Implementation Plan: Workflow State Reuse

## Checklist
- [x] Step 1: Core ref resolution in `loadFsm`
- [ ] Step 2: `extends_guide` support
- [ ] Step 3: Integration tests

---

## Step 1: Core ref resolution in `loadFsm`

**Depends on**: none

**Objective**: 让 `loadFsm()` 支持 `from: workflow#state` 引用，在 schema 验证之前展开所有引用。

**Test Requirements**:
- 基本引用无 override → 完整继承 prompt + transitions + todos
- Prompt with `{{base}}` → 正确插入 base prompt
- Prompt without `{{base}}` → 完全替换
- Transitions merge → base + local 合并，同名以 local 为准
- Transitions 不写 → 继承 base
- Todos append → 本地追加到 base 后面
- Todos 不写 → 继承 base
- 循环引用 → `SCHEMA_INVALID`
- 链式引用 A → B → C → 正确解析
- 引用不存在的 workflow → `WORKFLOW_NOT_FOUND`
- 引用不存在的 state → `SCHEMA_INVALID`
- `from` 格式错误 → `SCHEMA_INVALID`
- 无 `from` 的 workflow → 行为不变（向后兼容）

**Implementation Guidance**:

1. 在 `fsm.ts` 中将 `loadFsm` 拆分为公共入口 + 内部实现 `loadFsmInternal(path, visited)`
2. 新增 `resolveRefs(doc, currentPath, visited)` 函数：
   - 遍历 `doc.states`，找到带 `from` 的 state
   - 解析 `from` 为 `workflowName#stateName`（校验格式）
   - 用 `resolveWorkflow(workflowName)` 获取 base 路径
   - 循环检测：base 路径在 `visited` 中则报错
   - 递归调用 `loadFsmInternal(basePath, new Set([...visited, currentPath]))` 加载 base
   - 从 base FSM 提取目标 state
   - 执行 merge（见 design.md §4.1 merge 规则）
   - 将 merge 后的结果写回 `doc.states[name]`，删除 `from` 字段
3. 在 YAML 解析之后、schema 验证之前调用 `resolveRefs`
4. 创建测试 fixtures — 若干小型 workflow YAML 文件在 `src/__tests__/fixtures/`

---

## Step 2: `extends_guide` support

**Depends on**: Step 1（复用 `resolveWorkflow` 和递归加载逻辑）

**Objective**: 支持顶层 `extends_guide` 字段，让 child workflow 的 guide 可以引用 base workflow 的 guide。

**Test Requirements**:
- `extends_guide` + `guide` with `{{base}}` → 正确组合
- `extends_guide` + 无 `guide` → 继承 base guide
- `extends_guide` + `guide` without `{{base}}` → 完全替换
- `extends_guide` 引用不存在的 workflow → `WORKFLOW_NOT_FOUND`
- `extends_guide` 引用无 guide 的 workflow → `SCHEMA_INVALID`
- 无 `extends_guide` → 行为不变

**Implementation Guidance**:

1. 在 `resolveRefs` 中处理 `doc.extends_guide`：
   - 用 `resolveWorkflow()` 解析 base workflow 路径
   - 加载 base workflow，提取 guide
   - 按 `{{base}}` 规则 merge guide
   - 删除 `doc.extends_guide` 字段
2. 在现有 guide 验证之前完成

---

## Step 3: Integration tests

**Depends on**: Step 1, Step 2

**Objective**: 实现 design.md §7 Integration Testing 中定义的全部 15 个测试场景。

**Implementation Guidance**:

1. 在 `src/__tests__/fixtures/` 创建 reuse 相关的 fixture workflow 文件：
   - `base.workflow.yaml` — 基础 workflow
   - `child-override.workflow.yaml` — 各种 override 场景
   - `child-inherit.workflow.yaml` — 纯继承场景
   - `circular-a.workflow.yaml` + `circular-b.workflow.yaml` — 循环引用
   - `chain-a/b/c.workflow.yaml` — 链式引用
   - `guide-extend.workflow.yaml` — guide reuse
2. 在 `src/__tests__/fsm-reuse.test.ts` 中编写测试
3. 用 `loadFsm()` 加载 fixture 并断言结果
4. 不 mock `resolveWorkflow` — 用真实的 fixture 目录结构

具体测试场景见 design.md §7，不在此重复。

