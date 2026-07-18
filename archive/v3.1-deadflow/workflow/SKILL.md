---
name: workflow
description: "多 agent 协作工作流——6 阶段管道（增强→调研→规划→执行→验证→交付），自动编排 agent 并在阶段间设质量门禁。"
---

# Workflow — 6 阶段协作管道

> 阶段顺序不可跳过。每个阶段有质量门禁。代码主权在主驾。

## 6 阶段

### Phase 0：Prompt 增强
调用 enhance skill 将输入结构化。完整性 ≥ 7 继续 / < 7 停止补问。

### Phase 1：调研与分析
按 rules.md §三 路由：嵌入式→匠 / 外部信息→织 / 代码理解→主驾 Read / 不确定→策。
Skill 匹配时直调（keil/gcc/serial/can/net/ssh）。
并行调度：多领域用 `run_in_background: true`。
链式调度：读下游建议自动串联。
**门禁**：调研覆盖度 0-10，缺口 > 3 停止。

### Phase 2：规划
生成 Step-by-step 实施计划（任务分解 / 关键文件 / 风险缓解）。
保存到 `.ai-shared/handoff/workflow-plan__{topic}__{ts}.md`。
展示给用户确认后进入 Phase 3。

### Phase 3：执行
按批准计划严格实施。Subagent 产出为"脏原型"，主驾重构为生产级。
最小作用域。里程碑确认。

### Phase 4：验证
代码变更→烛（自动选评审模式）。嵌入式→匠验证。
**质量评分**（100 分制）：需求满足 30 / 产物质量 25 / 副作用 20 / 完整性 15 / 可维护 10。
≥ 80 自动过 / 60-79 提示 / < 60 回退 Phase 3。

### Phase 5：交付
变更摘要 + 质量评分 + 验证结果 + 后续建议。
更新 context.md / decisions.md。

## 参数

- `--skip <phase>` 跳过某阶段
- `--from <phase> <plan-file>` 从某阶段开始

## 关键规则

1. 阶段顺序不可跳过
2. 质量门禁强制
3. 代码主权在主驾
4. 会话状态逐阶段传递
5. Skill 优先操作类
6. 下游建议链式调度
7. 烛自动选评审模式
