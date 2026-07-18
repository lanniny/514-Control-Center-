# 决策记录（不可删除，仅追加）

> 已做出的关键决策。任何 CLI 在动作前先读这里，避免反复推翻。
>
> **v1.2 结构化格式**：每条决策用 markdown 子标题（`### D-<date>-<n>`）开头 + 字段化元数据 + 自然语言正文。
> 字段化元数据用于 `/co-status` 统计采纳率、token 消耗等指标。

---

<!--
决策追加模板（复制到下方"决策列表"开头，按时间倒序）：

### D-YYYY-MM-DD-NNN · {一句话决策标题}

- **date**: YYYY-MM-DD
- **topic**: <kebab-case-slug>
- **triggered_by**: <user | claude | codex | gemini>
- **decision_maker**: <主人 | 浮浮酱>
- **verdict**: <approved | partial | rejected | deferred>
- **adopted**: <true | false | partial>      ← 用于采纳率统计
- **source_handoff**: <相对路径，如 handoff/codex-to-claude__xxx.md>
- **token_cost**: <整数估算，如 19351>        ← 用于 token 统计
- **tags**: <逗号分隔，如 prompt-engineering, security, refactor>

#### 决策
{决策内容详细描述}

#### 理由
{为什么这么决策}

#### 后续行动（如有）
{需要主驾后续做什么}

---
-->

## 决策列表
