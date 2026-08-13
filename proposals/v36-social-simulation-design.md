# v3.6 社会模拟编排设计（Social Simulation Orchestration）

> 状态：提案待 LO 裁决。前置事实：apps/control-center 架构侦察（2026-07-19，agent-8）。
> 一句话：编排器从「主脑中继站」退位为「消息路由器 + 上下文编织者」；主脑降为 leader（平等中的首席）；每个 agent 成为可寻址、有持续身份的独立大脑；沟通真实但非强制——社会模拟，求效率与认知互补。

## 0. LO 的指令原文锚点

- 不再强制以主脑为入口
- 每个 agent 都是独立大脑，相当于一个团队的成员；主脑是 leader
- 各个 agent 之间真正交流沟通，像一个团队，但**不是强制的沟通**
- 本质是社会模拟，达到效率和认知的互补，达到高效和高智

## 1. 现状三大结构缺口（侦察实锤）

1. **无可寻址路由层**：`execute()` 把 turn 顺序写死（orchestrator.mjs:544-636），turn 目标是局部变量；全仓无消息对象、无 addressee、无收件箱。
2. **上下文靠人肉转述**：agent 感知彼此的唯一方式是 orchestrator 把上轮文本嵌进下轮 prompt（orchestrator.mjs:578/593/599）；原生 CLI 会话只能续自己（claude-cli.mjs:47 / codex-app-server.mjs:202 / grok-build.mjs:12），跨 CLI 不可续。
3. **同步回合制 + 无自治 + 身份台账游离**：turn() 是阻塞 request-response（:448）；steer 队列只服务 LO（:668-681）；roster.json 靠人工纪律维护（skills/review/codex-reviewer/SKILL.md:86），运行时只读展示（sessions.mjs:765）。

## 2. 目标模型

```
LO ──┐
     ▼
 ┌──────────── bus.jsonl（每 run 一条消息流，追加只写） ───────────┐
 │  LO任务 → leader 拆解 → A 说 → B 答 → A 补充 → leader 收敛     │
 └──────▲──────────▲──────────▲──────────▲──────────▲─────────────┘
        │          │          │          │          │
     claude     codex      grok       kimi        gemini
     (leader)  (独立大脑)  (独立大脑)  (独立大脑)   (独立大脑)
```

- **bus 是唯一真相**：所有轮次输出、LO 插话、agent 互答全部落 bus；turn prompt 从 bus 编织，不再由 coordinator 转述。
- **可寻址**：每条消息 `{from, to}`，to ∈ {agentId, "team", "lo"}；agent 通过输出约定 `[[msg:目标]]` 发起对话。
- **非强制沟通**：agent 没被点名可以沉默；leader 默认仍是任务拆解者，但任何成员可向任何成员发问或补充。
- **leader 非强制入口**：LO 可从 composer 直选「从谁开始」（默认 leader），也可在对话中点任何成员。

## 3. 组件设计

### 3.1 bus.jsonl 消息总线（v35 P2 预留落地）

- 落点：`.ai-shared/control-center/bus/<runId>.jsonl`，追加只写，随 run 生命周期。
- 消息：`{id, ts, runId, from, to, kind, text, refs?}`；kind ∈ `task|say|ask|answer|decide|steer|system`。
- 写入侧纪律沿用会话扫描：内容一律 scrub（赋值型+高熵双层脱敏，sessions.mjs:31-41 同款）。
- 全部流量镜像进 events.jsonl（审计链不断）。

### 3.2 `[[msg:目标]]` 输出约定（零适配器改动）

- 全部适配器输入是纯文本（侦察 §3.2），agent 在输出里写：
  - `[[msg:codex-technical]] 这段路由实现你看下有没有坑`
  - `[[msg:team]] 我这边证据不足，谁有 R8 的评审记录？`
  - `[[msg:lo]] 需要你拍板：删表还是保留`
- orchestrator 解析 turn 输出中的 msg 行 → 拆成 bus 消息 → 路由出后续 turn。无 msg 行=该 agent 本轮只对线程说了话（默认 to:"team"）。
- 防回环：同一 (from→to) 对在单 run 内最多 2 个往返；超出转 `decide` 给 leader 裁决；全局仍吃 maxRounds/budget 硬顶。

### 3.3 上下文编织（turn prompt = 头部契约 + bus 有界快照）

- 给 agent X 的 prompt：①团队名录与能力标签（TeamStore.brief 扩展"你可以对谁说"）②与本线程相关的 bus 尾部：发给 X 的、发给 team 的、decide/steer 类，带 speaker 标注 ③预算内截断（grok/kimi 24k 命令行上限是硬约束，快照按消息粒度从旧到新裁）。
- 彻底替代 orchestrator.mjs:578/593/599 的字符串内嵌模板。

### 3.4 运行时 roster（身份注册与发现程序化）

- 每个 turn 完成即登记：`{agentId, cli, sessionId, cwd, status, lastSeenAt, runId}` 写 `.ai-shared/control-center/roster.json`（从手工台账升级为运行时资产）。
- `GET /api/roster` 暴露给前端与 agent prompt（"群里谁在线、各自持有什么会话"）。

### 3.5 消息驱动主循环（execute v2，flag 切换）

```
seed bus(task from lo, to: 起始agent)
loop:
  取下一个待路由消息 → 为收件 agent 构造 turn（3.3 快照）
  turn 完成 → 输出落 bus → 解析 [[msg]] → 入队
  直到：无待路由消息（自然收敛）/ 超限 / LO 取消
```

- 旧硬编码拓扑保留为 `orchestration.mode: "pipeline"`（默认不变），新模式 `mode: "social"` 按 team/run 显式开启——先共存后默认，不掀桌子。
- steer/approval/recovery 全兼容：steer 进 bus（kind:"steer"）；turnAttempts 相位检查点不变（orchestrator.mjs:372-395）；歧义传输仍禁自动重放（:468-488）。

### 3.6 权限与边界（社会模拟 ≠ 授权模拟）

- workspace-write 仍只授给被路由选定的执行 agent；plan 级成员自由对话但始终只读——**认知互补不兑换权限**（soul-neutralization:65 糖衣≠授权；orchestrator.mjs:402-405 现有纪律延伸）。
- 审批按动作哈希绑定不变；任何 agent 提出的写盘动作都过同一 approval broker。
- 主脑「恒 plan」纪律保持（orchestrator.mjs:410）。

## 4. UI 映射（增量不重写）

- 会话流：bus 消息天然映射 message-row（头像/名字/CLI 徽标已有）；`[[msg:X]]` 渲染为「→ X」路由 chip。
- 会话拓扑：从 bus 的 from/to 直接构图（比现在的 turnAttempts 更真实）。
- composer：新增「从谁开始」选择器（默认 leader），续聊「发送给」已有。

## 5. 阶段划分

- **P1（本周可做）**：bus.jsonl + scrub 写入 + `[[msg:]]` 解析 + execute v2（social mode flag）+ 快照编织 + 运行时 roster + 防回环。UI 零改动（会话流吃现有事件）。
- **P2**：composer「从谁开始」直选（去主脑强制入口）+ ask/answer 挂起语义 + 路由 chip + bus 拓扑图 + `GET /api/roster`。
- **P3**：per-agent worktree 隔离 + 共享记忆（参考 lilith/memory-schema.yaml 的 candidate-first 三要素）+ Team MCP Mailbox（v35 :159 预留）。

## 6. 明确不做

- 不做可视化拖拽编排器（v35 :20 已否决，维持）。
- 不做 agent 自治常驻进程（社会模拟发生在 run 生命周期内，不养 daemon）。
- 不放开写权限给对话参与者——安全纪律一字不改。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| agent 互夸/互问死循环烧 token | 同对往返≤2 + decide 收敛 + maxRounds/budget 硬顶 |
| 快照超 24k（grok/kimi） | 消息粒度从旧到新裁剪，超载落 `system` 摘要消息 |
| 多 agent 写盘冲突 | 写权限仍单点授予；P3 worktree 隔离根治 |
| 隐私面扩大（对话全文落盘） | bus 写入即 scrub；预览/展示复用现有脱敏链 |
