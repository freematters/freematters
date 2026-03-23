# fflow-gateway Requirements

## Q&A Record

### Q1: "从外面创建 workflow" 的具体使用场景是什么？

**A1**: 类似于在远程可以执行 `fflow run --gateway gateway_addr`。
- CLI 仍是主要接口
- Gateway 作为远程服务器
- 本地 CLI 通过 `--gateway` 参数连接远程执行

### Q2: Gateway 上执行 workflow 的 agent session 是谁提供的？

**A2**: ~~A — Gateway 内置 Claude Agent SDK~~ **修正为 B — Agent Daemon 模式**
- Agent daemon session 主动连接到 Gateway
- Gateway 只做路由和状态管理
- Agent daemon 根据 key 创建新 agent 或唤醒旧 agent
- 解耦：Gateway 不依赖具体的 agent runtime

### Q3: 用户如何与运行中的 workflow 交互（human-in-the-loop）？

**A3**: A — WebSocket 实时通道，体验要和 `fflow run` 基本一样。
- 双向实时通信
- 用户能实时看到 agent 输出
- 能够实时输入反馈
- 交互体验等同于本地 `fflow run`

### Q4: Gateway 需要支持多少并发 workflow？性能要求是什么？

**A4**: 10-20 个并发 workflow（小团队规模）
- 不需要生产级负载均衡
- 单机部署即可
- 预留扩展能力

### Q5: Gateway 的认证方式是什么？

**A5**: A — API Key
- 简单配置，环境变量或配置文件
- HTTPS 加密传输
- 适合小团队内部使用

### Q6: workflow 的存储和隔离策略是什么？

**A6**: A — 共享存储
- 所有 workflow 用同一个存储目录
- 按 run_id 隔离
- 简单，复用现有 fflow 存储结构

### Q7: 需要 e2e 测试吗？如果需要，测试什么场景？

**A7**: B — 基础场景
- 测试 gateway + daemon 部署后
- 外部可以 `fflow run --gateway` 连上使用
- 验证基本的远程 workflow 执行流程

---

## Requirements Summary

### 核心功能
1. **远程执行**: `fflow run --gateway <addr>` 连接远程 gateway 执行 workflow
2. **Agent Daemon 模式**: Gateway 路由 + Daemon 管理 agent session
3. **实时交互**: WebSocket 双向通信，体验等同本地 `fflow run`

### 架构约束
- 10-20 并发 workflow（小团队）
- API Key 认证
- 共享存储，按 run_id 隔离
- 单机部署，预留扩展能力

### 测试要求
- e2e 测试：gateway + daemon 部署后，外部可以 `fflow run` 连上使用
