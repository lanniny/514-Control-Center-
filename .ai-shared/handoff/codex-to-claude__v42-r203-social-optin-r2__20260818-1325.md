<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 评审：v42 R2-03 social opt-in · R2 自动化收口复扫

- **评审模式**：standard（只读复扫；范围仅 automations trigger / 对应测试）
- **评审范围**：`apps/control-center/src/automations.mjs`（`#triggerLocked` `412-420`；`create`/`update` 是否落盘 `orchestrationMode`）；`apps/control-center/tests/automations.test.mjs:198-263`
- **评审时间**：2026-08-18 13:25
- **Codex 模型**：Cursor 烛 subagent 直审（无 `codex-agent` MCP thread；不伪装与 R1 对话桥连续）
- **总 token**：n/a
- **对照**：`.ai-shared/handoff/codex-to-claude__v42-r203-social-optin__20260818-1315.md` 致命 1

---

## 致命问题（必须改）

无。R1 致命已死。

`#triggerLocked` 现在先算 `requestedAgentIds`，再显式带 `orchestrationMode`（`automations.mjs:412-420`）：有点名成员或 `item.orchestrationMode === "social"` → `"social"`，否则 `"pipeline"`。这正好对上 `orchestrator.mjs:1858-1859` 的 social-only 门，不再用缺省 pipeline 去撞 `requestedAgentIds`。

两条钉是真钉、不是源码扫描：
- 无点名：`automations.test.mjs:220-223` → `pipeline`
- 有 `requestedAgentIds`：`automations.test.mjs:241-255` → `social`

无点名的内置体检播种（`seedBuiltinAutomations` `62-68`）也不带成员列表，走 pipeline。默认没有被重新打开成 social。

---

## 建议改进（值得讨论）

1. **[automations.mjs:280-306 / 315-338] `item.orchestrationMode === "social"` 这条腿 API 写不进去。** `create` 不收、不落该字段；`update` 的字段白名单也没有它；`automations-page.js` 不传。只有 `init()` 的 `...item`（`181-186`）会把磁盘上手写的 `orchestrationMode` 带进来。主驾口头合同有两扇门，产品面只焊了「有 requestedAgentIds」。要让第二扇门可测、可配，create/update/UI 得落盘；否则删掉这半句，避免假装已支持。

2. **测试仍是 fake orchestrator。** 两条钉锁的是 trigger **payload**，够杀死 R1 那种「根本没传 mode」。它们仍不证明真 `Orchestrator.create` 吃得下这次快照。R1 要的真 orchestrator 回归还没来；本轮不把它升回致命。

3. **没有「无 requestedAgentIds + item.orchestrationMode=social」用例。** 磁盘手改路径没钉。

---

## 可保留（看似奇怪但合理）

1. **用 `requestedAgentIds` 推导 social。** 不是「默认 social」。空数组被 `?.length` 收成 `undefined`，走 pipeline。点名成员在 orchestrator 里本来就只能 social，自动化这边自动对齐，避免保存能过、点火必炸。

2. **`requestedAgentIds ? "social"` 的真值。** 左边先做成「有长度才拷贝，否则 undefined」，不会出现空数组当 truthy。

3. **严格 `=== "social"`。** `Social` / `SOCIAL` / 未知值不当 social。无点名时 fail-closed 回 pipeline，对。

---

## 总评

这一处收口成立。R1 的「自动化带 requestedAgentIds 却不传 mode、点火必炸」已经不在。默认无点名仍是 pipeline；有点名才显式 social。

剩下的是完整度，不是门闩：`orchestrationMode` 字段还不能经 create/update 落盘，第二条合同腿只对磁盘手改活着；测试钉的是 fake 入参。不挡 R2-03 这刀。

---

## 下游建议

### 建议召唤

- 不必再为这一处召烛。要做就补 create/update 落盘 + 真 orchestrator 一条，不必再开评审回合。

### 风险信号

- 无新的默认-social / 无 recipient 路由信号。

__VERDICT__: APPROVED
__DELTA__: 烛(Codex) | 1 | 证据：automations.mjs:412-420 已显式传 social/pipeline，R1 致命死；create/update 仍不落盘 orchestrationMode，第二扇门只对磁盘手改生效
