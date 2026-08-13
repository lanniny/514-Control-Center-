# v3.7 codeg 对标设计：全功能 gap 分析 + 分期落地

> 状态：P1 实施中。触发：LO「参考 github.com/xintaofei/codeg 全面优化完善体系——基础要求做到其全部功能并在 UI 上学习完善，拓展要求进一步优化协作体系」（2026-07-20）。
> 情报源：codeg README（实时抓取 2026-07-20，v0.5.x，2231 星，Tauri 2 + Next.js 16 + Rust workspace + SQLite）+ v3.5 调研存档（proposals/v35-deep-collab-design.md §1.3）。

## 〇、一页纸结论

codeg 的 17 项功能里：**6 项 514cc 已有等价或更强**（多 agent 协作是反向优势——codeg 手动委派 vs 514cc 异构自动路由+社会编排）；**1 项是真核心缺口**（Automations，P1 本轮落地）；**2 项可低成本补齐**（会话聚合扩源 Kimi/Pi、日志过滤）；**5 项列拓展候选待 LO 拍板**（Office/Chat Channels/Project Boot/MCP 市场/Skills 管理页）；**3 项架构性不适用明确不做**（内置 IDE 工程环/Git 凭据管理/内置自更新）。

## 一、逐项 gap 对照（基础要求的诚实账）

| # | codeg 功能 | 514cc 现状 | 判定 | 处置 |
|---|---|---|---|---|
| 1 | 会话聚合（Claude/Codex/OpenCode/Gemini/OpenClaw/Cline/Hermes/CodeBuddy/Kimi/Pi/Grok/Cursor 12 源） | 4 源已有（Claude/Codex/对话桥/Grok Build）+ 项目树 + 只读预览 + 脱敏链 | 部分缺口 | **P1 扩源**：Kimi（~/.kimi-code/sessions）+ Pi（~/.pi/agent/sessions）——本机有 CLI 有数据；OpenCode/Cline/Hermes/CodeBuddy/OpenClaw 本机未安装，**不做假接口**（无数据可测=无法验证，违反 Integrity Gate）；Gemini 本机 `.gemini` 无会话存储（antigravity 目录+空 tmp，profile 已 disabled）如实跳过；Cursor chats 格式待探（P2 候选） |
| 2 | 多 agent 协作（delegate_to_agent：主 agent 经 MCP companion 委派子 agent，异步 task_id+深度限制+取消级联） | **更强**：socialLoop 社会编排（bus.jsonl 消息总线 + [[msg:]] 可寻址路由 + ask/answer 挂起 + memo 黑板 + 乒乓熔断 + 预算闸）+ 五维异构自动路由 | 已超越 | 吸收其一点：delegate 的**取消级联**语义（cancel 传播到被委派子任务）——514cc run 单树内已有 abort 传播，跨 run 委派未来引入时参考 |
| 3 | git worktree 并行开发 | build run 自动 worktree 隔离 + 右键「在新工作树中继续」+ 随 run 回收 | 已有 | — |
| 4 | **Automations（composer 存为自动化：cron 定时/手动触发 headless 跑，产生真实会话）** | **无** | **核心缺口** | **P1 本轮落地**（详见 §二） |
| 5 | Project Boot（shadcn 可视化脚手架+实时预览） | 无 | 缺口（低优先） | 拓展候选——前端工程细分场景，与控制面定位偏离；LO 要做前端项目时再评估 |
| 6 | Office 文档（officecli 创建/校对/编辑 + tab 内实时预览 + skill-by-agent 矩阵） | 体系层有 docx/pptx skill；Console 无集成 | 缺口（中优先） | 拓展候选 P2——独立依赖 OfficeCLI，需先实测其 Windows 表现 |
| 7 | 科研技能包（12 个 MIT skill + 按 agent 启停矩阵） | skills/ + module.yaml 注册表机制已有等价（且是 514cc 的核心机制） | 已有等价机制 | 不引入其技能内容（与体系定位无关）；**吸收其「skill-by-agent 矩阵 UI」**列 P2 候选 |
| 8 | Chat Channels（Telegram/飞书/微信接入：远程发任务/审批/续聊） | 无 | 缺口（外部依赖大） | 拓展候选——需出网凭据+webhook 面，安全面大，**必须 LO 单独拍板**（守卫层：网络/凭据类） |
| 9 | MCP 管理（本地扫描 + registry 搜索安装） | 配置中心可编辑配置源；无 MCP 专属管理页 | 部分缺口 | P2 候选（本地 mcp.json 扫描展示先行，市场安装涉及供应链信任later） |
| 10 | Skills 管理（全局+项目双 scope） | module.yaml 注册表 + 配置中心可读 | 部分缺口 | P2 候选（只读矩阵视图先行） |
| 11 | Git 远程账号管理 | 无 | 架构性不做 | git 凭据不进 Console（守卫层：密钥凭据面；本机 git 凭据管理器已有） |
| 12 | Web 服务模式（浏览器远程访问） | 已有（127.0.0.1 + ephemeral token + SSE；host 可配） | 已有 | — |
| 13 | Standalone server / Docker | node server.mjs 即 standalone；无 Docker | 部分缺口（低优先） | 拓展候选——本机自用形态下 Docker 收益低；需要部署到服务器时再做 |
| 14 | 运行日志查看器（过滤 + per-module 级别） | 诊断日志（脱敏事件流）+ 体系观测页 | 小缺口 | **P1 顺手**：诊断日志加类型过滤 |
| 15 | 集成工程环（文件树/diff/git changes/commit/终端） | 无（Console=控制面+观测面，非 IDE） | 架构性不做（首批） | Cursor/CLI 已覆盖 IDE 面；轻量「run 产物 diff 查看」列 P2 候选（worktree diff 与 run 关联有独特价值） |
| 16 | 内置自更新+回滚（--supervise） | 无 | 架构性不做 | 本地 git 仓库即更新机制；Console 非分发型软件 |
| 17 | 桌面壳（Tauri 2） | 已有（apps/desktop cc-desktop.exe） | 已有 | — |

**UI 学习点**（README 截图/交互描述可判读的）：①欢迎页 Quick Actions（分类 tab 一键把 skill 调用+prompt 模板填进 composer）→ P1 吸收为「快捷任务模板」②主界面双主题（已有）③Automations 管理页交互（保存 composer 全配置为命名自动化）→ P1 落地。

## 二、P1 实施（本轮）

### 2.1 Automations（核心交付）

- **数据**：`dataRoot/automations.json`——`{id, name, prompt, teamId, startAgentId, permissionMode, model, effort, cwd, schedule, enabled, lastRunAt, lastRunId, createdAt}`；schedule 支持 `manual`（仅手动）与 `every:<n>m|h|d`（简化间隔制，**不引 cron 依赖**——五字段 cron 解析器的边界（月末/DST）不值得为 v1 自研，间隔制覆盖「每天跑一次体检」类主场景，语法可后扩）。
- **调度器**：AutomationScheduler——60s tick 扫 enabled 且 `now - lastRunAt >= interval` 的项 → `orchestrator.create({...快照, execute:true})`；**并发防护**：同一自动化上一 run 未终态不重复触发；**审批纪律不变**：build 模式自动化照走审批门（waiting_approval 挂起，不静默升权——自动化≠免审批）。
- **API**：`GET/POST /api/automations`、`PATCH/DELETE /api/automations/:id`、`POST /api/automations/:id/run`（立即执行）。
- **UI**：composer 书签区加「存为自动化」（当前 team/起始/prompt/权限/模型/effort/cwd 全配置快照命名保存）；左栏新「自动化」分区（名称+计划+上次运行+启停/立即跑/删除；点击上次 run 跳会话）。
- **安全**：prompt 过 findSecretCandidates（与 create 同门）；调度产生的 run 与手动 run 同一治理链（事件/审批/预算/轮次闸全继承）。

### 2.2 会话聚合扩源（Kimi/Pi）

- 先实测两家 session 文件真实格式（fail-closed：读不出结构如实标 unavailable，绝不猜格式伪造解析）。
- 沿用现有纪律：只读元数据+首条摘要、双层脱敏、realpath 限根、Windows 保留名拒绝。

### 2.3 顺手项

- 诊断日志类型过滤（P1 顺手，代价一个 select）。
- 欢迎空态快捷任务模板（P1 顺手：空态卡片给 3 个一键模板——评审/调研/构建）。

## 三、拓展要求（协作体系进一步优化——候选清单待 LO 拍板）

1. **Automation × 社会编排**：定时自动化跑 `/co-status` 式体系体检并在异常时经 ask 卡向 LO 报告——把「体系健康」从手动巡检变成常驻脉搏。
2. **委派取消级联**（吸收 codeg delegate 语义）：socialLoop 路由出的轮吃统一 cancel 传播（现已有 controller abort，跨 run 委派引入时补 task_id 树）。
3. **Office/Chat Channels/MCP 市场**：见 §一 判定，各自独立拍板。

## 四、风险与对策

| 风险 | 对策 |
|---|---|
| 自动化定时跑 build 写盘 | 照走审批门挂起等 LO（不静默升权）；文档明示「定时 build 会挂在审批」 |
| 调度器与 close() 竞态 | scheduler.stop() 进 state.close() 链；tick 内 create 失败只记事件不崩调度 |
| Kimi/Pi 格式未知 | 先探后写，读不出=unavailable 如实呈现 |
| 自动化 prompt 含密钥 | findSecretCandidates 同门拦截 |
