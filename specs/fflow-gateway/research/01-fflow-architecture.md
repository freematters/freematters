# fflow 当前架构分析

## Summary

fflow 是一个基于 CLI 的 workflow runtime，采用文件系统存储、YAML 定义状态机、Commander.js CLI 的三层架构。当前设计聚焦单进程单 run 交互，但已有多 run 管理能力（list、--root），为 gateway 扩展提供了基础。

## Key Findings

1. **存储层 (Store)** - 每个 workflow run 独立存储在 `~/.freeflow/runs/{run_id}/` 目录
   - `fsm.meta.json` — run 元信息（workflow path, created_at, lite mode）
   - `events.jsonl` — 追加式事件日志（状态转换历史）
   - `snapshot.json` — 当前状态快照（快速读取）
   - 目录锁 (`lock/`) 实现并发安全

2. **FSM 层** - 纯解析器，无运行时状态
   - 支持 `from:` 引用继承状态
   - 支持 `workflow:` 组合子 workflow（v1.2）
   - 支持 `extends_guide` 继承全局指南

3. **CLI 层** - 无状态命令，每次调用独立
   - `--root` 全局选项支持自定义存储目录
   - `--json` 输出格式便于程序化调用
   - Session 绑定机制（用于 PostToolUse hook）

4. **扩展点**
   - `--root` 已支持存储隔离
   - `Store.listRunsWithStatus()` 提供 run 列表
   - 无 HTTP/WebSocket server，仅 CLI 调用

5. **限制**
   - 无进程管理（workflow 在 agent 进程内执行）
   - 无远程访问能力
   - Session 绑定基于文件系统

## Architecture Diagram

```mermaid
graph TB
    subgraph "Current Architecture"
        CLI[fflow CLI]
        Store[Store<br/>~/.freeflow/]
        FSM[FSM Loader]
        YAML[workflow.yaml]

        CLI --> Store
        CLI --> FSM
        FSM --> YAML

        subgraph "Store Structure"
            RunDir[runs/{run_id}/]
            Meta[fsm.meta.json]
            Events[events.jsonl]
            Snapshot[snapshot.json]
            Sessions[sessions/]
        end

        Store --> RunDir
        RunDir --> Meta
        RunDir --> Events
        RunDir --> Snapshot
        Store --> Sessions
    end

    Agent[AI Agent] -->|subprocess| CLI
```

## Trade-offs

| 当前设计 | 优点 | 缺点 |
|----------|------|------|
| 文件系统存储 | 简单、无依赖、易调试 | 不支持分布式、无查询能力 |
| CLI 交互 | 无状态、易测试 | 每次调用开销、无事件推送 |
| 无 server | 简单、无运维 | 无法远程访问、无多 agent 协作 |

## Recommendations

1. **Gateway 需要新增 HTTP/WebSocket server 层**
   - 复用现有 Store 类
   - 复用现有 FSM loader
   - 新增 server 和 API 路由

2. **考虑保留 CLI 作为本地快速路径**
   - Gateway 作为 optional 组件
   - CLI 可绕过 gateway 直连 Store

3. **Session 管理需要扩展**
   - 当前 session 是 agent session（工具调用计数）
   - Gateway 需要 workflow instance session（生命周期管理）

## References

- Source: `/home/ubuntu/Code/freematters/packages/freeflow/src/`
- Key files: `store.ts`, `fsm.ts`, `cli.ts`
