# TEST — glove e2e

来源：`GOAL.md` § v1 验收标准。所有用例为 **e2e**（在真实进程 + 真实 cloudflared 隧道 + wss 长连下跑），可重复执行。

## 通用前置

- 一台 Linux x86_64 测试机（可单机做 server 与 client，但需用两个独立工作目录隔离 state）
- 已编译 release `glove` binary
- 已安装 `cloudflared`
- 测试 harness 可启动/停止子进程、收集 stdout/stderr/exit_code、断网模拟（iptables 或 tc）

为减少 CI 对真实 TryCloudflare 的依赖，每个用例额外提供 `LOCAL_MODE=1` 变体：server 直接监听 127.0.0.1:port，client 连 ws://127.0.0.1:port，跳过 cloudflared。**这两种模式必须都通过**。

---

## T1 — install one-liner（端到端冷启动）

**目的**：在 fresh 环境下，一行 `curl ... | sh` 成功上线。

**步骤**：
1. 启动 server：`glove start`，捕获 stdout 中的 install 命令字符串
2. 在另一个干净的工作目录执行该 install 命令
3. server 端 `glove list` 显示该 client 在线

**通过条件**：
- 整个流程 30 秒内完成
- `glove list` 输出含至少 1 个 client 条目，状态为 `online`
- install 脚本退出码为 0

## T2 — exec 基本回路

**前置**：T1 通过，1 个 client 在线，名为 `c1`

**步骤**：
1. `glove exec c1 -- echo hello`
2. `glove exec c1 -- sh -c 'echo err >&2; exit 7'`

**通过条件**：
- 第 1 条：stdout = `hello\n`，exit_code = 0，stderr 空
- 第 2 条：stderr 含 `err`，exit_code = 7
- 单次 round-trip < 1s（local mode 内 < 200ms）

## T3 — file 双向传输

**前置**：T1 通过，1 个 client 在线 `c1`

**步骤**：
1. 准备 1 MiB 随机二进制文件 `A`，记 md5
2. `glove push c1 A /tmp/A_remote`
3. 在 client 端验证 `/tmp/A_remote` 存在且 md5 = md5(A)
4. 在 client 端生成 1 MiB 随机文件 `B`（通过 `glove exec` 触发 `dd ...`），记其 md5
5. `glove pull c1 /tmp/B_remote B_local`
6. 验证 md5(B_local) = md5(B)

**通过条件**：
- 两次传输 md5 一致
- 命令退出码均为 0

## T4 — 多 client 定向

**步骤**：
1. server 启动后，pairing 两次（生成两个 install 命令；或同一 install 命令多机执行——取最简者）
2. 两个 client 上线，分别为 `c1` 和 `c2`
3. 在 c1 上 `glove exec c1 -- hostname > /tmp/who && cat /tmp/who`（实际用 echo 区分身份）：`glove exec c1 -- echo I_AM_C1`
4. `glove exec c2 -- echo I_AM_C2`
5. 在 c1 端检查 c2 命令未在它身上执行（用文件 sentinel）

**通过条件**：
- c1 收到的 stdout = `I_AM_C1`，c2 = `I_AM_C2`
- 没有交叉执行

## T5 — 断线重连

**前置**：1 个 client 在线 `c1`

**步骤**：
1. 在 c1 模拟网络中断 10 秒（drop client → server 的出站包）
2. 期间 server `glove list` 应在合理超时（≤ 5s）后显示 c1 为 `offline`
3. 恢复网络
4. ≤ 10s 内 `glove list` 显示 c1 重新 `online`
5. `glove exec c1 -- echo back` 成功

**通过条件**：
- 状态转换 online → offline → online 被观察到
- 恢复后命令执行成功

## T6 — 未授权拒绝

**步骤**：
1. server 启动获得 install 命令（含 token `T`）
2. 篡改 token 为 `T_BAD`（同长度随机），尝试直接以 client daemon 模式连接：`glove <hidden-client-mode> --server <url> --token T_BAD`
3. 观察 server 行为与日志

**通过条件**：
- client 连接被拒绝（4xx / ws close code 非正常）
- server 日志记录拒绝原因（不暴露「token 不存在」/「token 错误」差异，统一一条拒绝信息）
- `glove list` 不出现该 client

---

## 不在 v1 测试范围

- 交互式 pty / shell session
- 端口转发
- macOS / Windows / arm64
- 大文件（> 100 MiB）传输
- server URL 变更后老 client 自动迁移
