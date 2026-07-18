---
name: status
description: "协作健康仪表盘——扫描 .ai-shared/ 输出 handoff 数/决策数/活跃度/token 估算/采纳率/DELTA 覆盖，30 秒看完。"
---

# Status — 健康仪表盘

> 30 秒看完当前项目的协作健康度。

## 扫描指标

| 指标 | 来源 | 说明 |
|------|------|------|
| 活跃 handoff 数 | handoff/*.md | 排除 archive/ |
| 归档数 | handoff/archive/ | 按月份统计 |
| 决策记录数 | decisions.md | 最近一条日期+主题 |
| 近 N 天活跃度 | handoff 时间戳 | 烛/织 各多少次 |
| Token 估算 | handoff 内 token 字段 | 累计 |
| 采纳率 | decisions.md adopted 字段 | 如已结构化 |
| **DELTA 覆盖** | **decisions.md + handoff `__DELTA__` 双扫** | 手动巡检：列出最近发火缺 `__DELTA__` 的项（真机械扳机是 stop-gate.py Stop hook，v3.2 已接电；本表是补充视图，非唯一防线） |
| **路由白发率** | `__DELTA__=0` 占比 | 按路由类别统计，喂 auto-pilot 白发刹车（铁律5） |

## 参数

- `--brief`（默认）5 行摘要
- `--full` 展开明细
- `--since <N>` 只统计最近 N 天（默认 7）
- `--json` JSON 输出

## 输出格式（brief）

```
📊 协作健康度 — {project}
━━━━━━━━━━━━━━━━━━━
活跃 handoff：N 个（归档 M 个）
决策记录：K 条
近 {N} 天：X 次召唤
累计 token：~N,NNN
DELTA 覆盖：P/Q 发火已留痕（缺 R 个 ⚠️）｜白发 S 次
━━━━━━━━━━━━━━━━━━━
⚠️ 缺 DELTA 告警：{列出最近缺 __DELTA__ 的 handoff 文件名，无则省略}
💡 建议：{contextual tips}
```

## 约束

只读不写。1s 内完成。格式异常跳过不报错。`__DELTA__` 缺失即列入告警（这是机械审计的核心职责，不可静默忽略）。
