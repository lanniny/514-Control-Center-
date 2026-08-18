<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 评审：v42-pm-closeout

- **评审模式**：standard
- **评审范围**：R0-04 close/provider 竞态；R1-03 派工预演；R1-04 回放；R1-05 证据卡；R1-02 首次就绪；R2-01 Inbox 写路径
- **评审时间**：2026-08-18 08:50
- **Codex 模型**：Cursor 烛 subagent 直审（本会话未注册 `codex-agent` MCP；未伪装对话桥连续）
- **总 token**：n/a

---

## 致命问题（必须改）

1. **Inbox `answer` 先落盘再写 bus，幂等重试会把失败吞成「已答复」**
   `server.mjs:1452-1470` 先 `inboxLifecycle.apply()`，成功后才 `bus.append(kind: "answer")`。`inbox-lifecycle.mjs:65-66` / `188-189`：同一 `idempotencyKey` 或 `state === target` 直接 `replayed: true` 且不再 persist。
   `collab-flow.js:522-528` 的 key 是确定性的 `` `${action}:${runId}:${messageId}` ``。append 一旦失败，客户端按同一 key 重试 → 生命周期已是 `answered` → **跳过 append**。
   读模型 `collaboration-inbox.mjs:209-213` 见 stored `answered` 就把该 ask 从 `pendingAsks` 摘掉。编排器从不走 `resumePendingAsk` / `continue`（`server.mjs:1462-1471` 只有 bus 写）。
   结果：Inbox「待 LO 回答」变 0，run 仍停在 `pendingAsk` / `pausedForInput`。这不是第二编排器，是更糟的**假完成**。ACK 文案守住了「≠ provider 成功」；**答复路径把待办计数当绿了**。

2. **`close()` 在 proxy 失败后会重启调度器，重试却跳过 `automations.stop`**
   `app.mjs:552` 先停 automations，任务记入 `closeTasks` 且成功后保持 `fulfilled`。`app.mjs:576-578` proxy 失败（含 `settleCloseStep` 超时，`app.mjs:54-65` 的 `Promise.race` **不取消**底层 close）会 `automations.start()`，然后 `640` 清掉 `closePromise`。
   第二次 `close()`：`526-547` 复用已 fulfilled 的 `automations.stop`，**不再停调度器**，却继续拆 proxy / 资源。这直接违反同段注释「关闭窗口不再产生新 run」。
   成功后的二次 close 幂等（`492-500`）是对的；**未 commit 失败后的重试不是死锁，是调度器复活 + 跳过 stop**。

## 建议改进（值得讨论）

1. **`ready` 把 `attention` 算作通过，环境舱会点绿灯**
   `first-run-readiness.mjs:77-78`：非门闩步骤只要 `ready || attention` 且无 `blocked` 就算 `ready`。`unpaid-validation` 无探针时是 `attention`（`58-64`）。`environment-panel.js:195-201` 用 `ready ? "ok" : "unknown"`。没有本机探针的四步未齐，环境舱仍可能显示「首次就绪 ready」。GET `/api/readiness` 本身恒 200（`server.mjs:1060-1061`），501 门闩只在远程配置面（`app.js:2437-2450`），两边语义没有焊在同一条 UI 上。

2. **provider `deletion-recheck` 只观测、不回滚；锁收口了 HTTP 窗口，测试没打并发**
   `providers.mjs:2034-2052` commit 后发现 `staleReferences` 只 emit `provider.reference_race`，不 undelete。`referencesForProvider`（`app.mjs:226-235`）读的是内存 `providerReferenceCatalogs`；`control.models` 事务里 candidate 会挂上（`324-331`），所以走 `mutateRuntimeSeats` / `apply` 的席位写入，锁内多半能看见。
   `server.mjs:1511-1527`、`1671` 把 switch / apply-team / remove 纳入 `withRuntimeSeatMutation`——主驾「HTTP 锁收口」成立。`provider-race.test.mjs:9-23` 只做源码切片匹配，没有交错用例。recheck 失败还被 `2048-2050` 吞成 `check_failed` 仍返回 `removed`。

3. **Inbox 写路径不校验 bus 上是否真有该 ask，UI 也不传 CAS**
   `server.mjs:1446-1461` 只认 team + run 存在。任意 `messageId` 都能 answer/ack。`collab-flow.js:522-528` 不传 `expectedRevision`，CAS（`inbox-lifecycle.mjs:68-72`）在点击路径上是死代码。高影响动作拒绝（`24-32`、`54-55`）是对的。

4. **环境舱 / Mission 证据读取吞错**
   `server.mjs:1044` `collectLiveReadiness().catch(() => null)`：就绪行直接消失，不像故障。`2000-2006` handoff/DELTA `.catch(() => [])` 后仍 `exists: true`，观测失败会变成「没有证据」而不是「读失败」。`run-artifacts.mjs:67` / `mission-control.mjs:647` 的 `published: false` 本身没伪称发布。

5. **`close()` proxy 失败不记 phase；超时不 abort**
   automations.stop 失败会 `reportPhase(..., error)`（`555`）；proxy 失败直接 throw（`576-578`），phases 里缺这一档。`settleCloseStep` 超时后原 Promise 继续跑，和重试复用 `closeTasks` 叠在一起，归因和并发清理都变脏。

6. **证据卡 `mentionsRun` 用标题前 48 字做包含匹配**
   `run-artifacts.mjs:72-78`：通用短标题可能误挂无关 handoff。有 `published: false` 兜底，但卡片集合会脏。

## 可保留（看似奇怪但合理）

1. **主驾「预演不建 run / cost unknown 不当 0」成立**
   `router.mjs:35-38` unknown 保持 `usd: null`；`55` `createdRun: false`；`71-72` `signals.cost` 跟 `costStatus`。`server.mjs:2071-2105` 只调 `router.preview`，白名单服务端推导。

2. **主驾「replay 只读、不新建 provider 请求」成立**
   仅 GET（`server.mjs:1924-1946`）。`replayActionability` 的 `replayable` 恒 false（`run-replay.mjs:45`）；`submitting/submitted/ambiguous` 进 `AUTO_REPLAY_BLOCKED`（`12`、`42`）；继续只指向现有 `acknowledgeRecovery` / orchestrator controls（`48-49`）。`taskGraph.source` 只标 `persisted`。

3. **主驾「证据卡不伪称 published」成立**
   `projectEvidenceArtifact` 硬写 `published: false`；Mission 附加层再写一次（`mission-control.mjs:637-648`）。UI 对 handoff/delta 标「未宣称已发布」（`mission-control.js:296`）。

4. **主驾「正式版本仍是 v3.5.0，未激活」成立**
   `module.yaml:3` 仍是 `3.5.0`。`release-truth.mjs:41-49` 无当轮 readback 不得 `claimed`。环境舱写「没有当轮 readback，不能称为已激活」。

5. **主驾「Inbox 不是第二编排器」字面成立，但不能当验收结束**
   写路径不 `create` / `continue` / `resumePendingAsk`；响应带 `createdRun: false`（`server.mjs:1486-1491`）。ACK 文案和 `ackMeansProviderSuccess: false` 守住了「ACK ≠ provider 成功」。致命问题 1 是假完成，不是第二条编排链。

6. **switch / apply-team 纳入 `withRuntimeSeatMutation` 成立**
   与 remove / seat mutate / reload 同一条链。这收口的是 HTTP 交错，不是 recheck 回滚。

7. **成功 close 的二次调用幂等**
   `closed === true` 返回缓存结果（`app.mjs:493-500`）。进行中的第二次 close 共用 `closePromise`（`502`）。cleanup 失败标 `retryable: true` 且不重启 automations（已过 proxy commit）——这条路径是对的。

8. **501 当门闩不是故障——在远程配置面成立**
   `app.js:2437-2450` 把 501 / `REMOTE_GATE_BLOCKED` 收成 `gated`。`first-run-readiness.mjs:67-74` 的 `capability-gate` 文案一致。不要把它理解成 `/api/readiness` 会回 501。

## 总评

六条主线里，预演 / 回放 / 证据卡 / 版本未激活四条按主驾判断站得住，测试也对准了「不当 0、不建 run、不自动 replay、不宣称 published」。
R0-04 的 HTTP 锁是真收口；recheck 是观测哨，不是事务回滚。真正没焊死的是两条写路径：Inbox 答复的 persist-then-append + 确定性幂等，以及 close 在 proxy 失败后重启 automations 却把 `automations.stop` 当成已完成。LO 能感知到的是：Inbox 待办清零但任务还在等；关进程时调度器可能又活过来。
主驾五条原判断：**预演 / replay / 版本 /「Inbox 不是第二编排器」字面不被推翻**；**「跨 Store 窗口已收口」只在 HTTP 锁意义上成立，recheck 不能当关闭证明**。净增量是补强，不是整条推翻。

---

## 下游建议

### 建议召唤
无需策/织。主驾收口两条致命后，用同一会话再扫 `server.mjs` Inbox 与 `app.mjs close()` 即可。

### 风险信号
- Inbox 待办计数变成「答复已落地」的唯一可见信号，却不碰 `pendingAsk`
- close 重试路径依赖 `closeTasks` fulfilled 缓存，和「失败则 start()」互斥
- 首次就绪 `ready` 与环境舱 `ok` 共用一个布尔，`attention` 被当成可派工

__VERDICT__: CHANGES_REQUESTED
__DELTA__: 烛(Codex) | 1 | 证据：server.mjs:1452-1470 persist 后 append，同 key 重试跳过 bus；app.mjs:576-578 proxy 失败 start() 后 526-547 跳过已 fulfilled 的 automations.stop。未推翻「预演不建 run / replay 只读 / 版本仍 v3.5.0」。
