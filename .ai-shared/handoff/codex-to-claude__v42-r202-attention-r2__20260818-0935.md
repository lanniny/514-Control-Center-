<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 复扫：v42-r202-attention-r2

- **评审模式**：standard / iteration（只读复扫上轮 1 致命 + 2 条已收建议）
- **评审范围**：`team-attention.mjs` EXECUTING_RUN_STATES；`collab-flow.js` attentionSeqByTeam；`collaboration-inbox.mjs` lifecycleRevision
- **评审时间**：2026-08-18 09:35
- **Codex 模型**：Cursor 烛 subagent 直审（无 `codex-agent` MCP；主人指定只读复扫，无外部资料要求）
- **对照**：`.ai-shared/handoff/codex-to-claude__v42-r202-attention__20260818-0925.md`
- **验证**：`node --test tests/team-attention.test.mjs tests/inbox-lifecycle.test.mjs tests/collaboration-inbox.test.mjs tests/collaboration-inbox-ui.test.mjs` → 11 pass / 0 fail

---

## 致命问题（必须改）

无。上轮唯一致命按磁盘已死。

1. **queued 双计进 `activeJobs` / 席位 busy**
   `team-attention.mjs:4-6` 抽出 `EXECUTING_RUN_STATES` = `ACTIVE_RUN_STATES` 去掉 `queued`。`seatActiveJobs`（`53-56`）和 `activeJobs`（`90`）都走这集合；`queueDepth` 仍只认 `status === "queued"`（`84`）。
   上轮红钉已绿：`tests/team-attention.test.mjs:59` `activeJobs === 1`，同条 `queueDepth === 1`、`activeJobId === "run-active"`、queued 席位不再被标 busy。

## 建议改进（值得讨论）

1. **`fetchSeq` / `lifecycleRevision=0` 还没有行为钉**
   `collaboration-inbox-ui.test.mjs` 只认 `expectedRevision:` 字符串还在。没有断言 `attentionSeqByTeam`、旧包继续渲染、ask 无行时 revision 为 `0`。逻辑在磁盘上对，缺的是防回归。

2. **旧 attention 丢掉后 Inbox 走空态，不保留上一帧**
   `collab-flow.js:126-129` 把旧包收成 `data.attention = null`，然后照常 `renderHero` / `renderInbox`。整页不再因旧包卡在骨架——上轮建议已收。副作用：Inbox 在「fulfilled 但过期」时变成「暂无消息」，英雄数字回退 `team-panel` busy。不是旧包覆盖新状态，只是这一拍 Inbox 空白。要更稳可以留 last-good attention。

## 可保留（看似奇怪但合理）

1. **`fetchSeq` 按 `team.id` 分序**
   `collab-flow.js:34` `attentionSeqByTeam`；`125-127` 只和本团队 previous 比。A 团队高序不再挡住 B。`version !== refreshVersion` 的整次放弃（`103`、`121`）是新刷新已接管，不是旧包涂页。

2. **首答 CAS 已接电**
   `collaboration-inbox.mjs:207-211`：无 stored 的 ask 投影 `lifecycleRevision: 0`。按钮 `data-revision="0"`，`collab-flow.js:547` 送 `Number("0") === 0`。`inbox-lifecycle.mjs:61` 默认行也是 `revision: 0`；`68` `0 != null` 成立，`0 === 0` 放过。并发另一把钥匙带 `expectedRevision: 0` 会 409。UI 确定性幂等键仍先于 CAS，那是重试语义，不是空 revision 跳过。

3. **Inbox `ACTIVE_RUN_STATES` 仍含 queued**
   `collaboration-inbox.mjs:15-17` 没改。那是「未终态」不是「执行中」。attention 执行桶已经拆开。

4. **花名册仍走 `team-panel`**
   上轮建议 1，本轮主驾没说收。不重开为致命。

## 总评

三处都按声明落地。queued 不再进执行中；旧 attention 只丢信封、其余区块照画；无 lifecycle 行的 ask 带 revision 0，首答比较会跑。同源测试从红转绿。本轮不推翻主驾收口。残差是缺两颗回归钉，以及旧包丢弃后 Inbox 空一拍——都不把数字重新叠回去，也不把整页钉死在骨架上。

---

## 下游建议

### 建议召唤
不必。

### 风险信号
- UI 切片测试还停在「字段在不在」，没钉「queued 不算执行中 / 按团队拒旧包 / 首答 rev=0」
- 花名册 busy 尺若以后要和英雄数字对齐，另开一轮，别混进这三处

__VERDICT__: APPROVED
__DELTA__: 烛(Codex) | 0 | 证据：team-attention.mjs:4-6,90 EXECUTING 去 queued；tests/team-attention.test.mjs:59 已绿；collab-flow.js:34,126-129 按 team 分序且旧包不整页返回；collaboration-inbox.mjs:207-211 ask 无行 revision=0。上轮致命已死，无新推翻。
