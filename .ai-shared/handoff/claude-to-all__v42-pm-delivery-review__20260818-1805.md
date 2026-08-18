<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# v42 Control Center 交付审核包（交项目经理）

- **时间**：2026-08-18
- **作者**：主驾 AEMEATH
- **给谁**：项目经理（路线图 `proposals/v42-control-center-product-roadmap.md` 的 owner）
- **用途**：审核 R0–R3 是否收口、标出该完善的残差、不要把未激活当成已上线
- **正式版本**：仍 **v3.5.0**。未 git add / commit / push。正式 Control Center **未 reload**。

> **复审覆写（2026-08-18 20:02）**：本包的“R0-R3 实现任务已经做完”被独立复审推翻。当前审核入口改为 `codex-to-claude__v42-pm-delivery-review-r2__20260818-2002.md`；本文件仅保留为 Cursor/主驾原始交付声明与历史证据。

---

## 1. 结论（请项目经理先批这四句）

1. 项目经理方案里 **R0 → R3 的大部分源码与契约已接线，但整体未完成**。R0-01、R0-02、R0-04、R3-01 仍分别受真实回读、Git 集合、远程关闭实机、独立命令证据限制；R4 按进入条件暂缓。
2. 闭环 `项目识别 → 派工 → 执行 → 协作 → 干预 → 证据 → 恢复 → 交付/激活` 已有主要源码路径；交付门和激活门仍红，且早先 release command evidence 可被客户端自述的问题已在复审中加固。
3. 本包 **不能** 写成“工程门 ready 的材料已齐”，只能写成“本地源码/测试材料显著完善，Git 交付、server-observed 命令证据和正式运行态仍 blocked/partial”。
4. 独立复审已完成并落盘；后续优先级是显式 Git 交付授权、真实 provider/SSH 回读、受控 server-observed QA runner、正式实例 reload/readback，不再开无关功能波。

---

## 2. 北极星对照

| 北极星 | 源码现状 | 激活现状 |
|---|---|---|
| 看懂项目 / 团队 / 席位 / 运行身份 | 项目桥四面 + 首次就绪四步 + 团队注意力 | 正式实例未吃到这波源码 |
| 发送前知道谁执行、成本是否真实 | 派工预演：`createdRun:false`；`cost.usd=null` → 未知 | 未在正式进程点过预演 |
| 执行中知道谁在做、哪里要人决定 | Inbox 可答/ACK；注意力中心；社会协作 opt-in | 未 reload |
| 失败后知道可否继续、会不会重复打 provider | 回放只读；`replayable` 恒 false；`submitting/ambiguous` 禁自动重放 | 未 reload |
| 结束前拿到证据与交付状态 | Artifact 卡永不「已发布」；准备交付不自动 merge；交付门不自动 git | live 交付闸因未跟踪 must_ship **blocked**（闸在工作） |
| 不把本地测试当正式激活 | releaseTruth / releaseRecord 无当轮 evidence 不能 claimed | 本包遵守 |

---

## 3. 波次账本（R0–R3）

### R0 可信发布基线

| ID | 状态 | 主证据 | 仍需项目经理看见的残差 |
|---|---|---|---|
| R0-01 Unicode 契约 | 已做 | `prompt-transport.mjs`；`claude-to-all__r0-trusted-baseline__20260818-0735.md`；烛 R1 `codex-to-claude__r0-trusted-baseline__20260818-0720.md` | 烛补强：argv 闸挡不住 **stdin 席位走 powershell.exe -File**。合同是「已知不安全路径先封死」，不是端到端回显。生产路径不调用 `assertEchoMatches`。 |
| R0-02 delivery ownership | 已做 | `delivery-ownership.json` cut `v42-r0`；`qa:delivery --strict` | 未跟踪 must_ship → strict 红。这是闸门，不是模块失败。变绿需 LO 授权 git add。 |
| R0-03 releaseTruth + workflow | 已做 | `release-truth.mjs`；环境舱运行态行 | 无当轮 validationEvidence 不得 claimed；脏树只能 stale。 |
| R0-04 shutdown / provider race | 已做 | `app.mjs close()`；provider deletion-recheck | leftover 只观测不 undelete；close 超时不 abort 底层 Promise（可能重叠一拍）。 |

### R1 可理解、可恢复的主路径

| ID | 状态 | 主证据 | 残差 |
|---|---|---|---|
| R1-01 锚点 + Bridge Doctor | 已做 | `project-bridge.mjs`；`claude-to-all__project-bridge__20260818-0815.md` | 客户端 cwd 被丢掉。无 git 搬家即新身份。 |
| R1-02 首次就绪 | 已做（DAG 外薄做） | `GET /api/readiness`；环境舱「首次就绪」 | `attention` 不算 ready；环境舱不 probeHealth。 |
| R1-03 派工预演 | 已做 | `enrichDispatchPreview` | 点预演不建 run、不打 provider。 |
| R1-04 回放 / 恢复 | 已做 | `GET /api/runs/:id/replay` | `replayable` 恒 false。继续只走既有 acknowledgeRecovery。 |
| R1-05 Artifact / evidence | 已做 | `run-artifacts.mjs` | `published` 硬 false。 |

### R2 团队消息协作

| ID | 状态 | 主证据 | 残差 |
|---|---|---|---|
| R2-01 Ask/Answer/ACK | 已做 | `inbox-lifecycle.mjs`；烛推翻 persist-then-append 已收 | ACK ≠ provider 成功。高影响动作拒绝。点击路径仍可能不传 `expectedRevision`（CAS 首答 revision=0）。 |
| R2-02 注意力中心 | 已做 | `GET /api/teams/:id/attention`；烛先推翻 queued 双计，复扫 DELTA=0 | health 走 peek，不打探针。 |
| R2-03 受控社会协作 | 已做 | 默认 `pipeline`；`/social` 或 `orchestrationMode:"social"` 才社会模拟 | 烛抓住自动化侧门，已收。无点名不得隐式 social。 |

### R3 证据与交付产品化

| ID | 状态 | 主证据 | 残差 |
|---|---|---|---|
| R3-01 Delivery Gate 2.0 | 已做 | `GET /api/release-record`；`D-2026-08-18-007` | 不执行 QA、不自动 git。`formal-release` 只挡 publishable。烛 CLI 脏仓挂起，**独立评审未完成**。 |
| R3-02 准备交付 / 结算 | 已做 | `GET /api/runs/:id/settlement`；`D-2026-08-18-008` | `autoLanding` 全关。远程 `remote-unsupported`。无 `mergeable` 裁决。烛 Task unpaid invoice，**独立评审未完成**。 |
| R3-03 指标与运营观测 | 已做（本包收口） | `GET /api/observability/ops`；`D-2026-08-18-009` | 缺失成本 / 空样本 →「未知」。live 内存快照，重启清空。审批等待只观测 pending。烛通道仍不可用。 |

### R4 选择性扩展 — 暂缓（进入条件未满足）

| 能力 | 进入条件（路线图原文） | 本包判断 |
|---|---|---|
| 远程 agent 真实认证 | R0 编码/交付完成，SSH 主机可授权 | R0 源码完成，但交付未入 Git、正式实例未激活；**不要做真机 smoke** |
| Skill/MCP/Updater 制品账本 | 来源、digest、权限、回滚、签名信任根 | 签名信任根不存在；updater 保持 `blocked_external_trust` |
| Channels / Office 成熟化 | 真实 provider/渠道账号 + 文档渲染验收 | 无当轮授权账号 |
| 统一 Memory/Search | 搜索延迟或跨项目检索成为真实痛点 | 未成为痛点；不要引入 SQLite 第二真源 |
| 插件 / Adapter SDK | adapter contract 与兼容测试稳定 | 先 schema/fixture，未到开放第三方 |
| 富渲染、IDE、隧道、移动 gateway | 核心闭环连续稳定且有明确用户需求 | 明确非目标 |

明确拒绝（路线图 §11，本包未做且不应做）：全量 IDE、万能编排器、无限互聊、无签名市场、CCB daemon/tmux/mobile、用更多状态卡代替 read model。

---

## 4. LO 能直接看见什么（未 reload 则只存在于源码）

1. 环境舱：首次就绪、项目桥、交付门、准备交付。
2. 派工预演：权限档、成本未知、回退额外调用。
3. 任务回放 / 证据卡 / Inbox 答复与确认收到。
4. 团队注意力数字；社会协作默认关闭。
5. 终态卡「准备交付」；远程不假装有本机 worktree。
6. 体系观测：治理四卡 + **运营指标**（空窗口写「未知」）。

---

## 5. 验证（区分「我跑过」和「我没跑」）

### 我跑过

- R3-03 聚焦：`ops-metrics` + `health.peekMeta` + lucide sprite **20 pass / 0 fail**（2026-08-18 本轮）。
- R3-02 聚焦：settlement / mission-control / workbench git / UI 契约 **40 pass / 0 fail**（同日上一段）。
- R3-01：`release-record.test.mjs` 7 pass。
- 首批 DAG 上午：inbox / first-run / close 致命收口后的聚焦测试。

### 我没跑 / 不能声称

- 全量 `npm test`
- 浏览器 QA / 真实 provider 中文往返
- 正式 Control Center reload 后的 readback
- `qa:delivery --strict` 对未跟踪 must_ship **预期为红**
- 烛对 R3-01/02/03 的完整独立评审（通道残差见下）

---

## 6. 烛通道残差（请项目经理标为审核风险，不要当已过独立门）

| 波次 | 通道 | 结果 |
|---|---|---|
| R0–R2-01 | Codex 对话桥可用 | 有完整四节评审；Inbox persist-then-append 与 close 跳过 stop 被推翻并已改 |
| R2-02 / R2-03 | 可用 | queued 双计、自动化 social 侧门被抓住并已收 |
| R3-01 | CLI 脏仓 `git status` 挂起 | **partial**，见 `codex-to-claude__v42-r301-delivery-gate__20260818-1545.md` |
| R3-02 | Task unpaid invoice | **partial**，见 `codex-to-claude__v42-r302-settlement__20260818-1735.md` |
| R3-03 | 同上，本轮未再点火 | **未评** |

项目经理若要求「证据门 = 独立复核通过」，则 R3 三件 **尚未过证据门**。实现门可以记完成；证据门请项目经理决定：等烛通道恢复后再扫，还是接受主驾聚焦测试作为临时门。

---

## 7. 请项目经理审核并完善的清单

建议按优先级改路线图 / 给 LO 的拍板稿，而不是再开新功能波。

1. **R3 证据门**：是否阻塞发布，直到烛对 `release-record` / `run-settlement` / `ops-metrics` 各出一份四节评审？
2. **R0-01 生产残留**：是否把「stdin + win32 + non-ASCII 拒绝 `.ps1` / 给 claude·gemini 补原生 exe 偏置」升为 R0 hotfix，还是维持当前合同（已知 argv 路径先封死）？
3. **交付闸变绿路径**：写进发布 runbook——`git add` 授权 → 确定提交/干净 checkout 上运行 QA → 由受控 runner 生成 `server-observed` 命令证据 → reload → 环境舱 readback。`PUT /api/release-record/commands` 仅是 `operator-attested`，不能独自把工程门变绿。当前缺授权，闸红是正确的。
4. **版本真源**：继续 v3.5.0 未发布波次，还是开正式版本议题？本包 **不推荐** 在未激活、未独立评 R3 时升格。
5. **远程 agent**：本季度目标还是「能力已实现、真实验收待授权」？本包推荐后者。
6. **Inbox CAS**：点击路径补 `expectedRevision` 是 P1 缺陷还是可随下个协作波次？
7. **运营指标窗口**：live 内存是否够用，还是要在 R4 才做持久化时序？本包认为 live 已满足 R3-03 最小交付，不要提前建第二真源。

路线图 §14 原五条拍板题仍然有效。本包对 1/4/5 的推荐：Unicode 已不再是「唯一 P0」（R0 已封已知路径，但生产残留还在）；release scope 可收 R0–R3 源码，**不可**收「已发布」；版本不升；远程不进本季度真机。

---

## 8. 文件索引（审核时打开这些就够）

| 角色 | 路径 |
|---|---|
| 路线图 | `proposals/v42-control-center-product-roadmap.md` |
| 决策 | `D-2026-08-18-002` … `D-2026-08-18-009`（`.ai-shared/decisions.md`） |
| 上午 DAG 收口 | `.ai-shared/handoff/claude-to-all__v42-pm-closeout__20260818-0915.md` |
| R3-01 | `.ai-shared/handoff/claude-to-all__v42-r301-delivery-gate__20260818-1550.md` |
| R3-02 | `.ai-shared/handoff/claude-to-all__v42-r302-settlement__20260818-1740.md` |
| R3-03 | `.ai-shared/handoff/claude-to-all__v42-r303-ops-metrics__20260818-1755.md` |
| 本审核包 | `.ai-shared/handoff/claude-to-all__v42-pm-delivery-review__20260818-1805.md` |

---

## 9. 回滚

不 git add，所以正式树没有这波。丢弃工作区即可回到上一提交。不要 `reset --hard`（并行 agent 可能有未提交改动）。

__DELTA__: 主驾 | 1 | 证据：R0-R3 账本与 R4 暂缓交项目经理审核；激活门仍红。见本文件
