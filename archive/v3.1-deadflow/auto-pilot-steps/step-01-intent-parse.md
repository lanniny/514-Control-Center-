---
outputFile: ""
---

# Step 01 — 意图解析与路由决策

## MANDATORY EXECUTION RULES
- 🛑 不跳过意图分析直接执行
- 📋 你是路由器，不是执行器——本步只决定路径
- 🎯 复杂度评估必须有依据

## 流程

### 1. 静默 Prompt 增强
分析用户输入的意图、约束、边界。读取 `.ai-shared/context.md` 和 `decisions.md`。
补全为 5 字段结构化需求（不展示，不等确认）。
需求完整性评分：≥ 5 继续 / < 5 中断提问。

### 2. 复杂度评估
| 级别 | 判据 | 数值 |
|------|------|------|
| 低 | 单文件 / 单步 / 明确答案 | 1-3 |
| 中 | 多文件 / 需分析 / 有技术决策 | 4-6 |
| 高 | 多步骤 / 跨模块 / 多 agent / 架构变更 | 7-10 |

### 3. 双表扫描
**表 A — Agent 匹配**：烛/织/匠/策/鉴
**表 B — Skill 匹配**：keil/gcc/jlink/openocd/probe-rs/can/serial/net/ssh/docx/ppt

### 4. 三路判定
- 表 B 强命中 + 操作动词 → 🔧 Skill 直调 → step-02
- 表 A 强命中 + 分析动词 → 🤖 Agent 召唤 → step-02
- 两表均未命中 → 🚀 主驾直达 → step-03
- 两表都命中 → 串联（Agent 先→Skill 后）→ step-02

## 输出
将路由决策（策略 + 目标 agent/skill + 复杂度 + 结构化需求）传给 step-02。
