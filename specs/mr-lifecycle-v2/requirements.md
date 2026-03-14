# Requirements — mr-lifecycle-v2

### Q1: What specific pain points have you experienced with the current mr-lifecycle workflow?

For example: Is it the polling reliability, the way it handles CI failures, the review comment detection, the rebase logic, the overall flow structure, or something else entirely?

**Answer:** The system doesn't track which `!fix` comments have already been resolved/handled. Two specific issues:
1. Resolved review threads still get picked up — `!fix` in resolved threads should be ignored.
2. Issue-level (PR-level) `!fix` comments get re-detected by the polling script on every cycle, causing duplicate processing. Need a mechanism to avoid re-handling already-processed `!fix` comments.

### Q2: For issue-level `!fix` comments, which dedup strategy do you prefer?

A few options:

1. **React-based** — After processing a `!fix` comment, the bot adds a reaction (e.g., 👀 or ✅) to that comment. Polling script skips comments that already have that reaction. Simple, visible, works on both GitHub and GitLab.
2. **Local state file** — Track processed comment IDs in a local file (e.g., alongside the FSM run state). Polling script checks the file before flagging. No API side-effects, but state is local-only.
3. **Reply-based** — After processing, the bot replies to the comment (which it already does in the `push` state). Polling script checks if a reply exists. Leverages existing behavior but adds API calls per comment.

Which approach appeals to you, or do you have a different idea?

**Answer:** Use both strategies together:
- **React-based (✅)** for inline review comments — add a ✅ reaction after processing a `!fix` comment. Polling/check skips comments with ✅.
- **Local state file** for issue-level comments — track processed comment IDs locally. Polling script skips already-seen IDs.

### Q3: For the local state file approach, should the state be stored inside the FSM run directory (`~/.freefsm/runs/<run_id>/`) or somewhere else (e.g., `/tmp`)?

Storing in the run directory keeps it co-located with the run and auto-cleaned when the run finishes. `/tmp` is simpler but ephemeral across reboots.

**Answer:** 参考 taq-runner claude review pipeline 的做法，改用纯服务端状态追踪，不需要本地 state file：
- **Inline review `!fix`**：检查 thread 的 `resolved` 状态，resolved 的直接跳过
- **Issue comment `!fix`**：处理完后加 ✅ reaction，polling/check 时过滤掉有 ✅ 的 comment

### Q4: 除了 `!fix` 去重，还有其他想改进的地方吗？

比如：polling 策略、rebase 处理、MR description 更新逻辑、状态流转结构等。还是这次只聚焦在 `!fix` 去重这一个问题？

**Answer:** 两个额外改进：
1. **Bot review severity 分级处理**：只自动修复 blocker 级别的 bot review comment，major 级别留着不处理。
2. **最大 fix 轮次限制**：最多处理 3 轮 fix cycle（fix → push → wait-for-pipeline → check），超过 3 轮后停止自动修复，通知用户。

### Q5: 3 轮限制触发后，期望的行为是什么？

1. **直接结束 workflow** — 输出总结，告诉用户剩余问题需要手动处理
2. **进入 wait-for-input 状态** — 停止自动修复，但继续监听 `!fix` 和 merge/close 事件
3. **提示用户选择** — 问用户是继续还是停止

你倾向哪个？

**Answer:** 选 2 — 进入 wait-for-input 状态。停止自动修复，但继续监听 `!fix` 和 merge/close 事件。用户仍可通过 `!fix` 手动触发修复。

### Q6: 3 轮限制的计数范围是什么？

1. **只计 bot review 自动修复的轮次** — `!fix` 触发的修复不算在内
2. **所有 fix 轮次统一计数** — 不管是 bot review 还是 `!fix` 触发的都算

我倾向 1，因为 `!fix` 是用户主动请求的，限制它没太大意义。你怎么看？

**Answer:** 选 1 — 只计 bot review 自动修复轮次，`!fix` 不受限制。

### Q7: 还有其他想改进的地方吗？

目前收集到的改进点：
1. **`!fix` 去重** — inline 用 resolved 状态过滤，issue comment 用 ✅ reaction 过滤
2. **Bot review 分级** — 只自动修复 blocker，major 留给人处理
3. **最多 3 轮自动修复** — 超过后进入 wait-for-input，只计 bot review 轮次

如果没有其他改进点，我们可以进入 checkpoint 总结。

**Answer:** 两个结构优化：
4. **拆出 rebase** — `wait-for-pipeline` 的 polling script 只负责检测，检测到 target branch 更新后走正常 `check → fix(rebase) → push` 流程，不在 polling 里自己做 rebase。
5. **合并 `wait-for-pipeline` 和 `wait-for-input`** — 合成一个 `poll` state，同时监听 CI 完成 + `!fix` + merge/close，根据不同 exit condition 走不同 transition。

### Q8: 合并后的 `poll` state 的 exit conditions 确认

合并后 `poll` 同时监听所有事件，exit conditions 为：
- `pipelines finished` → check
- `fix requested`（新 `!fix` 出现）→ fix
- `MR merged` → done
- `MR closed` → done

这意味着如果 CI 还在跑的时候用户发了 `!fix`，会直接去 fix 而不等 CI 完成。你觉得这样 OK，还是应该等 CI 跑完再处理 `!fix`？

**Answer (Q8 + follow-up):** Review thread resolve 职责分离：
- **mr-lifecycle 不允许 auto-resolve review threads** — 只负责修代码和 push
- **Code-review pipeline（类似 taq-runner）负责 resolve** — 下一轮 CI review 时检查代码是否已修好，或认同用户观点后 resolve
- 这样 resolve 的判断权在 reviewer 侧，不在 author 侧

关于 poll 的 exit 逻辑：统一走 check 收集所有问题，`!fix` 在 idle 时直接跳 fix。

### Q9: Scope 确认

目前收集到的改进点：
1. **`!fix` 去重** — inline review 用 resolved 状态过滤，issue comment 用 ✅ reaction 过滤
2. **Bot review 分级** — 只自动修复 blocker，major 留着（用户可 `!fix` 触发）
3. **最多 3 轮自动修复** — 超过后进入 poll idle，只计 bot review/CI 轮次
4. **拆出 rebase** — polling 只检测，rebase 走正常 check → fix → push 流程
5. **合并 wait-for-pipeline + wait-for-input 为 `poll`** — 统一监听所有事件
6. **mr-lifecycle 不 auto-resolve review threads** — resolve 交给 code-review pipeline

**Answer:** 新增第 7 点：

7. **`@bot` 提及即时回复** — 用户在 inline thread 或 issue comment 里 @bot，mr-lifecycle 检测到后立即回复。多个同时回复。已回复的不重复回复。

### Q10: `@bot` 回复的去重机制

跟 `!fix` 类似，需要判断哪些 `@bot` 已经回复过。几个方案：

1. **检查 thread 里是否已有 bot 回复且时间晚于 @bot 的 comment** — 纯服务端，无副作用，但需要时间戳比较（taq-runner 用的就是这个方式）
2. **✅ reaction** — 回复后加 ✅，跟 `!fix` 统一机制
3. **两者结合** — inline thread 用时间戳（因为 thread 里天然有回复链），issue comment 用 ✅ reaction

你倾向哪个？

**Answer:** 选 3 — 两者结合：inline thread 用时间戳比较（检查 bot 是否已在 @bot 之后回复），issue comment 用 ✅ reaction。

### Q11: `@bot` 的回复内容是什么性质？

`@bot` 触发的回复应该是：
1. **问答型** — 用户问问题，bot 根据代码上下文回答（类似 taq-runner 的 respond-and-resolve）
2. **通用对话** — bot 理解用户意图，自由回复（可能是解释、建议、确认等）
3. **仅限特定指令** — `@bot` 后面必须跟特定关键词才触发（如 `@bot explain`、`@bot suggest`）

我倾向 2，给 bot 最大灵活性，让 Claude 根据上下文自行判断怎么回复。你怎么看？

**Answer:** 选 2 — 通用对话，bot 根据上下文自由回复。

### Q12: `@bot` 在状态流转中的位置

`@bot` 回复不涉及修改代码，只是在 MR 上发评论。它应该：

1. **在 `poll` 里直接处理** — polling 检测到 `@bot` 后，先回复，然后继续 polling，不需要状态转换
2. **新增一个 `reply` state** — poll 检测到 `@bot` → reply → 回到 poll

我倾向 1，因为回复不改代码、不需要 push，没必要走状态转换。而且多个 `@bot` 可以在 polling 回调里一次性全部回复。你觉得呢？

**Answer:** 选 1 — 在 poll 里直接处理，不走状态转换。

### Q13: 完整 scope 确认

所有改进点：

1. **`!fix` 去重** — inline review 用 resolved 状态过滤，issue comment 用 ✅ reaction 过滤
2. **Bot review 分级** — 只自动修复 blocker，major 留着（用户可 `!fix` 触发）
3. **最多 3 轮自动修复** — 超过后进入 poll idle，只计 bot review/CI 轮次，`!fix` 不受限
4. **拆出 rebase** — polling 只检测，rebase 走正常 check → fix → push 流程
5. **合并 wait-for-pipeline + wait-for-input 为 `poll`** — 统一监听所有事件
6. **mr-lifecycle 不 auto-resolve review threads** — resolve 交给 code-review pipeline
7. **`@bot` 即时回复** — poll 里直接处理，inline thread 用时间戳去重，issue comment 用 ✅ reaction 去重，通用对话模式

**Answer:** 去掉 `!fix` 机制。

### Q14: 去掉 `!fix` 后，用户想要求 bot 修改代码怎么办？

去掉 `!fix` 后，自动修复只剩 CI failure 和 bot review blocker。如果用户想请求修某个东西：

1. **通过 `@bot` 触发** — `@bot` 既能对话也能改代码，根据用户意图判断。这样 `@bot` 就替代了 `!fix` 的角色。
2. **纯手动** — 用户自己修，mr-lifecycle 只负责自动化部分。
3. **`@bot` 只对话，不改代码** — 保持之前 Q11 的定义，用户想改代码得自己来。

**Answer:** 选 1 — `@bot` 替代 `!fix`，既能对话也能改代码，根据用户意图判断。

### Q15: `@bot` 涉及代码修改时的状态流转

之前 Q12 定的是 `@bot` 在 poll 里直接处理、不走状态转换。但如果 `@bot` 可以改代码，就需要 commit + push，这就需要走 fix → push → poll 的流程了。

修正方案：
- **`@bot` 纯对话**（回答问题、解释代码）→ poll 里直接回复，不转换状态
- **`@bot` 涉及改代码**（用户意图是让 bot 修改）→ poll exit 为 `fix requested` → fix → push → poll

poll 的 exit conditions 更新为：
- `pipelines finished` → check
- `fix requested`（`@bot` 请求改代码）→ fix
- `mention detected`（`@bot` 纯对话）→ 就地回复，继续 poll
- `MR merged` → done
- `MR closed` → done

这样合理吗？

**Answer:** 合理。追问：如果用户 `@bot` 的指令和 bot review 的建议冲突怎么办？

### Q16: 用户指令与 bot review 冲突时的优先级

例如：bot review 说 "这个函数应该加错误处理"，但用户 `@bot` 说 "别加，这里不需要"。

**用户优先。** 理由：
- mr-lifecycle 是作者的助手，用户是 owner
- bot review 是自动化建议，不一定都对
- taq-runner 的设计也是这样 — 用户反驳后如果有理，reviewer 会 resolve

实际处理：当 `@bot` 指令和某个 bot review blocker 冲突时，bot 按用户指令执行，不修该 blocker。下一轮 code-review pipeline 跑的时候，reviewer 会重新评估（可能 resolve，也可能坚持）。

你同意用户优先这个原则吗？

**Answer:** 同意，用户优先。

### Q17: 更新后的完整 scope 确认

去掉 `!fix` 后重新整理：

1. **`@bot` 统一交互** — 替代 `!fix`，既能对话也能改代码，根据用户意图判断
   - 纯对话：poll 里直接回复，不转换状态
   - 改代码：poll → fix → push → poll
   - 去重：inline thread 用时间戳，issue comment 用 ✅ reaction
2. **Bot review 分级** — 只自动修复 blocker，major 留着
3. **最多 3 轮自动修复** — 超过后进入 poll idle，只计 bot review/CI 轮次，`@bot` 不受限
4. **拆出 rebase** — polling 只检测，rebase 走 check → fix → push 流程
5. **合并为 `poll` state** — 统一监听 CI 完成 + `@bot` + merge/close
6. **mr-lifecycle 不 auto-resolve review threads** — resolve 交给 code-review pipeline
7. **用户优先原则** — `@bot` 指令与 bot review 冲突时，按用户指令执行

**Answer:** 没有补充，requirements complete。

### Q18 (checkpoint 补充): Bot 回复格式

回复 `@bot` 时，回复内容前加 `[from bot]` 前缀，方便识别哪些评论是 bot 发的。

**Answer:** 确认，所有 bot 回复都以 `[from bot]` 开头。

### Q19 (checkpoint 补充): Code-review pipeline auto-resolve

Code-review pipeline（不是 mr-lifecycle）在每轮 review 时，应检查所有 open 的 inline review thread，如果对应的问题已经在代码中被修复了，自动 resolve 该 thread（类似 taq-runner 的 respond-and-resolve）。

**Answer:** 确认，这是 code-review pipeline 的职责，不是 mr-lifecycle 的。

### Q20 (checkpoint 补充): Code-review 回应用户反驳

当用户（通过 `@bot` 或直接回复）表示不想修某个 review issue 时，code-review pipeline 下一轮应：
1. 重新评估用户的理由是否合理
2. 如果合理 → 回复确认 + resolve thread
3. 如果不合理 → 回复解释为什么仍需修复，保持 thread open

（同样是 taq-runner respond-and-resolve 模式）

**Answer:** 确认。

### Q21 (checkpoint 补充): Code-review 发现待回复 thread 的逻辑

对每个 unresolved 的 bot-authored review thread，遍历 notes 序列，检查是否每一条 user note 后面都 eventually 跟了一条 bot note。如果某条 user note 后面没有 bot note，说明该 thread 有未回应的用户消息，需要处理。

**Answer:** 确认。

### Q22 (checkpoint 补充): Code-review trigger model

- Code-review pipeline 只在 PR 首次打开时自动触发
- 后续 review 需要手动 `/bot-review` 命令触发（通过 GitHub `issue_comment` event 实现）
- mr-lifecycle 的 push 不会自动触发 code-review

**Answer:** 确认。

### Q23 (checkpoint 补充): mr-lifecycle push state 不做 resolve

mr-lifecycle 在 push state 不再 resolve 任何 review thread，但可以在 thread 里 comment（比如说明做了什么修改）。Resolve 的权力完全交给 code-review pipeline。

**Answer:** 确认。

### Q24 (checkpoint 补充): 评论身份区分

- **mr-lifecycle** 的 comment 是用户身份（用用户的 token 发的），因为 mr-lifecycle 是本地 agent，以作者身份操作
- **code-review pipeline** 的 comment 是 bot 身份（CI 用的 bot token）

这意味着：
- code-review 判断"用户回复"时，mr-lifecycle 发的 comment 会被视为用户消息（因为 author 不是 bot）
- `[from bot]` 前缀只用于 mr-lifecycle 的回复，帮助区分是人还是 agent 写的

**Answer:** 确认。
