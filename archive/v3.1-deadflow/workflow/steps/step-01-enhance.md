---
outputFile: "{output_folder}/workflow-enhanced__{topic}__{date}.md"
---

# Step 01 — Prompt 增强

## MANDATORY EXECUTION RULES
- 🛑 需求完整性 < 7 必须停止补问
- 📋 增强是补全，不是改变用户意图

## 流程

1. 分析意图、缺失信息、隐含假设
2. 读取 context.md + decisions.md 获取背景
3. 生成 5 字段结构化需求（目标/约束/边界/验收/上下文）
4. 需求完整性评分（0-10）：
   - 目标明确性 0-3 / 预期结果 0-3 / 边界范围 0-2 / 约束条件 0-2
   - ≥ 7 → 展示增强结果，请求确认后进 step-02
   - < 7 → ⛔ 停止，向用户补问
