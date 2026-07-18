---
outputFile: ""
---

# Step 02 — 上下文扫描

## MANDATORY EXECUTION RULES
- 🛑 不跳过扫描直接出规格——重复造轮是浪费
- 📋 输出"重叠/互补/冲突"三项分析

## 扫描来源

| 来源 | 看什么 |
|------|--------|
| decisions.md | 已决策（不重新讨论） |
| context.md | 活跃任务、阻塞 |
| handoff/*.md | 最近协作产出 |
| module.yaml | 已有 skill 清单 |
| CHANGELOG.md | 体系演化轨迹 |

## 输出

```markdown
## 上下文扫描结果
### 重叠（已有类似能力）
### 互补（可复用的现有组件）
### 冲突（与现有决策矛盾）
```

分析完成后 → step-03。
