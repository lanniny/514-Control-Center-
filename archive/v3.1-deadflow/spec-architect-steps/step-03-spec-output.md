---
outputFile: "{output_folder}/architect-to-claude__{topic}__{date}.md"
---

# Step 03 — 输出规格 + 任务树

## MANDATORY EXECUTION RULES
- 📋 任务树必须是 DAG（有依赖和可并行节点）
- 🎯 每个任务指定推荐召唤的 agent/skill

## 规格（PRD-like）

```markdown
# 规格：{topic}
## 目标 (Why)
## 用户场景 (Who + What)
## 功能清单（P0 必须 / P1 应该 / P2 可以）
## 验收标准 (Done) — checkbox
## Out-of-scope
## 硬约束 / 风险
## 与现有体系的关系
```

## 任务树

```markdown
| ID | 描述 | 优先级 | 推荐召唤 | 依赖 | 验收 |
```

## 下游调度顺序

线性或 DAG（含并行/条件分支）。

落盘到 outputFile → 返回主驾简报。
