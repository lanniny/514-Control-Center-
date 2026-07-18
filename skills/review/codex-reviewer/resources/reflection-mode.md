# Reflection 迭代评审完整工作流

> Resource Layer 3。主体 SOP 见 `~/.claude/agents/codex-reviewer.md`。
> 触发：主驾传 `mode=iterative, max_iterations=N` 或 `/co-review --iterate`。

## 工作流图

```
[Round 1] 评审目标 → 落 handoff round-1.md → 返回 CHANGES_REQUESTED
   ↓
[主驾改代码（小步快跑，单次 1~3 处）]
   ↓
[Round 2 起 — 必须先召唤 Gemini 拉外部资料 — 破 mirror-loop]
   评审改后代码 + Gemini 资料 → 落 handoff round-N.md
   ↓
... 直到 APPROVED 或达到 max_iterations
```

## VERDICT 协议

Codex 每轮评审摘要末尾**必须**输出一行：

```
__VERDICT__: APPROVED            ← 完全通过，循环停止
__VERDICT__: CHANGES_REQUESTED   ← 还有问题，继续下一轮
__VERDICT__: REJECTED_FUNDAMENTAL ← 根本性问题，建议主人推翻重做
```

主驾根据这一行做循环判停。

## 🪞 Mirror-loop 防护（强制）

**第 2 轮起**，Codex 评审前**必须**让主驾召唤 Gemini 拉一份外部参考资料（如官方文档 / 最佳实践 / 类似项目案例），作为评审锚点。

**为什么**：[arXiv 2510.21861](https://arxiv.org/pdf/2510.21861) 实验发现，纯 LLM 闭环（A 评 → B 改 → A 再评）会出现"信息衰减"——双方逐渐互相吹捧并强化错误共识。引入外部资料能打破这种闭环。

**怎么做**：在主驾召唤你做 Round 2+ 评审时，prompt 里必须**已经包含** Gemini 拉来的外部资料；若没包含，你应该拒绝评审，先回复"需要先召唤 Gemini 拉 [具体资料类型]，再开 Round 2"。

**豁免**：主人显式说"这次不用 Gemini" → 跳过，但必须在 handoff 注明"主人豁免了 mirror-loop 防护"。

## 每轮文件命名

```
handoff/codex-to-claude__{topic-slug}__round-{N}__{YYYYMMDD-HHmm}.md
```

最后一轮**额外**包含"迭代总结"小节：

```markdown
## 迭代总结
- 总轮数：N
- 起点问题数：致命 X / 建议 Y
- 终点问题数：致命 X' / 建议 Y'
- 引入的外部资料：[Gemini handoff 路径列表]
- 最终判定：APPROVED / TIMEOUT_AT_MAX_ITERATIONS / INTERRUPTED_BY_USER
```

## 终止条件

| 状态 | 触发 | 后续动作 |
|---|---|---|
| `APPROVED` | Codex 输出 `__VERDICT__: APPROVED` | 写最后一轮 + 迭代总结 + 告知主人 |
| `TIMEOUT_AT_MAX_ITERATIONS` | 达到 max_iterations 仍 CHANGES_REQUESTED | 写迭代总结，标记 timeout，建议主人手动介入 |
| `INTERRUPTED_BY_USER` | 主人中途叫停 | 立即停止，写迭代总结到当前轮次 |
| `REJECTED_FUNDAMENTAL` | Codex 认为是根本性设计问题 | 立即停止，建议主人推翻重做 + 用 `/co-research` 补调研 |

## 性能与成本

- 每轮 Codex 调用 ~30-60s + 19K~25K token
- Gemini 拉资料 ~30-40s + 5K~15K token
- 主驾改代码 视改动量
- **典型 3 轮迭代**：~10 分钟 + 总 80K~120K token
- 因此 `--iterate` 默认上限 3，不建议主人轻易设到 5

## 与 fan-out 模式的关系

```
/co-review src/ --card firmware-diff-review --iterate    ← ⚠️ 危险组合（成本爆炸）
```

主驾遇到 `--iterate` + 多文件时**强制**：
- 询问主人是否真的要 iterate 每个文件
- 上限改为 `--iterate 2`
- 提示总成本估算

## 相关 resource

- [`powershell-invoke.md`](./powershell-invoke.md) — 单次调用细节
- [`output-format.md`](./output-format.md) — VERDICT 协议详细
- [`../../../guardrails/dangerous-ops.md`](../../guardrails/dangerous-ops.md) — 守卫规则
