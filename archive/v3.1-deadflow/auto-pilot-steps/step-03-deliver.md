---
outputFile: ""
---

# Step 03 — 结果输出

## MANDATORY EXECUTION RULES
- 📋 必须包含执行路径和质量评估
- 🎯 变更文件清单不可省略

## 输出格式

```markdown
## ✅ Auto 完成

**策略**：{直达/精准调度/全管道}
**执行路径**：{调用了哪些 agent/skill}

### 结果
{核心产出——代码变更/分析结论/调研发现/设计方案}

### 质量
- 评分：{XX}/100
- 状态：{PASS/NEEDS_ATTENTION}

### 变更文件（如有）
| 文件 | 操作 |
|------|------|
```

## 收尾动作
- 如在项目目录下且有 `.ai-shared/` → 更新 context.md
- 如有重要决策 → 记录 decisions.md
- 如产生 handoff → 确认已落盘
