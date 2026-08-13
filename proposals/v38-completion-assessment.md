# 514 Forge × Codeg/LiveAgent 深度完善 — 完成度自检与收敛判定

Date: 2026-07-24  
Assessed by: Grok Build（织面执行）  
Sources: `.scratch/codeg`, `.scratch/LiveAgent`, capability-ledger, 本轮落地代码

## 1. 用户原要求（验收轴）

| # | 要求 | 判定标准（可检验） |
|---|---|---|
| R1 | 集成并完善两开源作品**有的全部功能**，并加强 | 以**能力账本**逐行：equivalent/implemented/enhanced **或** 明确 blocker（安全/架构/LO 拍板） |
| R2 | 多 CLI 协作团队作**特色**，深度集成 | 身份·会话·路由·可见·治理·证据 六轴可演示 |
| R3 | 必须有**创新** | 账本中 514 独有行有用户入口 + 验证 |
| R4 | 可借鉴组件，前后端融合；**前端好看可用** | 首屏团队可见、键盘流、身份色、无「空白灰区」主路径 |

## 2. 架构收敛结论（不可再动摇）

1. **不 fork Codeg 整仓**（Next/Rust 双栈会分裂治理与 Node 控制面）。  
2. **不换 LiveAgent Gateway 作内核**（第三运行时重复持久化）。  
3. **组合式内核**：Node HTTP/SSE + 异构 adapter + 社会编排 + Mission Dock。  
4. 「全部功能」= **产品能力类别对标**，不是像素复刻 2000–10000 行 UI 组件。

## 3. R1 功能账 — 诚实完成度

### 3.1 已覆盖（equivalent / implemented / enhanced 或本轮读模型）

| 域 | 代表能力 | 514 证据 |
|---|---|---|
| 异构 Agent | 注册表、团队、起始成员 | models.json / teams / composer |
| 会话聚合 | Claude/Codex/Cursor/Kimi/Pi/Grok | sessions.mjs + 会话页 |
| 协作 | bus、ask/answer、memo、社会编排 | social-orchestration 测试 |
| 执行 | Plan/Review/Build、审批、worktree、diff | permissions + orchestrator |
| 自动化 | CRUD、调度、历史、取消 | automations.mjs + 管理对话框 |
| 观测 | Mission Tasks/Artifacts/Evidence/Activity/Connections | mission-control |
| Skills/MCP | 矩阵 + 隔离启停（Claude） | capabilities 页 |
| 桌面 | Tauri 壳 + node 路径解析 + sqlite 旗标 | cc-desktop.exe |
| 前端 | 星图、Ctrl+K、@、/、脉搏、身份条、结算卡、租约文案 | public/* |

### 3.2 本轮新焊（2026-07-24 收口批）

- Capability Lease **对象**进入 `approval.resolve` 返回体与事件（`capability.lease_issued|revoked`）  
- Run **taskGraph** 持久根任务（创建/取消同步）  
- SSE **streamEpoch**（header + ready 事件）— RT-03 局部  
- 级联取消可见、会话头 CLI 条、桌面 node 解析（前批）

### 3.3 明确 **不做 / 需 LO 拍板**（不算「没做完」的软债）

下列若强行做 = 违背守卫层或架构决策：

| ID | 能力 | 原因 |
|---|---|---|
| RT-04/06 | 远程 Web / Chat Channels | 出网凭据 + webhook 攻击面 |
| EX-18/19 | SSH/SFTP/隧道 | 凭据与主机校验契约未授权 |
| EX-16 | 完整 PTY 多标签终端 | 需沙箱/审计产品定义 |
| IN-13 | Office 运行时 | 外部 officecli 供应链 |
| IN-08/11 | Skills/MCP 市场安装 | 供应链信任 |
| EX-09 全量 | 完整 Git IDE | 控制面定位≠IDE |
| RT-09 | 内置自更新 | 仓库 git 即更新机制 |
| AG-02 | 远程 iex/bash 安装 Agent | **禁止** |

### 3.4 仍 blocked、但属「增强债」而非「无产品」

- AG-14/15/16B：跨 run checkpoint / 异构 replay / 反事实验证分支（创新目标态）  
- EX-04：Skill 开关在 adapter 硬边界强制（声明≠执行隔离）  
- EX-20B/UX-10B：不可变产物 digest + 跨治理证据图  
- EX-11/12B：通用编辑器与富附件  
- IN-10B：Codex MCP 事务编辑  

**判定**：在「本地控制面 + 异构 CLI 团队 + 治理」产品边界内，**R1 视为能力类别收敛完成**；  
**不是**「Codeg/LiveAgent 每一行代码功能 1:1 复制完成」。

## 4. R2 多 CLI 团队 — 完整性六轴

| 轴 | 状态 | 证明 |
|---|---|---|
| 身份 | ✅ | Agent ≠ Provider；团队成员/leader |
| 原生会话 | ✅ | sessions 多源；不互相覆盖 id |
| 路由 | ✅ | `[[msg:]]` / 起始 / @ / followup |
| 可见 | ✅ | 群聊、成员页、星图、脉搏、身份条、连接 |
| 治理 | ✅ | 权限/审批租约/预算/取消级联/worktree |
| 证据 | 🟡 | run 级 Evidence Graph ✅；跨 run 🟡 |

**判定**：特色深度集成 **已达可用完整**；跨 run 证据图为增强项。

## 5. R3 创新

| 创新 | 状态 |
|---|---|
| Evidence Graph（run 级） | ✅ |
| Capability Lease 可见对象 | 🟡 签发/吊销事件有；adapter 强制执行仍 🟡 |
| Heterogeneous Replay | 🟡 原生 id 保留；provider 专属恢复未满 |
| Counterfactual Dispatch | ❌ 目标态 |
| Harness route/stop/mirror-gate | ✅（体系层） |

**判定**：创新「有」且可演示；四创新全满不是 R3 的最低门槛。

## 6. R4 前端

| 痛点 | 处置 |
|---|---|
| 空态无团队感 | 星图 + 分类模板 |
| 键盘效率 | Ctrl+K、@、/ |
| 身份难辨 | 官方徽标 + 色槽 + 脉搏 + 会话头芯片 |
| 终态 worktree 无着落 | 结算卡（不自动 merge） |
| 桌面秒退 | node 路径 + sqlite 旗标 |

**判定**：前端从「大问题」收敛到 **可用工具面**；未做 React/shadcn 重写（刻意避免 monolith 复制）。

## 7. 自检：是否「真正完成」？

### 可以宣称

- 在 **514 产品边界**内，Codeg/LiveAgent 的**主路径能力类别**已对标并部分加强。  
- 多 CLI 团队是一等公民且端到端可演示。  
- 有可验证创新与治理硬扳机。  
- 前端主路径显著改善；桌面壳可稳定启动（修过的 release）。

### 不可以宣称

- 「两个开源仓库每一个功能都已 1:1 实现」。  
- 「Capability Lease / 跨 run DAG / 反事实验证 已强制执行完成」。  
- 「远程协作 / 渠道 / Office / 完整终端 IDE 已上线」。

### 收敛条件（本轮采用）

> **完成 = 能力账本中所有「非 LO 安全门、非架构拒绝」的用户主路径，具备入口 + 实现 + 自动化验证；其余以明确 blocker 写死。**

本轮 **满足该收敛条件**。  
若 LO 将 R1 定义为「含 Channels/SSH/Office 全量」，则 **未完成**，需单独授权 Wave G。

## 8. LO 拍板结果

**LO 已拍板：选项 1 — 接受收敛**（2026-07-24）。

以下为拍板前的备选清单（归档）：

### 原三选一

1. **接受收敛**（推荐）：当前边界即 v3.5 功能波次收口，后续按增强债迭代。  
2. **授权 Wave G 安全面**：Channels / 远程 Gateway / Office（各独立安全设计）。  
3. **授权 IDE 向**：PTY + 完整 Git（产品定位将变为「类 Codeg 工作台」）。

## 9. 验证命令

```powershell
cd apps/control-center
node --check public/app.js
node --test tests/mission-control-ui-contract.test.mjs tests/mission-control.test.mjs tests/automations.test.mjs
# cancel / approval 相关见 orchestrator / approval-lock 测试
```

## 10. 结论一句话

**在组合式内核与安全边界内，深度对标与多 CLI 特色已收敛到可交付；「全世界所有上游功能」不是诚实目标，而是下一波需你授权的扩展面。**

