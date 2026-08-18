<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 复扫：v42-pm-closeout-r2

- **评审模式**：standard / iteration（只读复扫上轮两条致命 + first-run ready）
- **评审范围**：`server.mjs` Inbox 写序；`collaboration-inbox.mjs` pendingAsks；`app.mjs close()`；`first-run-readiness.mjs` ready
- **评审时间**：2026-08-18 09:05
- **Codex 模型**：Cursor 烛 subagent 直审（本会话未注册 `codex-agent` MCP；未伪装对话桥连续）
- **对照**：`.ai-shared/handoff/codex-to-claude__v42-pm-closeout__20260818-0850.md`

---

## 致命问题（必须改）

无。上轮两条致命按磁盘现状已死。

1. **Inbox persist-then-append 假完成**
   `server.mjs:1452-1481` 现在先 `bus.append`（稳定 id `inbox-answer:${runId}:${messageId}` / `inbox-ack:...`），再 `inboxLifecycle.apply`。append 失败则 apply 不会跑。
   `bus.mjs:571-580` 同 id 同载荷直接返回已有行，重试不会再造第二条。
   `collaboration-inbox.mjs:209-213`：`stored=answered` 不再摘待办；必须 `answeredAskIds`（bus 上真有 `answerToAskId`）或 stored 为 `failed` / `expired` / `acknowledged`。
   上轮「待办清零、pendingAsk 还在」的读模型谎言对 `answered` 不再成立。

2. **close() 重试跳过 `automations.stop`**
   `app.mjs:554-558` stop 失败：`reportPhase` + `automations.start()` + `closeTasks.delete("automations.stop")`。
   `app.mjs:577-581` proxy 失败：同样 `reportPhase`（上轮缺的那档）+ `start()` + 删除 stop 缓存。
   下次 `close()` 会重新停调度器。成功后的二次 close 幂等（`492-500`）未动。

3. **顺手：first-run `attention` 当通过**
   `first-run-readiness.mjs:77-80` 非门闩步骤必须全是 `ready`。`first-run-readiness.test.mjs:30-36` 无探针时 `ready === false`。上轮建议 1 已收。

## 建议改进（值得讨论）

1. **Inbox 读模型仍缺「stored=answered 且 bus 无 answer」的单元钉**
   `collaboration-inbox-ui.test.mjs:27` 只钉了 append 在 apply 之前。`collaboration-inbox.test.mjs` 没有 lifecycleByKey=`answered`、bus 无 answer 时 pendingAsks 必须留下的断言。逻辑在 `209-213` 已对，缺的是防回归钉。

2. **空正文 answer 进不了 `answeredAskIds`**
   `collaboration-inbox.mjs:167` 要求 `message.text` 非空。API 若 `text:""`，append 可能成功（`validBusRecord` 只要求 string），读模型仍把 ask 留在待办。UI `prompt` 会挡住空答复（`collab-flow.js`），HTTP 直打不会。这是 fail-closed，不是假完成。

3. **`settleCloseStep` 超时仍不 abort 底层 Promise**
   上轮建议 5 的残差。现在失败会删 stop 缓存并 `start()`，重试会再 stop，原致命已死。超时那一拍仍可能 stop/start 重叠。不是调度器被跳过。

## 可保留（看似奇怪但合理）

1. **fail / expire / acknowledged 仍可只靠 stored 摘待办**
   这是主驾本轮写明的规则，不是 `answered` 回潮。

2. **ACK 仍写 system，且 `ackMeansProviderSuccess: false`**
   不进 `answeredAskIds`。单独 ACK 不会靠 bus 摘待办，只能靠 stored=`acknowledged`。与「ACK ≠ provider 成功」一致。

3. **append 成功、apply 失败时，待办会按 bus 摘掉**
   与上轮相反：bus 已有 answer，读模型认 bus。重试同 id 幂等，apply 可补。方向正确。

4. **cleanup 失败路径仍不 `start()`、不删 stop 缓存**
   proxy 已 commit，调度器应保持停。与「失败则复活调度器」只发生在 commit 前一致。

5. **预演 / replay / published / v3.5.0** 本轮未重开，仍按 R1 可保留。

## 总评

两条致命按当前磁盘已死。Inbox 待办改认 bus（或终态 stored），不再被单独的 `answered` 账本涂绿。close 在 proxy/stop 失败后会重启调度器并丢掉 stop 缓存，下次会再停。first-run `attention` 不再算 `ready`。
残差是测试钉和超时不 abort，不构成把待办或关闭窗口重新涂绿。本轮不推翻主驾收口。

---

## 下游建议

### 建议召唤
不必。若补 `pendingAsks` 回归钉，主驾直达即可。

### 风险信号
- `lifecycle` 展示仍可能是 stored `answered`，待办计数已改认 bus——两处不要再混成一个绿灯
- close 超时重叠仍在，但重试不再跳过 stop

__VERDICT__: APPROVED
__DELTA__: 烛(Codex) | 0 | 证据：server.mjs:1452-1481 先 append 再 apply；collaboration-inbox.mjs:209-213 answered 不再摘待办；app.mjs:554-581 失败 start()+delete(automations.stop)+proxy reportPhase；first-run-readiness.mjs:77-80 attention 不算 ready。上轮两条致命已死，无新推翻。
