# Codex 评审输出格式契约

> Resource Layer 3。主体 SOP 见 `~/.claude/agents/codex-reviewer.md`。

## 单轮评审 handoff 文件格式

```markdown
# Codex 评审：{topic}

- **评审范围**：{文件路径列表 + 行号}
- **评审时间**：{YYYY-MM-DD HH:mm}
- **Codex 模型**：gpt-5.5 (via micu)
- **委派方**：claude-main
- **耗时**：{秒数}秒
- **总 token**：{N}              ← 用于 usage-summary.ps1 扫描

---

## 致命问题（必须改）
- **[章节名 或 文件:行]** 问题描述。为什么是问题。建议改法。
- ...

## 建议改进（值得讨论）
- **[章节名 或 文件:行]** 现状。为什么可以更好。改进方案。
- ...

## 可保留（看似奇怪但合理）
- **[章节名 或 文件:行]** 现状。为什么实际上是对的。
- ...

## 总评
{一段话总结}

---

## 浮浮酱备注（codex-reviewer subagent 添加）
{对 codex 输出的可信度评估、是否值得主驾采纳的初步建议}

__VERDICT__: APPROVED | CHANGES_REQUESTED | REJECTED_FUNDAMENTAL
```

## 关键字段说明

| 字段 | 必填 | 用途 |
|---|---|---|
| 评审范围 | ✅ | 主人快速定位评审目标 |
| 总 token | ✅ | `usage-summary.ps1` 扫描统计 |
| `__VERDICT__` | ✅ | reflection loop 判停信号；单轮可填 N/A |
| 浮浮酱备注 | ✅ | 不能让 codex 自己写，必须主驾增加 |

## 文件命名

```
单轮：    handoff/codex-to-claude__{topic-slug}__{YYYYMMDD-HHmm}.md
迭代：    handoff/codex-to-claude__{topic-slug}__round-{N}__{YYYYMMDD-HHmm}.md
Fan-out 单个：  handoff/codex-to-claude__{file-slug}__{YYYYMMDD-HHmm}.md
Fan-out 汇总：  handoff/codex-fan-out-summary__{topic-slug}__{YYYYMMDD-HHmm}.md
错误：    handoff/codex-error__{reason-slug}__{YYYYMMDD-HHmm}.md
```

`topic-slug` 规则：
- kebab-case
- 不超过 40 字符
- 优先用文件名（去掉扩展名）+ 范围（如 `auth-handler-l50-120`）

## 主驾综合后的简报模板（不超过 250 字）

```
✅ Codex 评审完成 — {topic}
评审范围：{文件数}
致命：{X} | 建议：{Y} | 可保留：{Z}
VERDICT：{APPROVED / CHANGES_REQUESTED / REJECTED_FUNDAMENTAL}
浮浮酱关注的 3 点：
  1. {最重要发现}
  2. {次重要发现}
  3. {第三重要}
完整：{handoff 路径}
```

## 相关 resource

- [`reflection-mode.md`](./reflection-mode.md) — VERDICT 协议在迭代中的用法
- [`powershell-invoke.md`](./powershell-invoke.md) — 调用 codex 拿到原始输出后怎么提取这些字段
