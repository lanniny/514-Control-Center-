# v3.8 Codeg + LiveAgent 深度融合：多 CLI 团队特色 + 前端跃迁

> 状态：Wave UI-A 已落地（2026-07-24）。  
> 触发：LO 要求参照 [xintaofei/codeg](https://github.com/xintaofei/codeg) 与 [Stack-Cairn/LiveAgent](https://github.com/Stack-Cairn/LiveAgent) **下载源码深度完善**——①全功能对标并加强 ②多 CLI 协作团队作特色深度集成 ③必须有创新 ④前后端可融合借鉴，前端观感优先。  
> 上游固定副本：`.scratch/codeg`、`.scratch/LiveAgent`；既有账本：`.workflow/ultracode/codeg-liveagent-convergence-20260723/capability-ledger.md`。

## 〇、一页纸结论

| 维度 | 判断 |
|---|---|
| 功能 parity | 账本 85 行：约一半 non-blocked。**禁止宣称“已具备两项目全部功能”** |
| 514 真正优势 | **异构 CLI 原生会话 + 社会编排 bus + 治理 harness + Evidence Graph**——Codeg 是同工作区多 agent 会话，LiveAgent 是单桌面 agent 运行时 |
| 前端短板 | 信息架构已对，但首屏未把「多 CLI 团队」做成可见特色；缺命令面板 / @ 点名 |
| 本波交付 | 欢迎团队星图 + Ctrl+K 命令面板 + @ 成员提及 + 团队会诊模板 + 视觉强化 |
| 架构红线 | **不 fork Codeg**，**不换 LiveAgent Gateway 当内核**；组合式吸收机制，保留 Node 控制面 |

## 一、源码级对照（诚实账）

### 1.1 Codeg（Apache-2.0 · Tauri2 + Next16 + Rust）

从本地 `.scratch/codeg` 与既有 audit 读出的产品面：

| 域 | 上游能力 | 514 现状 | 策略 |
|---|---|---|---|
| 会话聚合 | 12 源解析器 | Claude/Codex/Cursor/Kimi/Pi/Grok/bridge | 已有；无本机数据的源 **不做假接口** |
| 多 agent 协作 | `delegate_to_agent` 同会话子 agent | socialLoop + `[[msg:]]` + ask/answer + memo + 乒乓熔断 | **增强路径**；补 AG-12B 持久委派树 |
| Automations | cron + composer 快照 | interval 调度 + rail | 补全管理页 / 历史 / CAS（IN-03） |
| 工程环 | 文件树/diff/git/终端 | worktree + run-diff + Mission Artifact 只读 | 不全盘 IDE 化；终端/PTY 后置安全门 |
| Office / Channels | officecli + TG/飞书/微信 | 无 | **需 LO 单独拍板**（凭据+出网） |
| UI | shadcn 组件库、WelcomeHero、slash/@、Quick Actions | 自研 CSS + 部分模板 | **借鉴交互，不抄皮肤/品牌** |

### 1.2 LiveAgent（MIT · Tauri + React + Rust + Go Gateway）

| 域 | 上游能力 | 514 现状 | 策略 |
|---|---|---|---|
| Subagent roster/bus | 持久子代理 + checkpoint | run/turns/native id，无版本化 TaskAttempt | AG-13/14 目标态 |
| 右 dock 注册表 | 多 tab 工具坞 | Mission Control 五 tab 已落地 | 增强 Tasks 投影为真 DAG |
| 终端/SSH/SFTP | 完整 | 无 | 安全契约后做 |
| Gateway 远程 | Go WS+Protobuf | loopback only | RT-04 需 auth/RBAC 后 |
| Skills/MCP 市场 | 安装/打包 | 只读矩阵 + Claude 隔离 | 供应链门禁后做 |

### 1.3 不可照搬

- Codeg 巨型 2k–10k 行 UI 组件 → 会复制我们自己的 monolith 病。
- LiveAgent Gateway 作内核 → 第三运行时，分裂持久化与审批。
- 明文密钥、宽松 CORS、远程 `iex/bash` 安装器 → 守卫层拒绝。

## 二、多 CLI 协作团队：可行性与完整性

### 2.1 为什么这是 514 的特色（不是 Codeg 复刻）

```
Codeg:     多 Agent 会话聚合在同一桌面产品内，委派多为 companion/task_id
LiveAgent: 本地工具执行 + 子代理 + 可选远程 Gateway
514 Forge: 多套**真实 CLI 进程**（Claude/Codex/Grok/Kimi/Pi）
           × 治理身份稳定（Agent ≠ Provider）
           × bus 可寻址路由 + 审批/工作树/事件证据
           × route-gate / stop-gate / DELTA 机械扳机
```

完整性定义（可验收）：

1. **身份**：团队成员表 + coordinator + 能力声明矩阵  
2. **会话**：各 CLI 原生 session id 不互相覆盖  
3. **路由**：`[[msg:目标]]` / followup 选人 / @ 点名起始  
4. **可见性**：群聊流 + 成员页 + 拓扑 + Mission Connections  
5. **治理**：Plan/Build 审批、预算、熔断、脱敏、实例锁  
6. **证据**：Mission Evidence Graph + bus 尾读 + DELTA  

当前 1–5 大体可用；6 的跨 run 治理图与持久委派树仍 blocked。

### 2.2 风险与对策

| 风险 | 对策 |
|---|---|
| 各 CLI 输出协议不一致 | adapter 层归一到 turn/event；失败 fail-closed |
| 互问死循环 | 乒乓熔断 + leader 收敛 + 轮次预算 |
| 权限抹平 | Agent 身份稳定，Capability Lease 目标态按 attempt 收权 |
| UI 看起来像单聊 | 本波星图/成员色/@/命令面板强制露出团队 |

### 2.3 创新（相对两上游）

1. **Evidence Graph** — 结论必须挂谁、哪次 attempt、何种权威  
2. **Capability Lease** — 可见、可撤销、绑定 worktree/TTL（目标）  
3. **Heterogeneous Replay** — 按 provider 恢复，身份与产物血缘不变（目标）  
4. **Counterfactual Dispatch** — 独立验证分支 vs 执行分支（目标）  
5. **Harness 硬扳机** — route/stop/mirror-gate 把纪律焊进运行时（已有）

## 三、已落地波次

### Wave UI-A（2026-07-24 首波）

| 项 | 路径 | 用户入口 |
|---|---|---|
| 团队星图欢迎页 | `public/app.js` `teamConstellationMarkup` | 协作台空态 |
| 团队会诊模板 | `QUICK_TASK_TEMPLATES` collab | 快速开始第四卡 |
| 模板绑定起始 agent | `data-quick-start-agent` + `applyQuickTemplate` | 点模板即设起始 |
| 命令面板 | `#command-palette` + Ctrl/⌘+K | 顶栏「命令」 |
| @ 成员提及 | `#mention-menu` | 输入框 `@` |
| 视觉 | `styles.css` 末尾波次块 | 亮暗主题共用令牌 |

### Wave B/C/D（2026-07-24 续推）

| 项 | 账本 | 路径 | 用户入口 |
|---|---|---|---|
| Review 权限模式 | EX-01B | `orchestrator.mjs` + composer 选项 | Plan / **Review** / Build |
| Task/Delegation 投影 | AG-12B/13 读模型 | `mission-control.mjs` `tasks`/`delegations` | Mission「任务」tab：子任务 + 有向委派 |
| 连接成员健康 | UX-05 强化 | `mission-control.js` | 「连接」tab 成员行 |
| Automations 管理 | IN-02B/IN-03 | `#automation-dialog` + `runHistory` + `/cancel` | 左栏齿轮 / `/auto` / 命令面板 |
| 斜杠命令 | EX-13 | `#slash-menu` `/plan` `/review` `/build`… | 输入框 `/` |
| 欢迎分类 Quick Actions | UX-03 局部 | `welcome-cats` 协作/评审/调研/构建 | 协作台空态 |
| Capability Lease 可见面 | EX-05 读模型 | 审批卡 TTL/哈希/作用域 + 签发/吊销文案 | Build 审批流 |
| 空闲团队健康 | AG-01/UX-05 | `loadIdleRoster` + `refreshIdle` | 无选中任务时「连接」tab |
| 多 CLI 脉搏 | UX-05/09 | `renderTeamPulse` 页头+状态栏官方徽标 | 协作台标题区 / 底栏 |
| 工作树结算卡 | EX-07 读模型 | `worktreeSettlementMarkup` | 终态：diff / 新工作树续 / 复制路径 |
| 级联取消可见 | AG-12B 局部 | `cancel()` 返回 agents/sessions + UI 确认 | 取消按钮 · toast 列成员 |
| 会话头 CLI 身份条 | UX-05 | `#conversation-agents` | 谁在场 / 有会话 / 已发言 |
| 桌面壳启动稳健 | RT-01 | `resolve_node_binary` + `--experimental-sqlite` | 快捷方式启动不秒退 |

未宣称：全功能 parity、跨 run 持久 DAG、Office/Channels/PTY/Gateway、Capability Lease 适配器强制执行（当前为审批读模型）、自动 merge 主分支。

## 四、后续分期（安全门后）

### Wave E — 协作内核深化

- 跨 run 持久 TaskAttempt + 取消级联到子树  
- Capability Lease 可见/可撤销  

### Wave F — 安全后置能力

- 本地 PTY（沙箱 cwd + 审计）  
- 附件 digest（EX-12B）  

### Wave G — 需 LO 拍板

- Chat Channels / Office / 远程 Gateway / Skills 市场  

## 五、前端设计原则（对「不好看」的工程回答）

1. **工具面优先**：VS Code 信息层级 + Codex 任务感 + Claude 阅读清晰度  
2. **石墨导航 / 冷白工作面 / 玫瑰红签名** — 不抄 Codeg 默认 shadcn 蓝青皮  
3. **密度**：可扫，不堆卡片  
4. **身份色**：Claude 玫 / Codex 蓝 / Grok 青 / Kimi 紫 — 群聊一眼辨人  
5. **模块化渐进**：先交互骨架，再拆 app.js monolith（不在本波做大爆炸重构）

## 六、验证

```powershell
cd apps/control-center
node --test tests/mission-control-ui-contract.test.mjs
# 人工：协作台空态见团队星图；Ctrl+K 开面板；输入 @ 见成员菜单
```

## 七、许可

- 本波 **零上游源码拷贝**；仅交互模式与信息架构借鉴。  
- 若未来 MIT（LiveAgent）组件直接复用：`THIRD_PARTY_NOTICES.md` + SPDX。  
- Apache-2.0（Codeg）行为可重实现；复制代码需 NOTICE 与修改记录。
