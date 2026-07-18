---
outputFile: "{output_folder}/workflow-research__{topic}__{date}.md"
---

# Step 02 — 调研与分析

## MANDATORY EXECUTION RULES
- 🛑 调研覆盖度 < 7 且缺口 > 3 必须停止补充
- 📋 并行调度独立 agent，串行调度有依赖的

## 调度路由

**Agent**：嵌入式→匠 / 外部信息→织 / 代码理解→主驾 / 不确定→策
**Skill**：编译→keil/gcc / 抓包→serial/can/net / 远程→ssh
**并行**：多领域用 `run_in_background: true`
**链式**：读下游建议自动串联

## 质量门禁
调研覆盖度 0-10。缺口 > 3 → 停止补充。
通过后输出调研简报，进入 step-03。
