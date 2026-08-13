# v3.9 Wave H：Codeg/LiveAgent 再审计后的前端跃迁 + 多 CLI 特色强化

> 状态：**Wave H UI 已落地**（2026-07-24）。  
> 触发：LO 要求参照 [xintaofei/codeg](https://github.com/xintaofei/codeg)、[Stack-Cairn/LiveAgent](https://github.com/Stack-Cairn/LiveAgent) **下载源码深度完善**——①全功能对标并加强 ②多 CLI 团队作特色 ③必须有创新 ④前后端可融合，前端观感优先。  
> 上游固定副本：`.scratch/codeg`（`692d6eb` / 0.21.6）、`.scratch/LiveAgent`（`0a7bb97`）。  
> 既有收敛：`proposals/v38-completion-assessment.md`（LO 已接受产品边界收敛）。

## 〇、一句话战略

**不 fork Codeg，不换 LiveAgent Gateway 作内核。**  
在 Node 控制面 + 异构 adapter 上，把「真实多 CLI 团队」做成首屏可见的产品身份，并借两上游的交互骨架（WelcomeTip / Quick Actions / 右 dock 注册表 / 命令面板）把前端从「可用」推到「好看且有团队感」。

## 一、源码再审计结论（诚实）

### 1.1 上游固定修订

| 项目 | 本地 HEAD | 许可 | 核心栈 |
|---|---|---|---|
| Codeg | `692d6ebe…` · manifest 0.21.6 | Apache-2.0 | Tauri2 + Next16 + Rust ACP + SeaORM |
| LiveAgent | `0a7bb97c…` | MIT | Tauri2 + React19 + Rust + Go Gateway |

### 1.2 值得借的机制（已借 / 本波借）

| 机制 | 上游证据 | 514 处置 |
|---|---|---|
| WelcomeHero + 随机 tip | `codeg/.../welcome-hero.tsx` | 本波：`welcomeTipMarkup` + `WELCOME_TIPS` |
| 分类 Quick Actions | `codeg/.../quick-actions.tsx` | 已有；本波补「起始成员」徽标 |
| 富 composer @ / / | codeg tipTap suggestion | 已有 mention/slash 菜单 |
| 命令面板 | codeg `cmdk` / ui/command | 已有 Ctrl+K |
| 右 dock 注册表 | LiveAgent `rightDockRegistry.tsx` | 已有 `MISSION_PANEL_REGISTRY` |
| 会话聚合 12 源 | Codeg parsers | 本机有数据的源已接；无数据不做假接口 |
| Automations | Codeg automations-page | 已有 CRUD + 管理对话框 |
| 社会编排 / 子代理 | Codeg MCP companion · LiveAgent subagents | 514 **更强**：异构 CLI 原生会话 + bus |

### 1.3 明确不借 / 需 LO 再拍板

- 整仓 fork Codeg（Next/Rust 双栈会分裂治理）
- LiveAgent Gateway 作内核（第三运行时）
- Chat Channels / Office / SSH·SFTP / 完整 PTY IDE / Skills 市场安装 / 远程 `iex|bash` 装 Agent
- 巨型 2k–10k 行 UI 组件照搬（会复制 monolith 病）

### 1.4 能力账本诚实边界

`capability-ledger.md`（2026-07-23 快照）仍有大量 `blocked` 行。  
v38 已将「产品边界内主路径」收敛；本波 **不** 宣称 1:1 全功能复制。  
「全部功能」= 能力类别对标 + 明确 blocker，不是像素复刻。

## 二、多 CLI 协作团队：可行性与完整性

### 2.1 为什么这是 514 的特色（不是 Codeg 复刻）

```
Codeg:     同工作区多 agent 会话 + MCP companion 委派
LiveAgent: 本地工具执行 + 子代理 + 可选远程 Gateway
514 Forge: 多套真实 CLI 进程（Claude/Codex/Grok/Kimi/Pi）
           × 治理身份稳定（Agent ≠ Provider）
           × bus 可寻址 + 审批租约 + worktree
           × route-gate / stop-gate / DELTA 机械扳机
           × Mission Evidence Graph
```

### 2.2 完整性六轴（可演示）

| 轴 | 状态 | 用户入口 |
|---|---|---|
| 身份 | ✅ | 团队树 / 星图 / 能力矩阵 |
| 原生会话 | ✅ | 会话聚合 · 项目树 CLI 分组 |
| 路由 | ✅ | `[[msg:]]` / @ / followup / 起始成员 |
| 可见 | ✅ 强化 | 星图舞台 · tip · 脉搏 · 消息 CLI 徽标 · 会话头芯片 |
| 治理 | ✅ | Plan/Review/Build · 审批租约 · 取消级联 |
| 证据 | 🟡 | run 级 Evidence Graph ✅；跨 run 仍增强债 |

### 2.3 创新（相对两上游）

1. **Evidence Graph** — 结论挂 Task/Attempt/Artifact，不是聊天摘要  
2. **Capability Lease** — 审批签发可见租约（TTL/哈希/作用域）  
3. **Heterogeneous Replay** — 原生 session id 不互相覆盖（目标：provider 专属恢复）  
4. **Counterfactual Dispatch** — 独立验证分支（目标态）  
5. **Harness 硬扳机** — route/stop/mirror-gate（体系层已有）

## 三、Wave H 本波落地

| 项 | 路径 | 用户可见 |
|---|---|---|
| Welcome tip（codeg 式） | `public/app.js` `WELCOME_TIPS` / `welcomeTipMarkup` | 空态随机一条键盘/治理提示 |
| 星图舞台 + 图例 | `teamConstellationMarkup` + CSS `constellation-stage` | 异构团队一眼识别 + CLI 标签 |
| 模板起始成员徽标 | `template-start` | 快速开始卡显示谁会起手 |
| 消息 CLI 徽标 + 角色副标 | `messageMarkup` | 群聊谁在说话、哪套 CLI |
| 会话头芯片 L/起/言 | `renderConversationAgents` | 在场/起始/已发言 |
| 脉搏身份色 + 短码 | `renderTeamPulse` | 页头/底栏团队脉搏 |
| 视觉令牌 | `styles.css` Wave H 块 + `atelier.css` | 亮暗主题共用 |
| 契约测试 | `tests/mission-control-ui-contract.test.mjs` | 6/6 通过 |

### 验证（已跑）

```powershell
cd I:\514claude\514cc\apps\control-center
node --check public/app.js
node --test tests/mission-control-ui-contract.test.mjs
# → 6 pass
```

## 四、后续分期（不在本波）

### Wave I — 协作内核（无安全拍板可做）

- 跨 run 持久 TaskAttempt / Delegation CAS  
- Capability Lease 在 adapter 边界硬拒绝（声明→执行）  
- Heterogeneous Replay 最小路径（Codex resume / Claude -r）

### Wave J — 前端模块化

- 拆 `app.js` monolith（welcome / composer / rail / mission 分包）  
- 不引入整套 React/shadcn 重写（避免复制上游体积病）

### Wave G — 需 LO 单独授权

- Channels / 远程 Gateway / Office / SSH·SFTP / 完整 PTY / Skills 市场

## 五、许可

- 本波 **零上游源码拷贝**；仅交互模式与信息架构借鉴。  
- 未来若 MIT（LiveAgent）组件直接复用：`THIRD_PARTY_NOTICES.md` + SPDX。  
- Apache-2.0（Codeg）行为可重实现；复制代码需 NOTICE 与修改记录。

## 六、不可宣称

- 「两个开源仓库每一个功能都已 1:1 实现」  
- 「Capability Lease / 跨 run DAG / 反事实验证 已强制执行完成」  
- 「远程协作 / 渠道 / Office / 完整终端 IDE 已上线」
