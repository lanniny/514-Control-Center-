# 当前任务上下文（活跃状态）

> 协作体系的"短期记忆"。每个 Agent 接入时**先读这里**。
> 由 Claude 主驾维护。最后更新：2026-08-08（环境舱对齐、工具标签栏、终端修复、团队配置便利层）。
> 本文件只存稳定事实和当前风险；逐轮实现史、测试计数与运行时快照分别进入 `decisions.md`、handoff 和当轮验证输出。

## 主人信息

- **协作偏好**：内置 `team-514cc` 默认由 Claude 做规划和总协作、Codex 做技术执行与独立评审；Control Center 自定义团队不固定主脑
- **响应语言**：简体中文
- **操作系统**：Windows 11 + PowerShell 7

## 当前项目

- **项目名**：514cc
- **工作目录**：`I:\514claude\514cc`
- **项目类型**：Skill 驱动的 AI 能力放大系统
- **技术栈**：Markdown SKILL.md + TOML customize + YAML module.yaml + Node.js Console + Python 配置校验
- **正式版本真源**：`rules.md` §八 + `CHANGELOG.md` 最新条目；其他入口必须由 `npm run validate` 做一致性检查

## 体系架构

```
Layer 1: 团队主脑与总协作（内置默认 Claude Fable；自定义由 coordinator 决定）
Layer 2: Skill 体系（14 Claude skill + 7 Codex skill）+ harness hooks
Layer 3: 异构执行与独立验证（Codex + Grok + Kimi + Pi）
Layer 4: 最小治理（rules.md + module schema + guardrails）
```

### 命名 Agent

| 名 | 职 | 驱动边界 |
|---|---|---|
| 烛 | 代码守夜人 / 技术执行官 | Codex |
| 织 | 情报编织者 | Grok + Web MCP |
| 匠 | 嵌入式领域诊断 | Claude |
| 策 | 规格与架构拆解 | Claude |
| 鉴 | 体系审计（只读） | Claude |

Console 另有 Grok Build、Kimi 前端和 Pi resident 等执行 profile；它们是运行面能力，不改写 5 个命名 Agent 的治理角色。Gemini profile 保留但当前禁用。

## 稳定能力

- route-gate / stop-gate / mirror-gate 三个 harness hook 的仓库源位于 `.claude/hooks/`。
- Claude↔Codex 对话桥支持 `codex` / `codex-reply` 多轮线程，降级通道为 `codex exec resume`。
- `apps/control-center` 提供本地配置、路由、观测、会话、自动化和协作控制面。
- `module.yaml` 登记所有仓库 skill 与 Console adapter；`schemas/module.schema.json` 和仓库集合差检查负责阻止注册表漂移。
- 仓库已是 Git 工作树；并行 agent 可能同时修改文件，禁止用 reset/checkout 覆盖未知改动。

### 2026-07-24 活跃波次

- Codeg/LiveAgent 深度融合：**Wave H→K** 已落地（前端跃迁、Lease/taskGraph/SSE epoch、模块化、remote-gates 门闩、resume 命令可见、Evidence 可导航）。方案：`proposals/v39-wave-h-frontend-multicli.md`、`v39-wave-ijg-kernel-modules-gates.md`、`v39-wave-k-ui-evidence.md`。不得宣称上游 1:1 或远程能力已上线。

### 2026-07-25 活跃波次

- **v4.0 Forge 深度收口**（Kimi 主驾）：Forge 设计系统（`public/forge/`）、团队旗舰视图 `#/team`、统一搜索/记忆/脚手架后端、DELTA 契约修复、CSP 零违规、零 emoji + Lucide 85 图标统一。测试 446/0 fail，validate 12/12。KaTeX/Mermaid 实时渲染与进程监管 UI 为已知增强债。
- **Wave G 五面门闩开放**（Kimi 主驾，LO 2026-07-25 授权全做）：PTY 终端/Office 文档/渠道（Telegram+Webhook）/SSH·SFTP/市场五面后端 + 前端五视图全落地，remote-gates 授权账本 7 门（gateway/remote_web 仍封锁）；IA 重组 5 组 16 项；codeg UI 移植（磨砂族/折叠/kbd/highlight.js vendored 23 语言/可拖分栏）；G4 协作星图 `#/hero`（物理布局 + 实验排版 + roster/runs 真实数据驱动，reduced-motion 降级）。测试 480/0 fail，validate 12/12，截图 21 站明暗 0 控制台错误。增强债：Lark/微信、Office 预览、SSH 隧道、自托管字体、KaTeX/Mermaid vendored。

### 2026-07-27 活跃波次

- **CC-Switch 3.18.0 完整迁移**：以 `.scratch/cc-switch/cc-switch-3.18.0/` 为上游审计源，固定注册表 SHA-256 `50f6b4ec0c072d70d1cc2d7c3d811f68f15e9fa9b8e7c734fbc8f8c5a7d82c6c`；288 个入口由机械账本覆盖，其中 157 equivalent、128 adapted、3 blocked_external_trust。迁移面包括八应用 ProviderStore、代理/故障转移/用量、Prompt/MCP/Skill/Profile/备份、WebDAV/S3、OAuth、OpenClaw/Hermes workspace、深链和桌面原生桥。
- 桌面壳已补 Tauri remote-origin ACL：只有 `main` 窗口的 `http://127.0.0.1:51400/*` 可调用 11 个显式 native commands，`local=false`；命令清单同时驱动 build-time AppManifest，并由 Rust 回归检查 capability 与 `invoke_handler` 漂移。最终 release 产物位于 `apps/desktop/src-tauri/target/release/cc-desktop.exe`。
- **配置图谱融合**：原独立能力图谱与配置界面合并为唯一 `配置图谱`，内部以 `供应商与应用 / Agent·Skill·MCP / 真源与运行时` 三个互斥工作面承载；旧 `#capabilities` 仅作兼容别名。Skill/MCP 到真源使用后端精确 `sourceId`；MCP/Skill 降级相互隔离；Provider/CC-Switch 刷新、深链 FIFO、真源 latest-wins 与脏草稿保护均有机械回归。证据见 `codex-to-claude__config-topology-fusion__20260727-1640.md`。
- **团队工作区融合**：团队启用、团队设置、成员/主脑/Skill/MCP/供应商绑定与运行席位、协作流、热力图统一进入唯一 `#/team`；浏览和显式选用解耦，写后 fresh、脏草稿与目录降级均有机械竞态回归。证据见 `codex-to-claude__team-workspace-fusion__20260727-2110.md`。

### 2026-07-28 活跃波次

- **成员库与三域身份**：逻辑成员来自 `TeamMemberStore`；内置成员由 runtime catalog 投影，自定义成员持久化到 `team-members.json`。团队与会话使用 `memberId`，路由和 adapter 查找使用 `runtimeProfileId`，协议实现由 `adapter.id` 标识；绑定链固定为 `memberId -> runtimeProfileId -> adapter.id`。
- **自定义团队与主脑**：新建团队草稿可从空成员、空主脑开始，但保存时必须至少包含一名可执行逻辑成员，且主脑必须是其中任一 `coordinatorEligible` 成员。Claude 可完全移除；成员 CRUD、团队 CRUD、成员加入/移出团队和任意合格主脑均已接线。缺命令、disabled、fallback、未接线 profile 或不可验证的团队引用状态均 fail-closed。
- **成员级运行配置与深链**：成员独立保存名称、职责、简介、提示词、能力、`defaultModel/defaultEffort` 与 runtime binding；run 固化 `teamRosterVersion: 1` 和成员快照。同一 runtime profile 可承载多个逻辑成员及各自独立 session；`#/team` 成员库可深链到唯一配置图谱的 `control.models` 或按 `memberId` 聚焦 Skill 矩阵列。证据见 `codex-to-claude__team-member-library__20260728-0657.md`。

### 2026-08-02 ~ 08-03 活跃波次

- **v4.0 团队协作逻辑完善**：health 独立轨道（快源 3.5s 首屏 + health 12s 补载）、派工建议感知席位状态（跳过 offline、busy/degraded chip）、建议卡一键采用、健康补载保输入。测试 650/0 fail。
- **团队配置便利层**：预设模板（研发攻坚/评审/研究写作/全栈混编四套）、团队包导出/导入（自定义成员随包 + 孪生复用 + 重名避让）、目录竞态守卫（轮询 12s 等待）。测试 656/0 fail。
- **成员配置页面完善**：使用情况区块（引用团队 chip + 删除前置说明）、品牌头像 + 徽章（主脑可任/团队 n）、简介/提示词字数实时计数。测试 656/0 fail。
- **v4.0 团队协作逻辑完善波**：成员分组/成员库/席位配置/串流 chrome 四波，测试 646/0 fail → 656/0 fail。
- **Grok Build CLI 升级修复**：`~/.grok/bin` 0.2.118 读回 + 本机契约验证。
- **CLI 环境面板**：v4.0 CLI 环境面板（env 面板、kimi stale env fallback）。

### 2026-08-04 ~ 08-05 活跃波次

- **Composer 目标 CLI 对齐**：`apps/control-center` 的 composer 视图对齐 Codex 目标 CLI 参考图（入口/标签/骨架）。
- **团队范围侧栏收口**：团队过滤下的侧栏项目树正确显示，已修复未归属项目被过滤的缺陷。
- **协作 Console 加固**：观察性/会话/路由面板的稳定性修复。

### 2026-08-07 ~ 08-08 活跃波次

- **Codex 桌面环境舱对齐**：环境舱按参考图重排（变更/本地/分支/提交或推送/PR），可展开行、内联刷新、头像堆叠、来源 ➕、分组默认展开。测试 804/0 fail。
- **侧栏团队过滤缺陷修复**：根因=effectiveProjectTeamId() 使未归属项目全被过滤，改为 `null`(未归属)无条件可见。
- **右栏工具标签栏**：新模块 `rail-tools.js` + `rail-panels.js` + `rail-tools.css`。任务工具迁入右栏标签条（审阅/浏览器/文件/终端/侧边对话），标签条 + ➕ 菜单 + 空态选择器同源驱动。终端改为底部抽屉。测试 809/0 fail。
- **终端输入双重序列化修复**：根因=request() 内部 JSON.stringify 与 16 处调用方手动 stringify 叠加，body 被双重序列化。修复=request() 对字符串 body 原样透传。同轮修掉 8 个真实缺陷（视图无条件自举、SSE 断线不重连、xterm 隐藏容器 open、孤儿面板、mount 不幂等、输入失败静默、默认 shell 走 pwsh、401 竞态）。测试 819/818 pass/0 fail。
- **决策记录回溯**：2026-08-08 context.md 更新 + decisions.md 批量补录（见 `decisions.md` 08-08 条目）。

### 2026-08-12 ~ 08-13 活跃波次

- **远程配置工作台同构**（烛）：远程主机与远程项目补齐本机三面（供应商与应用 / Agent·Skill·MCP / 运行席位与真源）+ 真实主机健康仪表盘；写入链的 CAS、staged digest 校验、planRevision 绑定与凭据脱敏在两轮独立复核中被推翻并加固。证据见 `codex-to-claude__remote-config-workbench-parity__20260812-0446.md`。
- **远端真源安全网**（主驾续波）：补齐远端相对本机缺失的两道安全网——保存前差异预览 + 发布备份时间线（对比/恢复）。恢复复用 `writeSource` 事务（CAS/锁/原子发布/恢复台账全继承，且为恢复前内容再留备份 ⟹ 恢复可回滚），备份原文只在服务端流转、不经浏览器。同轮修掉一处**数据损坏缺口**：`findSecretCandidates` 有 12 字符门槛而 `scrub` 没有，导致含短值示例的文档既被脱敏又被判可编辑，保存即把 `[REDACTED]` 写回远端——现按契约收紧为「返回内容 ≠ 远端原文 ⟹ 一律只读」。另修 7 处空白图标并新增 sprite 引用契约测试。证据见 `claude-to-all__remote-source-safety-net__20260813-0113.md`、`decisions.md` D-2026-08-13-001。

- **配置系统 bug 搜寻 + 矩阵可用性改造**（主驾续波）：三路并进（静态审查 / 真实 HTTP 边界探针 / UI 走查截图）。结论诚实分层——`/api/config` 边界层健康（路径穿越 404 不回内容、critical 源 403 fail-closed、无 5xx），**该层无可报缺陷**；真问题在 UI：①门闸未授权（501）被当成故障渲染成常驻红字技术文案（390px 占三行），改为 `gated`/`error` 分类 + 「去授权」直达门闩；②`team-workspace-ui` 三条断言盯字面文本而守卫已收口，先核实三道闸都在、确认是断言腐烂才升级为语义断言；③Skill 矩阵 126 格无筛选无批量无定位，补筛选/覆盖率/整行整列全量批量（复用原子接口、只提交真实变更、fail-closed 成员豁免、影响面二次确认、部分失败逐条回报）+ 斑马纹/行 hover/勾选饱和度/表头 sticky。走查工具正式化为 `npm run qa:walkthrough`。证据见 `claude-to-all__config-system-bugs-and-matrix-ux__20260813-0150.md`、`decisions.md` D-2026-08-13-002。

## 当前风险

- 正式 framework release 仍以真源记录为准；工作记录里的 v3.6/v3.7/v4.0 仅是**未发布功能波次**，不得作为已发布版本传播。`rules.md` 仍为 v3.5.0，但 v4.0 功能（Forge 设计系统、CC-Switch 迁移、团队工作区融合、配置图谱、工具标签栏、终端修复等）已深度落地到 Console。版本升格/正式发布待 LO 决策。
- 仓库源、用户运行时和正在运行的进程是三个状态面；未做当轮 readback/端到端调用时，不得声称已部署或已激活。
- Console 与治理面持续演进，固定测试总数会迅速腐烂；只记录验证命令和当轮输出，不在本文件固化“全绿 N/N”。
- Python 校验依赖由 `requirements-validation.txt` 声明；缺少 PyYAML/jsonschema 时必须显式失败，禁止静默退化成仅语法检查。
- CC-Switch 的 3 个 updater 命令必须保持 `blocked_external_trust`，直到 514cc 拥有自己的签名公钥与更新端点；禁止借用上游信任材料或伪称 updater 已上线。
- `exceljs@4.4.0` 的既有传递依赖链仍被 npm audit 报告为 11 high + 1 moderate，当前无直接可用修复；禁止无评估执行 `npm audit fix --force`。

## 验证入口

```powershell
python -m pip install -r requirements-validation.txt
cd apps/control-center
npm run validate
npm test
```

历史决策与纠错映射见 `.ai-shared/decisions.md`；跨 agent 证据见 `.ai-shared/handoff/`。
