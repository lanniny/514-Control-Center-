---
outputFile: "{output_folder}/workflow-plan__{topic}__{date}.md"
---

# Step 03 — 规划

## MANDATORY EXECUTION RULES
- 🛑 计划必须经用户确认后才能进入执行
- 📋 任务树必须是 DAG，有依赖和可并行节点

## 输出

```markdown
## 实施计划：{topic}

### 任务分解
| # | 步骤 | 负责角色 | 预期产物 | 依赖 |

### 关键文件
| 文件 | 操作 | 说明 |

### 风险与缓解
| 风险 | 缓解措施 |
```

保存到 outputFile。展示给用户确认后进 step-04。
