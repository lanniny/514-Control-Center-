---
name: party-mode
description: "多 Agent 真并行 spawn——复杂问题让 2-4 个 agent 独立思考后综合。单 LLM 角色扮演会趋同，真独立 subagent 才有思维多样性。"
---

# Party Mode — 多 Agent 并行讨论

> 一个 LLM 扮演多个角色会趋同。真正独立的 subagent spawn 才有思维多样性。

## 核心机制

### Step 1：选择 Agent（2-4 个）

| 问题复杂度 | Agent 数量 |
|-----------|-----------|
| 简单问题 | 2 个（最相关的两位） |
| 中等复杂 | 3 个 |
| 复杂跨领域 | 4 个 |

从花名册（烛/织/匠/策/鉴）中选择与问题最相关的 agent。

### Step 2：并行 Spawn

**关键**：在单次响应中放出所有 Agent tool 调用，让它们并发执行。

每个 subagent 的 prompt 包含：
- 角色描述（从 module.yaml 的 agent description）
- 会话摘要（< 400 词，防 context 膨胀）
- 项目上下文
- 用户问题

**禁止 subagent 调用工具**——只输出观点。

### Step 3：呈现结果

**原文呈现**每个 agent 的回应，不合并不总结。
用 agent 的 icon + name 前缀标识：

```markdown
### 🕯️ 烛的观点
{原文}

### 🗺️ 策的观点
{原文}

### 🔧 匠的观点
{原文}
```

### Step 4：综合（可选）

如果用户要求综合，主驾提取：
- 共识点
- 分歧点
- 行动建议

## 防退化机制

| 现象 | 处理 |
|------|------|
| 全说一样 | 引入反对者或让某 agent 唱反调 |
| 陷入循环 | 总结僵局问用户 |
| 弱回应 | 不重试，让用户决定 |

## 参数

- `--model <model>` 强制所有 subagent 用指定模型
- `--solo` 降级为单 LLM 角色扮演（无 subagent 时）
