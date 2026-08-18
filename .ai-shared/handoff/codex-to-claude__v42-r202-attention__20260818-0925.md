<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 评审：v42-r202-attention

- **评审模式**：standard
- **评审范围**：`apps/control-center/src/team-attention.mjs`；`server.mjs` GET `/api/teams/:id/attention` + Inbox 写序；`collaboration-inbox.mjs`；`inbox-lifecycle.mjs`；`health.mjs peek()`；`public/{api.js,collab-flow.js,team-panel.js,app.js,environment-panel.js}`
- **评审时间**：2026-08-18 09:25
- **Codex 模型**：Cursor 烛 subagent 直审（本会话未注册 `codex-agent` MCP；未伪装对话桥连续）
- **总 token**：n/a
- **验证**：`node --test tests/team-attention.test.mjs tests/inbox-lifecycle.test.mjs tests/collaboration-inbox-ui.test.mjs` → 4 pass / 1 fail

---

## 致命问题（必须改）

1. **`activeJobs` 把 `queued` 算进去，队列与执行中不是两个桶**
   `collaboration-inbox.mjs:15-17` 的 `ACTIVE_RUN_STATES` 含 `"queued"`。`team-attention.mjs:81-93` 用同一集合滤 `activeJobs`，再用 `status === "queued"` 滤 `queueDepth`。同一条 queued run 进两个计数。
   自写验收钉已红：`tests/team-attention.test.mjs:59` `attention.counts.activeJobs` **actual 2 !== expected 1**（`run-active` + `run-queued`）。`queueDepth === 1` 先过了，所以不是测试数据错，是投影把排队当成在跑。
   席位侧同样吃这集合：`team-attention.mjs:50-57` `seatActiveJobs`。queued 且带 `startAgentId` / `turnAttempts` 时，`classifySeatPresence`（`28-29`）会标 `busy`，英雄区「执行中席位」和「队列 N」叠同一条任务。
   这直接打穿验收 1（队列深度 / 活动席位必须可分、同源且不双计）。改法：`activeJobs` / `seatActiveJobs` 排除 `queued`，或另定义 `EXECUTING_RUN_STATES`；`ACTIVE_RUN_STATES` 给 Inbox「未终态」用可以保留。先让这条测试变绿再谈收口。

## 建议改进（值得讨论）

1. **花名册 / 流图仍走第二套席位投影**
   英雄数字吃 `data.attention.counts`（`collab-flow.js:209-219`）。花名册和 SVG 节点走 `buildTeamPanelData`（`131-141`、`243-257`），用 `/api/runs` + 晚到的 `/api/health`，不读 `attention.seats`。`team-panel.js:197-237` 的 busy 规则还要 `ACTIVE_ATTEMPT_PHASES`，和 `seatActiveJobs` 不是同一把尺。英雄「执行中席位」和卡片灯可能对不上。不是第二份持久化，是第二份 read model。席位 UI 应吃 `attention.seats`。

2. **`fetchSeq` 拒旧包会把整页钉在骨架上**
   `collab-flow.js:176` 先擦成骨架，`124-125` 见 `fetchSeq < lastAttentionSeq` 直接 `stale: true` 返回，不把已拉到的 teams/runs 画回去。`lastAttentionSeq`（`34`、`127`）跨团队共用。切团队或时钟回拨时，LO 看到的是空白旗舰页，不是「保住新状态」。拒旧包应只丢 attention，或按 `teamId` 分序，并回退上一帧。

3. **首答路径 CAS 仍可空**
   UI 已传 `expectedRevision`（`collab-flow.js:547`），上轮「点击路径不传」已死。但无 lifecycle 行时 `lifecycleRevision` 是 `null`（`collaboration-inbox.mjs:207`），按钮 `data-revision=""` → 服务端 `expectedRevision != null` 不成立（`inbox-lifecycle.mjs:68`）。首答（最常见点击）仍不走 CAS。ACK 在首次 apply 之后才真正有 rev。要焊死就给 ask 投影一个 `0`，空 revision 直接 409。

4. **`peek()` 不看 TTL**
   `health.mjs:149-151` 只回 `this.cache.items`。attention 不打探针（对，见可保留），但会把过期探针当席位真相。空 cache → `unknown` 不涂绿，这条是对的；有旧 cache 时会一直 `ready`，直到别的调用方跑 `all()`。

5. **页头脉搏仍是另一套涂色**
   `app.js:13681-13685`：`available === true` 先于 `degraded` 涂 `ok`。本机探针里 `degraded` 与 `available` 互斥（`health.mjs:101-102`），本地不容易误绿；外部探针若同时给 `degraded` + `available:true`，页头会绿。不在 attention 投影里，但是本轮点名的 `app.js` 残差。

## 可保留（看似奇怪但合理）

1. **空答复先拒再 append**
   `server.mjs:1494-1498` trim 后空正文抛 `VALIDATION_FAILED`，然后才 `bus.append`。`inbox-lifecycle.mjs:96-98` 再拒一次。`collab-flow.js:538` `!text` 挡住 cancel / 空串。上轮「HTTP 空正文可能进 bus」按当前磁盘已死。我跑过的 lifecycle / UI 切片测试是绿的。

2. **attention 不触发探针风暴**
   `server.mjs:1476` 用 `healthService.peek()`，不进 `all()`。`collectLiveReadiness` 默认 `probeHealth: false`（`server.mjs:224-228`）。`/api/health` 仍是独立 12s 轨道（`collab-flow.js:93-95`），不是 attention 扇出。

3. **四态涂色在 attention 投影内守住了**
   `classifySeatPresence`：job → busy，再 degraded / offline，最后 ready。`presenceTone` 对 busy/degraded/offline/unknown 都不回 `ok`。`tests/team-attention.test.mjs` 第一条「四态不得涂绿」通过。`GREEN_FORBIDDEN` 断言（`team-attention.mjs:109-111`）是安全带，在当前 `presenceTone` 下几乎不会炸。

4. **先 append 再 apply**
   `server.mjs:1499-1527`。与 R2-01 收口一致：bus 是答复真相；同 id 同载荷幂等，不同载荷 `BUS_MESSAGE_CONFLICT`（`bus.mjs:571-578`）。apply 失败时待办按 bus 摘，不是假完成。`createdRun: false` 仍在。

5. **没有第二套状态库；正式版本仍是 v3.5.0**
   attention 是 inbox + `orchestrator.list()` + peek + roster 的投影，无新 JSON。`delivery-ownership.json` / `CHANGELOG.md` / `module.yaml` 正式号仍 `3.5.0`。本轮评审不要求 `git add`。

6. **readiness 失败不再吞成 null**
   `server.mjs:1082-1089` catch 成 `ready: false, degraded: true`。`environment-panel.js:195-201` 走「首次就绪读取失败」+ `attention` 色，不点成 ready 绿。

## 总评

R2-02 的骨架是对的：一个 attention 信封、Inbox 嵌在里面、peek 不打探针、空答复进不了 bus、CAS 字段已经出现在点击路径、版本号没被偷升。
验收 1 没有过线。主驾自己的同源测试在 `activeJobs` 上红了——`queued` 被 `ACTIVE_RUN_STATES` 算成在跑。LO 能感到的是「队列里有一条，执行中也有一条」，其实是同一条。其余项（误绿、空答复、探针风暴、第二状态库、v3.5.0）按磁盘不是致命。先把 queued 从执行中桶拿掉，再让 `team-attention.test.mjs:59` 变绿。

---

## 下游建议

### 建议召唤
不必。主驾直改 `collectTeamAttention` 的执行中集合 + 复跑该测试即可。

### 风险信号
- 花名册若继续用 `team-panel` 自己的 busy 尺，英雄数字修了对、卡片仍可能漂
- 不要用「测试文件在」代替「测试绿」

__VERDICT__: CHANGES_REQUESTED
__DELTA__: 烛(Codex) | 2 | 证据：tests/team-attention.test.mjs:59 activeJobs 2!==1；team-attention.mjs:87-93 用含 queued 的 ACTIVE_RUN_STATES 算执行中，推翻「队列深度与活动席位已分桶同源」
