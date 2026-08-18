# 514cc Control Center v42 产品路线图与补强台账

> 版本：草案，不等同于已批准发布计划
> 日期：2026-08-18
> 角色：项目经理视角整理
> 目标：把“协作台继续完善”收敛为可交付、可验证、可运营的产品路线
> 2026-08-18 复审状态：`IMPLEMENTATION PARTIAL / DELIVERY BLOCKED / LIVE UNVERIFIED`。本状态覆写早先“R0-R3 实现任务已经做完”的笼统口径。

## 1. 结论先行

Control Center 当前不是缺少页面，而是缺少一条完整且可信的工作闭环：

```text
项目识别 -> 派工 -> 执行 -> 协作 -> 干预 -> 证据 -> 恢复 -> 交付/激活
```

现有实现已经覆盖了大量能力：多 CLI 团队、运行编排、审批与恢复、Mission Control、可写 Bus/Inbox 生命周期、配置图谱、远程主机、自动化、渠道、Office、市场和治理 hooks。真正影响产品质量的下一步，不是继续增加入口，而是补齐以下四类根节点：

1. **真实性**：中文提示词、运行态、成本、provider 健康和交付状态必须与用户看到的结论一致。
2. **可追责**：每个派工、回答、审批、恢复和交付都要有稳定身份、因果链和证据。
3. **可恢复**：失败后能知道发生了什么、是否可以继续、是否会重复执行，不能只显示一个红色状态。
4. **可收敛**：版本、工作流 packet、Git 交付集合和运行实例必须能结束，不允许长期悬挂在 `in_progress`。

## 2. 当前真实状态

| 面 | 当前能力 | 证据状态 | 项目判断 |
|---|---|---|---|
| 协作入口 | Workbench、run rail、composer、团队选择、多个 CLI 席位 | 源码、契约、隔离浏览器和四档响应式已有证据 | 本地隔离主路径可用；正式实例未 reload |
| 编排内核 | Orchestrator、预算、审批、recovery、taskGraph、事件与 bus | 全量 `npm test` 当前通过，精确计数见当轮 handoff | 内核基础扎实；真实 provider 与正式运行态仍未验收 |
| 消息收发局 | `514cc.collaboration-inbox/v1`、Ask/Answer/ACK、CAS、`runId + askId` | 聚焦测试 + 1440/820/390 定向浏览器验收 | 行内答复与 `expectedRevision` 已接线；多进程写入不是本轮合同 |
| Mission Control | 任务、活动、证据、连接、环境信息、replay/Artifact/settlement | 源码、单测和 UI 契约 | read model 已接线；正式实例未回读 |
| 配置与供应商 | 本机/远程图谱、备份、回退、provider 投影 | 契约较完整，远端真机仍有待验项 | 供应商引用跨 Store 竞态仍需独立收口 |
| 远程能力 | SSH 主机、探测、同步、远程 run、远程图谱 | 主要为契约/mock；真实主机闭环未完成 | 不应对外宣称“远程 agent 已上线” |
| 治理与交付 | route/stop/mirror、validate、qa:delivery、releaseRecord | `validate` 13 项通过；strict 因 31 个未声明源码/测试失败 | 交付明确 `blocked`；HTTP 自述命令证据不能开启工程绿灯 |
| 运行态 | 曾有真实 provider 隔离闭环 | 历史 handoff 有证据，当前实例未作本轮激活读回 | 必须区分历史事实、当前进程和新源码 |
| 版本 | 仓库真源仍为 v3.5.0 | `rules.md`/`module.yaml` | v4 功能已落地但未完成正式发布决策 |

### 2.1 必须升为 P0 的历史发现

2026-08-16 的真实 provider 隔离闭环记录报告：中文提示词到达 CLI 时变成 `?`，ASCII 正常。这是历史证据，不代表本轮已经重新复现，但它足以阻止“协作台中文主路径已可靠”的判断。本轮已补 `promptTransport/v1`、本地原生子进程 fixture、`.ps1` fail-closed 与审计写入超时；尚缺真实启用 provider 的接收回读和真实 SSH echo，因此 R0-01 仍是 `partial`，不是完成。

### 2.2 2026-08-18 独立复审裁决

| 波次 | 源码/契约 | 本地证据 | 交付/运行态 | 裁决 |
|---|---|---|---|---|
| R0-01 | 已接 `promptTransport/v1`、审计 fail-closed 与超时 | 本地 argv/stdin CJK fixture 通过 | 无真实 provider 回读、无真实 SSH echo | `partial` |
| R0-02 | ownership manifest 与 CI strict 已接线 | strict 如实报告 31 个未声明源码/测试 | 未获 Git 暂存授权 | `blocked` |
| R0-03 | releaseTruth、workflow 终态和环境舱已接线 | workflow 已是 `superseded` | 正式实例未 reload/readback | `partial` |
| R0-04 | provider re-check、关闭阶段日志、远端 TERM/KILL 回执等待已接线；`pkill` 失败不再被 `|| true` 抹平 | 故障注入、回执延迟/失败与关闭回归通过 | 未做真实 SSH 进程树确认；超时仍不能强制 abort 任意第三方 Promise | `partial` |
| R1 | 项目桥、首次就绪、预演、replay、Artifact 已接线；readiness 拒绝旧 evidence 与 stale health | 单测 + 环境舱浏览器 QA 通过 | 正式实例未回读 | `source-complete / live-partial` |
| R2 | Ask/Answer/ACK、attention、social opt-in 已接线 | 聚焦测试 + Inbox 定向浏览器 QA 通过 | 正式实例未回读 | `source-complete / live-partial` |
| R3 | releaseRecord、settlement、ops metrics 已接线；runner 已收紧为服务端 HEAD、干净工作树摘要与生命周期所有权 | 全量测试、validate、四视口浏览器 QA 通过 | strict 红；runner 会拒绝当前脏工作树，正式实例未执行/未 reload | `partial / blocked` |
| R4 | 按进入条件暂缓 | 无 | 无授权外部系统 | `deferred` |

## 3. 产品北极星与边界

### 3.1 北极星

用户在任意项目中能够：

1. 看懂当前项目、团队、席位和运行实例的身份；
2. 在发送前知道谁会执行、为什么选它、成本信息是否真实；
3. 在执行中知道谁正在做什么、哪里需要自己决定；
4. 在失败后知道是可继续、需确认、不可重放，且不会重复调用 provider；
5. 在结束前拿到可导航的证据、产物和交付状态；
6. 不把“本地测试通过”误认为“正式进程已激活”。

### 3.2 产品非目标

- 不复制 CCB 的 tmux、daemon、pane 或 mobile gateway 生命周期。
- 不把浏览器做成第二个 Orchestrator，不从 replay 页面直接重放 provider 请求。
- 不在没有签名信任根之前开放任意 Skill/MCP/Updater 一键安装。
- 不以“可视化 DAG”替代真实 taskGraph、事件和证据。
- 不为了追求上游功能数量而重写现有 vanilla JS/Node 架构。
- 不自动执行 `git add/commit/push`，不自动重启 LO 的正式实例。

## 4. 优先级定义

- **P0**：阻止发布、阻止可信使用或可能造成重复执行/数据误判的根问题。
- **P1**：日常协作主路径的高价值能力，P0 完成后立即推进。
- **P2**：增强效率、扩展覆盖面或降低长期维护成本。
- **P3**：可选生态与重型体验，只有在核心闭环稳定后进入。

## 5. 路线图总览

| 波次 | 主题 | 目标结果 | 依赖 |
|---|---|---|---|
| R0 | 可信发布基线 | 中文传输、交付集合、workflow 状态、版本和运行态边界可证明 | 无 |
| R1 | 可理解、可恢复的主路径 | 项目锚点、Bridge Doctor、派工预演、回放/恢复、首次使用引导 | R0 |
| R2 | 真正的团队消息协作 | Ask/Answer/ACK、队列、在岗状态、通知和幂等交付 | R1 |
| R3 | 证据与交付产品化 | Artifact 卡、交付证明、worktree 结算、发布流水线 | R1、R2 |
| R4 | 选择性扩展 | 远程真实认证、供应链账本、渠道/Office 成熟化、插件 SDK | R0-R3 |

## 6. R0：可信发布基线（P0）

### R0-01 Unicode/中文传输契约

**问题**：历史真实 provider 闭环出现 CJK 变成 `?`；协作台的中文任务可能被静默改写。

**交付**：

- 在 adapter 边界定义统一 `promptTransport/v1`，区分 argv、stdin、JSONL、SSH 通道；
- 为 Claude、Codex、Kimi、Grok、远程 runner 各加 UTF-8 往返 fixture；覆盖中文、emoji、组合字符、换行和超长 prompt；
- 记录脱敏后的 `inputDigest/byteLength/codePointCount/transport`，禁止记录原文和凭据；
- Windows 下同时验证默认 shell、PowerShell、原生 exe 和 `.ps1` 解析路径；
- 任何 adapter 出现 `?` 替换或 digest 不一致时，run 必须进入明确的 `provider_error`，不能报告成功。

**完成标准**：每个已启用席位至少一组真实子进程回读 + 一组集成测试；中文和 ASCII 的输入 digest 一致；远程 SSH 通道另有一组非付费 echo 验证。

### R0-02 交付集合与 ownership manifest

**问题**：`qa:delivery --strict` 当前仍发现 31 个未声明源码/测试；物理测试能执行，不代表提交和 CI 会包含它们。

**交付**：

- 建立 tracked `delivery-manifest`，逐项标记 `must_ship / generated / scratch / deferred / owner`；
- `qa:delivery` 从“全量报 drift”升级为“有意图的交付集合校验”，未声明的源码/测试仍失败；
- CI 增加 strict manifest、`git diff --check` 和 package-lock 一致性检查；
- 交付报告列出源码、测试、配置、文档和验证产物的关联，而不是只统计文件数；
- 明确本次 release 的 cut 范围，其他协作者改动不被静默混入。

**完成标准**：Control Center release focus 内无未声明源码/测试；干净 checkout 可复现 `npm ci && npm run validate && npm test`；报告可反查到 handoff 和 owner。

### R0-03 运行态、版本和 workflow 终态对账

**问题**：仓库 v3.5.0 与已落地 v4 波次不一致；正式进程、源码 generation、验证和 Git 交付集合仍可能互相不一致。`.workflow/ultracode/collab-console-review-20260815/state.json` 已收为 `superseded`，但旧路线图与 handoff 一度仍引用 `executing/pending`，说明文档本身也必须进入一致性检查。

**交付**：

- 设计 `releaseTruth/v1`：`sourceCommit/diffDigest/runtimeGeneration/pid/cwd/startedAt/validationEvidence`；
- 在现有环境舱/Mission Control 里增加只读一致性状态：`consistent / stale / degraded / unknown`；
- workflow packet 具备 `complete / blocked / superseded` 终态和过期检测，禁止无限 `in_progress`；
- 版本升格前补 CHANGELOG、module、context、CI 和 handoff 的一致性校验；
- 任何“已激活/已发布”文案必须引用当轮 readback，不能只引用历史测试。

**完成标准**：可从一个页面回答“这份代码、哪个进程、哪次验证、哪个交付集合”；没有证据时显示未知而不是绿色。

### R0-04 关闭链与 Provider 引用竞态收口

**问题**：shutdown 已有共享 deadline，但 provider 引用检查与 commit 之间仍存在跨 Store 窗口；关闭失败后的完整重试语义仍需独立工程化。

**交付**：

- provider 写操作纳入 ConfigManager commit lock 或 commit 后强制 reference re-check；
- 关闭阶段每个可等待步骤都有剩余预算、取消和可重试结果；
- second close/reopen 具备幂等语义，阶段日志可归因；
- 增加并发故障注入：删除/切换/热重载/关闭交叉执行。

**完成标准**：失败不会把已删除 provider 当作 active；重复 close 不死锁、不吞错误；完整回归失败时能指出具体 phase。

## 7. R1：可理解、可恢复的主路径（P1）

### R1-01 稳定项目锚点 + Bridge Doctor

**用户价值**：同一个项目的源代码、运行时、进程和证据不再靠 cwd 猜测或人工拼接。

**最小交付**：服务端规范化 `projectId + canonical cwd`，生成不可变 `anchorId` 和 repository fingerprint；输出 `project-bridge/v1` 快照：`source/runtime/process/evidence/consistency`。前端复用现有环境舱和 Mission Control，不新建孤立仪表盘。

**安全边界**：anchor 只是只读关联键，不替代 `runId/team/member/adapter`；客户端不能提交任意路径；敏感内容只返回 digest、状态和脱敏标签。

**验收**：同一路径复用、路径移动、分支切换、进程重启、旧 evidence 混入和缺失 source 各有测试；浏览器能明确显示 stale/unknown。

### R1-02 首次使用与健康就绪向导

**用户价值**：新用户不需要先理解 10 个视图、provider、team、skill 和 gate。

**最小交付**：首次进入只问四件事：项目锚点、默认团队、可执行席位、一次非付费验证；给出 readiness checklist 和下一步按钮；能力门 501 变成“为什么被挡 + 如何授权”的引导，不把门闩当成故障。

**验收**：空数据、缺 CLI、未授权、部分健康、已有项目五种状态都能完成或明确停在某一步；刷新不会丢草稿。

### R1-03 Provider 派工预演器

**用户价值**：发送前知道候选席位、路由原因、健康、权限、预算和回退路径。

**最小交付**：复用 router preview 和真实 health；显示 `capability/quality/speed/health/cost` 证据来源；适配器没有 `costUsd` 时显示“未知”，不承诺美元硬上限；显示 fallback 会产生的额外调用和审批。

**验收**：同一任务在健康/离线/degraded/成本未知时给出不同且可解释的结果；预演不创建 run、不触发 provider。

### R1-04 协作运行回放与恢复中心

**用户价值**：失败不再只能看最后一条红字。

**最小交付**：新增只读 `GET /api/runs/:id/replay`，把 EventStore、BusStore、taskGraph、attempt、approval、interrupt、resumeClaim、recoveryNote 关联成稳定 event id；提供时间线、筛选、截断标记和“可操作性”字段。

**恢复边界**：任何 `submitting/submitted/ambiguous` 默认不可自动 replay；继续/放弃只调用现有 Orchestrator 准入；不从文本列表重建 DAG。

**验收**：中断、超时、审批等待、远程失败、部分证据、截断和未知状态均能回放；恢复动作不会新增一次 provider 请求。

### R1-05 证据与 Artifact 卡

**用户价值**：handoff、DELTA、diff、测试和运行结果从“文件名”变为可导航的交付对象。

**最小交付**：在会话流和 Mission Control 中以卡片展示 artifact 类型、来源、digest、生成时间、验证命令和状态；点击能回到对应消息/attempt；原文仍走服务端脱敏和权限边界。

**验收**：artifact 不存在、被截断、digest 变化、来自旧 run 时分别显示；卡片不能伪称已发布。

## 8. R2：真正的团队消息协作（P1/P2）

### R2-01 Ask/Answer/ACK 生命周期

**问题**：当前 Inbox 是只读投影，没有回答、确认、失败和重试的持久语义。

**交付状态机**：

```text
ask -> delivered -> answered -> acknowledged
                     |            |
                     v            v
                  failed       expired
```

- 唯一键：`runId + messageId`；回答关系还需 `conversationId` 或显式 parent ref；
- 写入采用 CAS/幂等 key，浏览器重复点击不重复执行；
- ACK 只确认消息交付，不等于 provider 任务成功；
- 所有状态变化写 BusStore + events 审计镜像；
- 默认不允许 Inbox 直接执行高影响动作，动作仍走既有 approval endpoint。

**验收**：重复提交、迟到 answer、跨 run 同 ID、断网重试、过期消息、权限不足和服务重启均保持单一终态。

### R2-02 队列、在岗状态与注意力中心

**交付**：统一显示 pending queue、active job id、席位 lastSeen、blocked reason、需要 LO 的动作；通知按 run/team 分组，不制造第二套状态库。

**验收**：队列深度、活动席位和 Inbox 数字来自同一 read model；旧响应不能覆盖新状态；offline、busy、degraded、unknown 四态不混成绿色。

### R2-03 受控社会协作模式

**交付**：把 `v3.6 socialLoop` 作为显式 opt-in orchestration mode；agent-to-agent message 必须有 recipient、预算、深度和回环上限；默认仍保持现有 pipeline，不强迫所有任务进入社会模拟。

**暂不做**：无限自治、自动互聊、从最终文本反推团队图。

## 9. R3：交付与运营产品化（P1/P2）

### R3-01 Delivery Gate 2.0

将 `qa:delivery`、CI、workflow、handoff、版本和运行态证据合成一个可审计 release record。发布前必须有：

- 交付 manifest 无未声明源码/测试；
- `validate`、focused tests、full tests、browser QA 的退出码和时间；
- 当前 commit/diff digest；
- runtime PID/cwd/generation 是否重新加载；
- 未完成项明确 `partial/blocked`；
- 不自动 commit/push。

**证据信任边界**：`PUT /api/release-record/commands` 只接受操作者申报，必须标为 `operator-attested`，不能单独把工程门变成 `ready`。只有服务端实际观测、同时绑定当前运行实例（PID/startedAt/generation）、当前提交和干净工作树摘要，并保留退出码/耗时的 `server-observed` 证据才可作为独立证据；同提交的旧进程证据也不能复用为“当轮验证”。

受控 runner 位于 `apps/control-center/src/release-command-runner.mjs`，经 `GET/POST /api/release-record/runner*` 暴露。命令目录固定、无 shell；HTTP 的 `sourceCommit` 只作为期望值，服务端始终独立读取 HEAD；重复/空/未知命令选择在执行前拒绝；起始工作树非 clean、run 期间 HEAD、diff 摘要或运行实例变化均 fail-closed；关闭会取消活动子进程，活动 runner 会阻止 runtime reload。证据只能经 `saveObserved` 写入。四类当前实例证据全部通过后，服务端才聚合为 live `validationEvidence` 并交给 `releaseTruth`；旧的无工作树锚、无 runtime 锚或不同实例 evidence 均不能开启工程门。同一 runtime identity + commit + diff digest 下允许不同 `runId` 增量补齐四类证据；任一锚变化即失效。该 runner 尚未在正式实例上对不可变提交执行过，R3-01 仍是 `partial`。

**发布 runbook（当前缺口也写进流程）**：

1. LO 明确授权 Git 暂存与提交范围，关闭 31 个未声明成员并形成不可变提交；
2. 从该提交的干净 checkout 启动或 reload 正式实例，先读回 PID/cwd/generation/sourceCommit；
3. 对同一 sourceCommit 由受控服务端 runner 运行 validate、聚焦测试、全量测试与浏览器 QA；
4. 回读 `server-observed` 行、diff digest 与 runtime 一致性，不能用 HTTP 客户端自述替代；
5. 只有 strict、独立命令证据、运行态对账和 formal-release 决策同时满足时，才允许 `publishable=true`。

### R3-02 Worktree / Diff / 结算中心

把现有 worktree、git plan/execute、run diff、artifact 和恢复状态统一成“准备交付”流程。系统只生成 plan、差异和风险，不自动 merge；远程 run 继续显示 `remote-unsupported` 等真实边界。

### R3-03 指标与运营观测

只记录低敏摘要：首个有效响应时间、run 成功/失败/恢复率、审批等待时间、stale 状态数、route fallback 次数、证据完整率、provider costUsd 可用率、中文传输失败数。不得把缺失成本当 0。

## 10. R4：选择性扩展（P2/P3）

| 能力 | 进入条件 | 备注 |
|---|---|---|
| 远程 agent 真实认证 | R0 编码/交付完成，SSH 主机可授权 | 按主机逐 CLI 做真实 smoke；不把 mock 结果当上线 |
| Skill/MCP/Updater 制品账本 | 有来源、digest、权限、回滚和签名信任根 | 继续保持 `blocked_external_trust` 的 updater 不变 |
| Channels / Office 成熟化 | 有真实 provider/渠道账号和文档渲染验收 | 先做可靠性与权限，不先扩 UI |
| 统一 Memory/Search | 搜索延迟或跨项目检索成为真实痛点 | 先复用现有只读 roots/search，避免过早引入 SQLite 第二真源 |
| 插件/Adapter SDK | adapter contract、能力矩阵和兼容测试稳定 | 先写 schema/fixture，再开放第三方 |
| 富渲染、IDE、隧道、移动 gateway | 核心闭环连续稳定且有明确用户需求 | 这些不是当前 P0 |

## 11. 暂缓或明确拒绝的方向

1. 全量 IDE 重写、可拖拽万能编排器：会放大维护面，不能解决真实性和恢复问题。
2. 无边界 agent 自治和自动互聊：会增加成本、回环和审计难度。
3. 在没有签名信任根前的一键安装市场/Updater。
4. 直接复制 CCB 的 daemon/tmux/mobile gateway 生命周期。
5. 以“更多状态卡片”替代稳定 read model 和证据链。

## 12. 项目管理机制

### 12.1 每个功能必须有七项字段

`Who / What / Why / Done / Out-of-scope / Constraint / Risk Appetite`。缺字段只能进入 discovery，不进入实现排期。

### 12.2 每个波次必须过四道门

1. **规格门**：依赖、owner、验收和回滚明确；
2. **实现门**：代码、契约、错误态和权限边界齐全；
3. **证据门**：测试、浏览器/运行态或真实外部系统证据与声明匹配；
4. **交付门**：manifest、版本、handoff、workflow packet 和 Git 集合一致。

### 12.3 推荐责任分工

| 角色 | 责任 |
|---|---|
| LO/主驾 | 产品取舍、危险操作授权、最终发布判断 |
| 策 | PRD、任务 DAG、依赖和 out-of-scope |
| 烛 | 安全/正确性/性能/交付闸独立复核 |
| Codex executor | 有边界的后端与协议实现 |
| Kimi 前端席位 | UI、响应式、浏览器行为和视觉证据 |
| 鉴 | 治理、版本、状态机和漂移审计 |
| 织 | 仅在需要当前外部事实/竞品/长文档时提供来源 |

## 13. 首批执行顺序

```text
R0-01 Unicode 契约
  -> R0-02 delivery ownership manifest
  -> R0-03 releaseTruth + workflow 终态
  -> R0-04 shutdown/provider race
  -> R1-01 anchor + Bridge Doctor
  -> R1-03 dispatch preview
  -> R1-04 replay/recovery
  -> R1-05 Artifact/evidence
  -> R2-01 Ask/Answer/ACK
```

原因：先修“用户输入是否被正确传输”和“我们是否真的交付/激活”，再做协作体验；否则新的 Inbox、回放和状态卡只会把错误事实呈现得更漂亮。

## 14. 需要 LO 拍板或授权的决策

1. **Git 交付授权**：是否批准按显式 manifest 暂存 R0-R3 的 31 个未声明源码/测试；未授权前保持 blocked。
2. **真实 provider 验收**：是否允许对每个启用席位做一次低成本中文/ASCII 接收回读；本轮建议批准后再宣称 R0-01 完成。
3. **真实 SSH 验收**：是否提供一台已授权主机执行非付费 UTF-8 echo 与进程树 TERM/KILL readback；未授权前远程保持 `live-unverified`。
4. **正式实例激活**：何时允许 reload 正式 Control Center；本轮不主动执行。
5. **版本真源**：继续维持 v3.5.0 未发布波次，还是在上述四门闭环后另开正式版本议题；本轮明确不建议现在升格。
6. **服务端证据 runner**：已实现并加固（`src/release-command-runner.mjs` + `/api/release-record/runner*`）；必须在 Git 闭包形成不可变提交、正式实例从该提交 reload 后执行，当前脏工作树会被明确拒绝。

## 15. 证据锚点

- `apps/control-center/DESIGN-NOTES.md:40-47`：协作台主路径与既有 roadmap；`DESIGN-NOTES.md:147-157`：socialLoop 与 ask/answer 等待语义仍有历史债。
- `.ai-shared/context.md` 的 2026-08-18 活跃波次与当前风险：当前交付、运行态、版本和安全边界。
- `.ai-shared/decisions.md` 的 `D-2026-08-18-002` 至 `D-2026-08-18-013`：R0-R3 决策、独立复审纠错、Git 产品闭包与 DELTA。
- `.ai-shared/handoff/codex-to-claude__comprehensive-console-review__20260817-1645.md`：交付、shutdown、运行态和产品头脑风暴。
- `.ai-shared/handoff/kimi-to-claude__shutdown-chain-deadline__20260816-1137.md:100-110`：真实 provider 闭环及中文提示词乱码历史证据。
- `.workflow/ultracode/collab-console-review-20260815/state.json`：workflow 与 packet 已统一收为 `superseded`。
- `.ai-shared/handoff/codex-to-claude__v42-pm-delivery-review-r2__20260818-2002.md`：本轮四节复审、修复证据与剩余发布阻塞。
- `.ai-shared/handoff/codex-to-claude__v42-r301-runner-r2__20260818-2147.md`：server-observed runner 独立反例审查、加固与验证。

## 16. 当前状态

`IMPLEMENTATION PARTIAL / GIT SNAPSHOT DELIVERED / LIVE UNVERIFIED`。产品快照已推送 GitHub，但 `formalRelease=false`；本文件不自动改变正式实例或外部系统，任何尚未完成真实 readback 的能力都不得描述为已发布或已激活。
