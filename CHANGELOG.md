# 协作体系变更日志（CHANGELOG）

> 本文件记录 514cc 体系完整变更史，由主驾在版本变更时手动追加（早期 `/co-evolve`·`/co-learn`·`/co-ingest` 自动追加机制已于 v3.0 移除）。**绝不删除历史条目**。

格式：每条变更一个 `##` 子标题，含时间、触发源、变更摘要；多数 v3.x 条目附回退路径（部分早期/纯文档条目从简）。未发布功能波次的工作记录以"（未发布波次·工作记录）"标注，置于最近正式发布条目之下——首个 `##` 必须永远是最新正式发布。

---

## 2026-07-17 — v3.5.0 深度对话协作 + 模型优势路由 v2 + Console 接电

- 触发源：LO "深度完善这个 ai agent 智能体系"六点要求（①Claude↔Codex 对话协作 ②深度自定义 ③全配置前端 ④参考 AionUI/codeg/LiveAgent/pi/Codex 桌面端 ⑤多 agent 体系 ⑥按模型优势派活）+ ultracode 授权
- 方法：8 路并行 Workflow 调研（~97 万 token，AionUI/LiveAgent/pi/codeg/Codex 桌面端/多 agent 格局/grok 生态/本地盘点）+ 本地端到端实测 + 烛独立评审（dogfood）

### 变更

- **Claude↔Codex 对话桥（三层通道）**：主路=用户级 MCP `codex-agent`（`codex mcp-server`，Codex 0.144.1）——`codex` 工具开会话 + `codex-reply(threadId)` 多轮往返，**threadId 从 `structuredContent.threadId` 捕获**；跨轮记忆 2026-07-17 端到端实测确认（PONG-1/PONG-2）。降级=`codex exec --json` → `codex exec resume <sessionId>`。深路=app-server（Console 前端专用）。烛 SKILL.md 加 `DL` Dialog 模式，reflection 迭代改同会话续聊（不再每轮冷启动）；顺手清一处"Gemini 资料"残留（对齐 D-2026-07-16-005）。
- **Codex 双角色 profile + 技术执行者路由**：`~/.codex/review.config.toml`（read-only+never，烛评审——只读由沙箱机械保证）+ `~/.codex/executor.config.toml`（workspace-write，技术执行者）。rules §三 新增 🟡 路由"复杂技术实现/独立模块攻坚 → Codex 技术执行者"（LO：codex 作为技术；主驾保留规划+复核）。
- **会话花名册**：`.ai-shared/roster.json`——稳定 agent id + lastThreadId/lastRunAt/lastTopic，第 N 轮召唤默认续会话（LiveAgent roster+resume 模式）；失效如实新开不伪装连续。
- **§三 路由表 v2（按模型优势）**：烛/执行者=gpt-5.6-sol xhigh 深推理；织=grok-4.5（快+$2/$6+500k ctx）+ 超长文档 grok-4.3 1M ctx 档；主驾 Fable 5=规划/编排/综合/最终判断不外包。§四 重写为对话桥三通道；**织反代能力如实化**——xAI Live Search 已 410 Gone、Agent Tools API 不过 OpenAI 兼容反代，WR=grok 推理+web MCP 取数联合（不假装有原生搜索）。
- **Console（apps/control-center）接电**：2026-07-15 已建的 4100 行控制面（CodexAppServerAdapter 真多轮 / 五维路由评分+independentPass / config validate/plan/apply/rollback 管线 / 127.0.0.1+token+SSE）此前与体系平行无治理账——本次补 module.yaml 注册（dialog_bridge + control_center 两节）+ decisions.md 记录 + models.json gemini-research disabled（对齐 D-2026-07-16-005，配置校验全绿）+ `npm test` 46/47 实测（唯一失败 http-e2e 为 60s 超时环境类）。
- **设计文档**：`proposals/v35-deep-collab-design.md`——调研事实（带出处）+ 架构图 + 三决策 + P1/P2 roadmap（bus.jsonl 消息总线 / worktree 隔离 / Grok Build CLI 评估 / 路由信号外置合一 / 仪表盘接 .ai-shared 数据源）。
- **同日增量 ①Grok Build CLI 上线**（D-2026-07-17-002）：官方安装器装 0.2.102 → `~/.grok/config.toml` 自定义模型 grok45-514/grok43-long 走 514claude.xyz 反代 + $GROK_API_KEY **免订阅登录**（headless 冒烟 PONG-GROK）；control-center grok-build 解禁 + rules §四/roster/module.yaml 登记。附带 Codex 配置死字段清理（disable_response_storage + 2×type=stdio + tools.view_image），`--strict-config` 从被挡死到全绿（烛 S1 闭环）。
- **同日增量 ②Console 桌面壳**（D-2026-07-17-003，LO"类 Cursor 桌面应用"）：`apps/desktop` Tauri 2 自研极薄壳（cc-desktop.exe 7.4MB，自动拉起内核+原生窗口+全链清理+桌面快捷方式），**不 fork** AionUI/codeg（内核已自有）。烛对话桥同 threadId 六轮 dogfood（R1 四致命→supervisor 状态机重写→R4 SECURE）= v3.5 DL 模式首个完整实战；回归三轮关窗三清 PASS。
- **同日增量 ③Console Phase 2 两大新页**（D-2026-07-17-004，LO"集成成熟功能并拓展"）：①**体系观测页**——route-gate.log 命中面板 / DELTA 发火账本（decisions+handoff 双扫，stop-gate 同口径）/ handoff 浏览与点读 / sync-runtime 双地落漂移检查，治理数据源首次全部有了"LO 看得见的脸"②**会话聚合页**（codeg 思路）——Claude Code/Codex/对话桥/Grok Build 四源本地会话统一速览（只读元数据+首条摘要，冒烟实测四源全活：25+25+4+5）③current-research 回落链修正：gemini 禁用后可见回落主驾（claude-fable capabilities 补 current-research/web-search——session web MCP 工具集是既成事实），router 测试 7/7 + 全量 46 pass 零回归。

### 回退路径

- MCP 注册：`claude mcp remove codex-agent -s user`
- profile：删 `~/.codex/{review,executor}.config.toml`；roster：删 `.ai-shared/roster.json`
- 文档：rules.md/CLAUDE.md/module.yaml 版本回 v3.4.3，§三/§四/SKILL.md DL 节按本条 diff 反向；models.json gemini-research enabled 恢复 true（不建议——违反 D-2026-07-16-005）

源：`D-2026-07-17-001` + `proposals/v35-deep-collab-design.md` + 烛评审 handoff（见 decisions）

---

## 2026-07-25 — v4.0 深度整合 codeg + LiveAgent + 多 CLI 协作可视化（未发布波次·工作记录）

- **状态**：未发布功能波次（in-flight）。正式 framework version 仍为 **v3.5.0**（rules.md §八）；本条目仅为波次工作记录，正式发布时再升格为 `v4.0.0` 正式条目并置顶
- 触发源：LO "深度完善本作品系统"四点要求（①集成 codeg+LiveAgent 全部功能并加强 ②多 CLI 协作团队系统深度集成 ③创新 ④前端美化）
- 方法：并行调研 codeg（2.4k star）+ LiveAgent（1.4k star）源码 + 514cc 现状审计 → 综合整合方案

### 新增模块

| 文件 | 功能 | 灵感来源 |
|------|------|---------|
| `rich-render.js` | 富内容渲染引擎（Markdown + KaTeX 数学公式 + Mermaid 图表 + highlight.js 代码高亮 + 流式渲染） | LiveAgent streamdown |
| `command-palette.js` | 全局命令面板（Ctrl+K 唤醒，模糊搜索视图/操作/Agent，键盘导航） | codeg + VS Code |
| `team-panel.js` | 团队协作可视化面板（5 命名 Agent 实时状态/角色/负载/协作流/拓扑图） | 514cc 独有创新 |
| `delta-timeline.js` | DELTA 问责时间线（发火净增量评分 + 证据可视化 + 统计面板） | 514cc 独有创新 |
| `project-bootstrapper.js` | 项目启动器（框架/样式/主题/图标/字体可视化配置 + 实时预览 + 一键创建） | codeg Project Boot |
| `utils.js` | 通用工具函数（从 app.js 抽取：escapeHtml/redact/formatDate/normalizeStatus 等） | 组件化 |
| `api.js` | API 客户端（从 app.js 抽取：request/TOKEN_KEY/ApiError） | 组件化 |
| `state.js` | 全局状态管理（从 app.js 抽取：state/VIEW_TITLES/DEFAULT_* 常量） | 组件化 |

### 后端增强

| 文件 | 改进 | 灵感来源 |
|------|------|---------|
| `automations.mjs` | **reconcile backstop**（TurnComplete 丢失恢复）+ **run 历史修剪**（30 天 + 硬上限 100 条） | codeg automation engine |
| `sessions.mjs` | **12 源会话聚合**（原 7 源 + 新增 5 源：OpenCode/Cline/OpenClaw/Hermes/CodeBuddy） | codeg 12 source parsers |
| `orchestrator.mjs` | **委托深度限制**（delegationDepthLimit 1-8，默认 4）+ **#computeDelegationDepth** | codeg DelegationBroker |

### app.js 组件化（第一阶段）

- 抽取 `utils.js`（~200 行）：通用工具函数
- 抽取 `api.js`（~150 行）：API 客户端
- 抽取 `state.js`（~130 行）：全局状态管理
- app.js 从 ~8800 行减少至 ~8576 行

### UI 增强

- **命令面板**：Ctrl+K 全局搜索，支持视图切换、快速操作（刷新/切换主题/新建任务/运行诊断/重载运行时）、Agent 点名
- **团队面板**：系统总览页新增，展示 Claude/烛/织/Kimi/Pi 五位 Agent 的实时状态、角色、负载条、协作流列表、SVG 拓扑图
- **DELTA 时间线**：系统总览页新增，可视化展示每次发火的净增量评分（0=白发/1=补强/2=推翻）、证据、统计面板
- **项目启动器**：新增独立视图，框架（Next.js/Vite/React Router/Astro/Laravel/纯 Node.js）、样式（Tailwind/CSS Modules/Styled Components/原生 CSS）、主题（亮/暗/跟随系统）、图标库（Lucide/Heroicons/Phosphor）、字体（Inter/系统/等宽）可视化配置 + 浏览器风格实时预览
- **富渲染引擎**：Markdown 渲染 + KaTeX 数学公式 + Mermaid 图表 + highlight.js 代码高亮（16 种语言） + 代码块复制按钮 + 流式渲染支持
- **动画系统**：fade-in / slide-up / slide-in-right 三组动画，组件进入/状态变化更流畅
- **键盘快捷键提示**：右下角显示 Ctrl+K 命令面板提示
- **空状态优化**：统一空状态组件样式

### CSS 新增

- 命令面板样式（overlay + 搜索框 + 结果列表 + 键盘提示）
- 团队面板样式（Agent 卡片 + 协作流 + 拓扑图）
- DELTA 时间线样式（统计面板 + 时间线列表 + 评分标记）
- 项目启动器样式（配置面板 + 选项卡片 + 实时预览）
- 富渲染样式（代码块 + Mermaid 容器 + KaTeX + 表格 + 引用块）
- 动画关键帧（fade-in / slide-up / slide-in-right）

### 导航变更

- 侧栏新增"创建"分组，包含"项目启动器"入口
- 系统总览页新增团队面板和 DELTA 时间线容器
- VIEW_TITLES 新增 bootstrapper 条目

### 设计文档

- `proposals/v4-deep-integration-plan.md`——codeg + LiveAgent 对标分析 + 整合架构 + 四阶段实施计划

### v4.0 Forge 深度收口波（2026-07-25，Kimi 主驾 · 10-agent 蜂群 + 集成收口）

**Forge 设计系统（对标 codeg 0.21.8 拆解）**：`public/forge/` 10 个 CSS 层（tokens/motion/primitives/shell/workbench/data/markdown/team/palette/bootstrapper）——OKLCH token 明/暗双主题、radius/elevation/动效预算、Lucide 85 图标离线 sprite（`vendor-lucide.mjs` 已同步 85 清单并修掉 stop-circle→circle-stop）、零 emoji、零 CDN、零内联 style（CSP `style-src 'self'` 全合规，控制台 0 错误）。

**多 CLI 团队旗舰视图 `#/team`**：英雄统计（席位/活跃/今日交接/平均 DELTA）、花名册卡片（品牌色、负载条、状态点）、SVG 协作流图（delegation + handoff 边）、7 日活跃热力、路由决策 + 本地启发式派工建议。全部真实端点驱动，分区降级 + 3.5s 超时骨架。

**新后端**：`src/search.mjs`（五源统一搜索：handoff/context/decisions/MEMORY/会话/skills）、`src/memory.mjs`（记忆库只读视图 + 检索）、observability delta 响应新增规范化 `deltas[]`（DELTA 时间线断裂修复）、`src/bootstrap.mjs`（诚实静态脚手架，dryRun 默认、路径围栏、12 个新测试）。

**关键修复**：静态服务白名单不含 /forge/* 与两个新模块（设计层 404 全灭）→ 子目录段校验放行；自举模块 token 竞态 401 → `apiReady` 信号（setAccessToken 即放行）；双命令面板并存 → 旧 `<dialog>` 面板退役，新模块 extraItems 承接协作/权限/模板动作；collab-flow/team-panel 源文件 NUL 字节转义；契约测试更新为模块化面板现实。

**诚实降级**：KaTeX/Mermaid 实时渲染改为类型徽标 + 源码美化（CDN 版违 CSP 已拆除，vendored 库下波再启）；进程监管 UI 本波仅后端就绪；第一批 changelog 中"KaTeX/Mermaid/highlight.js 实时渲染"描述以本波为准。

验证：`npm test` 446 pass / 0 fail / 1 skipped（447 总），`npm run validate` 12/12，Playwright 11 视图明暗截图巡检 + 控制台 0 错误。

### Wave G 五面门闩开放 + codeg UI 移植 + G4 艺术层（2026-07-25，Kimi 主驾，LO 授权全做）

**五面后端全落地（30 新测试全绿）**：①PTY 终端——node-pty ConPTY 会话 + 环形缓冲 replay + SSE 流（`src/pty.mjs` + `src/pty/routes.mjs`）②Office 文档工坊——docx/xlsx/pptx 进程内生成，dryRun 计划→确认两段，模板与历史台账（`src/office.mjs`）③渠道——Telegram Bot 轮询（`pollIdleMs` 修微任务饥饿）+ 出/入站 Webhook（HMAC-SHA256 需原文体）（`src/channels.mjs`）④SSH/SFTP——ssh2 主机台账、凭据引用制（secrets 永不回显）、指纹三态首连确认、exec 超时与脱敏、SFTP 路径围栏（`src/ssh.mjs`，漏导出 close 已补）⑤市场——MCP Registry 搜索 + skills URL 暂存审查（哈希 + 文件面）→ confirmed 原子安装，台账并发挂 writeChain 修丢更新（`src/market.mjs`）。门闸 v2：`src/security/remote-gates.mjs` 授权账本 7 门（LO 2026-07-25 会话授权），gateway/remote_web 仍封锁。

**前端五视图全量重写**：terminal-panel（vendored xterm 6 多页签 + fetch 流式读 + ResizeObserver）/ office-panel / channels-panel / hosts-panel / market-panel；IA 重组为 5 组 16 项（协作/创建/观测/资源/系统）。

**关键修复（截图走查抓出）**：①五面板 script 未登记静态路径表 → 404 全灭 ②`.mjs` 不在静态扩展白名单 → xterm vendor 全 404 ③xterm DomRenderer `setAttribute("style")` + `<style>` 注入违 CSP → vendored 补丁改 CSSOM setProperty + adoptedStyleSheets 代理 ④PTY SSE 帧前端先反转义再 JSON.parse → 含 `\n` chunk 全丢终端黑屏（服务端多余转义同步清除）⑤waveg.css 臆造 `--forge-*` 变量族暗态穿帮 → token alias 层映射 tokens.css 真实变量（var() 使用时解析，暗态自动跟随）。

**codeg UI 移植批（G3）**：磨砂表面族（.forge-glass*/侧栏玻璃化，color-mix 86% + blur14/saturate150 对齐 codeg 数值）/ Shimmer 流光（前波已有等价物确认）/ InstantCollapsible → grid 0fr/1fr vanilla 折叠（market 审查卡消费）/ .forge-kbd 快捷键徽章（codeg SHORTCUT_BADGE 几何）/ **highlight.js v11.11.1 vendored**（`scripts/vendor-highlight.mjs` 机械 CJS→ESM 包装 23 语言，修 exports 误替换/typescript 内嵌 javascript 依赖；forge/highlight.css 双主题 token 契约对齐 --shiki-dark；markdown.js fence 分支 unescape→hljs→回落已转义原文，注入面零新增）/ 可拖分栏 `splitter.js`（pointer 捕获 + CSSOM setProperty 走 CSP 安全路径 + localStorage 持久化 + 双击复位 + 键盘步进，协作台左右缝）。

**G4 Awwwards 艺术层**：协作星图 `#/hero`（`hero-starmap.js` + `forge/hero.css`）——六 CLI 家族节点物理布局（库仑斥力 + 环形锚点进动 + 阻尼 + 微漂移）、汉字代号（主/烛/织/前/驻/研，取 blurb 语义首字）+ tokens 品牌色、roster/runs 真实数据驱动活跃节点虚线环与流光边、中心 514 核三层呼吸脉冲、指针引力井 + hover 磨砂名称卡、左侧竖排描边巨字「协作星图」+ 右下巨型描边「6」实验排版、主题切换 MutationObserver 重读 token、reduced-motion 静态一帧全降级、30s 慢轮询（非监控面节奏克制）。

验证：`npm test` 480 pass / 0 fail / 1 skipped（481 总；ConPTY AttachConsole 全量偶发单跑 6/6 过，环境噪音非回归），`npm run validate` 12/12，Playwright 21 站明暗截图巡检 + 控制台 0 错误。

**增强债（照实登记，下波候选）**：Lark/微信渠道（私有协议）、Office 可视化预览（mammoth/沙箱 iframe）、SSH 隧道（LiveAgent TunnelFrame）、跨 run Evidence Graph / Heterogeneous Replay / Counterfactual Dispatch、自托管可变字体 + 防闪字脚本、KaTeX/Mermaid vendored 实时渲染。

### 人文风换血 + 侧栏主流 GUI 化（2026-07-25，Kimi 主驾，LO 视觉反馈驱动）

LO 走查桌面端后两条定性反馈：①玫瑰红不要，要 Claude 人文风格 ②左侧侧栏不紧凑、不像主流 GUI。处理：

- **palette 换血（`forge/tokens.css` 亮暗双主题）**：primary 玫瑰 #b4234d → Claude 铜橙 #D97757（与既有 --agent-claude 同值）；亮色底 #faf9f5 暖米白 / 字 #2a2620 深棕；暗色底 #1e1c17 暖棕黑（弃冷灰）。语义色与 agent 品牌色不动（身份色非 UI 主色）。
- **Legacy bridge（tokens.css 末尾段）**：styles.css 一万行零改动——同名变量 :root/[data-theme="dark"] 后加载覆盖：--rose 族值换铜橙、**--statusbar 玫瑰红底 → 深棕墨底**（亮 #2a2620 / 暗 #14120e）、--bg/--surface/--text 族换暖米白族。
- **侧栏主流 GUI 化（`forge/shell.css` nav 段重写）**：弃全圆药丸（999px → 8px 方圆角，"不像一般 GUI"的核心症结）；行高 34→30px、分组距收紧、图标 15px；hover 中性 muted 9%（Claude 式克制）；选中态浅铜底 + 深棕字 + 图标点铜（弃玫瑰字）。
- **顺手收口**：hero-starmap.js primary fallback #b4234d→#d97757；highlight.css 暗态 --hljs-keyword hue 10.3（玫瑰向）→ oklch(0.74 0.12 40) 铜族；forge/README.md 文档口径同步。

验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，Playwright 21 站 + 星图补拍 2 站明暗截图亲查（亮态暖米白/铜橙、暗态暖棕黑、状态栏深棕、星图铜核、明态暖白终端协调）+ 控制台 0 错误。桌面端静态资产免重启，刷新即生效。

### 布局深度优化（2026-07-26，Kimi 主驾，LO「深度思考优化前端布局」）

证据先行诊断（静态 CSS 审计 + Playwright computed/elementFromPoint 运行时取证）后五刀：

- **去双标题**：顶栏 20px 大标题与 page-heading H1 同词重复 → 顶栏降级为**面包屑位置指示**（`分组 / 当前页` 12.5px 小字，新增 `#current-view-group` + `FORGE_VIEW_GROUPS` 与侧栏 IA 五组对齐，app.js setView 同步），视觉主角还给各页 H1。
- **灭深色泄漏**：`--sidebar: #181a1f`（亮态下仍是老深色轨值）泄漏进 workbench run-rail 渲染出深色块 → bridge 段补 `--sidebar` 三变量（亮 #f4f1ea 暖米族 / 暗 #17140f 暖棕族）。
- **氛围层穿帮修复**：atelier-mesh 玫瑰光晕（亮 rgba(180,35,77,.04) / 暗 rgba(255,120,152,.06)）→ 铜橙族（rgba(217,119,87,.05) / rgba(232,145,111,.07)）。
- **孤儿绿点根因**：侧栏底部游离绿点 = 图标轨时代 `styles.css:7020 .runtime-indicator > div { display:none }` 把 footer 文字隐藏只留居中圆点 → shell.css 恢复文字块 + footer 改左对齐流，现在渲染「点 + API 已连接 / 版本号」标准 footer。
- **工作台三栏比例**：`205px | 1fr | 300px` → `232px | 1fr | 312px`（run-rail 会话条目不再挤字；workbench.css 末尾覆盖层，不碰 styles.css 的 CRLF 混合行尾雷区）；page-heading H1 收敛 clamp(22px,1.8vw,26px) + margin 22→18。

另查实一桩「疑似的 bug 实为既有设计」：协作台页 eyebrow/lede 被 `styles.css:7263` 故意隐藏（compact-heading 给聊天面省垂直空间），保留不动。

### 布局模仿 codeg/LiveAgent 工作区 DNA（2026-07-26，Kimi 主驾，LO「模仿开源作品的布局」）

先读两仓源码定 DNA（codeg `workspace/layout.tsx`：ResizablePanelGroup 侧栏18/主64/aux18 + 主栏纵向 72/28 底部终端 dock；LiveAgent `ChatPage.tsx`：可折叠侧栏 + RightDockPanel），再移植三件套：

- **① 底部终端 dock（codeg 签名布局）**：协作台中栏尾部新增 `#terminal-dock`——grip 拖高（140–55% pane，双击复位，↑↓ 步进）+ 折叠条 + **默认折叠懒挂载** + Ctrl+` 切换。terminal-panel.js **工厂化**为 `createTerminalPanel(root)`（实例各自 tabs 台账，修掉 closeTab 的 getElementById 硬编码），终端视图与 dock 各持一份共享 PTY 台账（后端 stream 订阅制，双挂等价 tmux 双 attach，已实测同 session 两处可见）。
- **② Mission Control 右栏折叠（codeg aux-panel / LiveAgent RightDock）**：header 注入折叠钮 → 收起成 34px 细条（纵向 panel-right 钮展开），宽度记忆恢复；折叠期右 splitter 自动失效（codeg 同款 pointer-events none）。
- **③ run-rail 分组折叠（两家侧栏共同特征）**：chevron 注入 团队/置顶/会话/正在工作/自动化 五块头部，状态 localStorage 记忆（已归档块自带原生 toggle 不动）。

**关键修复（截图走查抓出）**：①dock 初版被 grid auto-placement 抢到行 1 顶上去——该格子孩子全带显式 grid-row（styles.css:7374-7462 tabs=1…composer=6），dock 必须显式 `grid-row:7` + 模板补第七轨 ②dock 展开后固定行高超 pane 高度溢出裁切——`:has(.terminal-dock:not(.is-collapsed))` 时消息流 min 240→96（codeg 式 reflow）。

新文件：`workbench-chrome.js`（三件套行为，已登记 server.mjs 静态表）。验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，Playwright 全站 + dock 明暗自指定交互截图亲查（dock 展开/折叠/MC 折叠/分组折叠/暗态）+ 控制台 0 错误。

验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，Playwright 21 站 + 星图 2 站明暗截图亲查（面包屑各组正确、footer 文字归位、run-rail 深色块消失、暗态终端/星图协调）+ 控制台 0 错误。

### 协作台工程逻辑收口（2026-07-26，Kimi 主驾，LO「布局太乱没有工程逻辑」）

先截图亲诊、再读 codeg `workspace/layout.tsx` 提取纪律（**一面板一职责一标题；重复信息只在一个 chrome 层出现；主内容 ≥64%**），对症下刀（全部覆盖式，styles.css 存量零改动）：

- **① 视图内 hero 行整排撤下**：协作台视图内 eyebrow+h1+营销文案与全局面包屑「协作 / 协作台」重复、CLI 脉搏条与全局状态栏 `global-team-pulse` 重复——CSS 隐藏文字块与 `#workbench-team-pulse`，只留 run 状态徽标；会话区直上 ~64px。
- **② 团队标题行 7 控件收编**：近期/摘要/子代理/已隐藏 4 toggle 移出标题行进独立 `.rail-filters` 折叠行（默认收起），标题行只留 筛选/设置/计数；筛选非默认态时按钮常驻高亮（折叠也看得出列表被过滤）；新增 lucide `list-filter` 图标（vendor-lucide.mjs 清单 +1，重生成 97 symbols——0.511 已把 filter 更名 funnel）。
- **③ 栅格重分配**：run-rail 232→216、Mission Control 312→288，会话区让出 ~40px（对齐 codeg 18/64/18 的宽度优先级）。
- **④ composer 四行 chrome 收三行**：hint 行（+新任务/地址/模式提示）并入 bookmarks 行右端（DOM 搬移，byId 引用全保）；会话标题行 minmax 54→44。
- **⑤ 暗色玫瑰填坑**：styles.css 暗色块未定义 `--rose-fill` 族（继承亮主题 `#b4234d` 玫瑰红），tokens.css 亮 bridge 有、暗 bridge 漏——补 `--rose-fill/--rose-fill-bright` 暗色映射，暗态选中卡/发送钮/徽标玫瑰粉根绝。
- **⑥ rail statusline 紧凑化**：五段信息在 216px 内 padding/字号收紧，不再挤三行。

**走查陷阱记录**：qa 脚本暗色首截文件名是 `13-workbench-dark` 但 reload 后视图持久化恢复到启动器页——旧档 `08-workbench-dark.png` 是历史脚本残留（粉色暗态实为换血前旧图），险些误诊「暗 bridge 整段不生效」；已删残留并补 `qa-v4-wave4-probe.mjs`（暗色真协作台 + 筛选行开合 + 亮色 composer 近景三截）。验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，探针三截 + 21 站全量明暗亲查 + 控制台 0 错误。纯静态资产变更（server.mjs 未动），桌面端 Ctrl+R 即生效。

### 成熟应用布局波：Claude 居中阅读栏（2026-07-26，Kimi 主驾，LO「模仿 cursor claude codex 成熟应用布局」）

取证：composer-shell 本就是 `min(720px,100%)` 居中浮动卡（Claude 签名），但消息流全宽铺——内容与输入框不在同一栏，视觉断轴。

- **消息流对齐阅读栏**：`.conversation-stream > *` max-width 720 + `margin-inline:auto`，消息/恢复卡/轮分隔线/历史门全部与 composer 共享同一居中栏（Claude 单栏纪律：流与输入同轴）。
- **阅读节奏**：消息间距 18→22、正文行距 1.62→1.7、发送者名 11→12（字号不动，工具输出密度优先）。
- **第三重 CLI 徽标撤除**：会话 heading 里的参与 chips 行（`.conversation-agents`）与 member-strip 页签 + 全局状态栏三重重复，CSS 隐藏（DOM/JS 不动）。

验证：`npm test` 480 pass / 0 fail / 1 skipped（其间一轮 fail 1 为偶发 flake，连跑两轮复核归零），`npm run validate` valid，探针暗/亮协作台截图亲查（流-卡-输入同轴居中）+ 控制台 0 错误。纯 CSS 变更，Ctrl+R 生效。

### 单界面波：撤左侧栏、全部入口集中顶栏（2026-07-26，Kimi 主驾，LO「不要左侧栏，所有按键集中到一个界面」）

取证：`topbar-nav` 本已全量镜像侧栏 15 视图（styles.css:7073 一直 `display:none` 雪藏），无需造新导航——扶为正主即可。

- **侧栏整列撤下**：`.sidebar{display:none}` + app-shell grid 收单列（`"topbar"/"main"/"statusbar"`），grid-area 失效隐式列陷阱以 display:none 规避。
- **协作星图补位**：原 topnav 缺 hero 视图（侧栏独占），撤栏即不可达——补 `<button data-view="hero">`（lucide orbit）。
- **面包屑同撤**：`topbar-title` 与 nav 激活态重复（wave-2 产物，单界面下让位）；品牌锁字隐去只留火焰标（品牌块此前已被旧规则隐藏，实为兜底）。
- **防溢出紧凑化**：8 个长标签收两字（团队协作→团队、系统总览→总览、体系观测→观测、会话聚合→会话、能力图谱→图谱、配置中心→配置、模型路由→路由、安全诊断→安全，title/aria 留全称），nav 项 padding 11→9、字号 12.5→12——16 项 1512px 全量无截断。
- **零 JS 改动**：setView 本就同步全部 `[data-view]` 的 is-active/aria-current，点击委托 `closest("[data-view]")` 顶层生效；QA 两脚本 goView 改走 `.topbar-nav`。

验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，21 站全量明暗截图亲查（顶栏 16 项全显、星图经顶栏直达且全宽气势完整）+ 控制台 0 错误。

### 角位开关波：终端撤下顶栏、开合键统一右上角（2026-07-26，Kimi 主驾，LO「终端不做页面标签，和右栏开关键统一放右上角」）

对齐 codeg RightEdgeChrome DNA（终端/aux 开合钮固定右上角）：

- **终端撤下顶栏**：`.topbar-nav [data-view="terminal"]{display:none}`——底部 dock + 右上角开关 + Ctrl+\` 已全覆盖入口；视图本体保留（Ctrl+K 面板可达，QA 脚本 terminal 站改 dispatchEvent 点击）。
- **角位双开关**：topbar-actions 尾部新增 `#global-terminal-toggle`（square-terminal）与 `#global-mc-toggle`（panel-right），aria-pressed + is-active 铜底实时反映开合态；非协作台视图点击先自动切回协作台再开合（探针实测 BACK-TO: view-workbench）。
- **同步器接线**：workbench-chrome.js 两个 setCollapsed 出口统一调 hoisted 同步函数（dock 条/Ctrl+\`/角位钮/MC 头折叠钮/细条展开，全路径角标一致）；初版 const 箭头函数包裹赋值会 TypeError，改函数声明提升修正。

验证：`npm test` 480 pass / 0 fail / 1 skipped（偶发 flake 第二次出现又自复，仍未捕获用例名，复现再追），`npm run validate` valid，探针 `qa-v4-wave5-probe.mjs` 四截亲查（顶栏无终端、角钮开 dock、角钮收 MC、跨视图回切）+ 控制台 0 错误。

### 团队配置友好性波（2026-07-26，Kimi 主驾，LO「团队配置界面太简单/不够用户友好」）

- **成员裸 checklist → 富选项卡**：`fillTeamForm` 成员行重写为「品牌头像（cliIconMarkup logo/双字兜底）+ 名称 + 头衔·职责」卡，元数据复用 team-panel.js 的 `PROFILE_META`（改 export，与团队运行面同源，不再两处维护）；品牌色零新映射——team.css 的 `[data-brand] → --agent-accent` 现成表直接消费（选中/hover/checkbox accent 全走它）。
- **主脑 radio 胶囊化**：卡片右侧 pill，选中态铜底加粗，一眼可辨谁是入口。
- **对话框内团队切换器**：头部新增 `#team-switch-select`（内置团队带标注，新建态前置「＋ 新团队」），免「关闭→rail 换当前团队→重开」三件套；切换丢弃未保存修改（title 注明）。
- **能力声明分区标**：Skill/MCP 前加 `.form-section-label`（声明性定位一句话说清）。

验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` valid，探针三截亲查（亮色富卡对话框 / 切换器 / 暗色品牌色卡）+ 控制台 0 错误。

### 能力声明芯片墙波（2026-07-27，Kimi 主驾，LO「skill和mcp的配置和选择太混乱了好几个界面和很粗糙简单的写入」）

团队对话框的 Skill/MCP 逗号文本输入（`splitList` 时代）彻底退役，换成真实目录驱动的勾选芯片墙：

- **数据源同源**：目录取自 `/api/capabilities`（与能力图谱视图同一份扫描，skills 矩阵 + MCP servers），不再让用户徒手拼逗号字符串猜名字；分区标「能力声明」附「前往管理」`data-view-jump="capabilities"` 直达真实启停矩阵——声明（派工参考）与启停（运行开关）分层一句话说清。
- **芯片三态**：勾选暖铜高亮 / 未勾灰框 / 幽灵片（团队声明了但目录没有，虚线边 + title「取消勾选即摘除」，绝不静默吞掉——内置 514cc 团队实测带出 co-research/co-enhance/vibe/ssh/docx 五枚用户域幽灵，如实示形）；MCP 禁用项划线 `is-off`。内置团队只读全 disabled，走「另存为新团队」。
- **收集回路**：`collectTeamForm` 改读 `checkedChipValues`（墙无 checkbox 时回退团队原值，防目录未到时保存清空声明）；`loadCapabilities` 末尾加对话框回填钩子（目录晚到场景，checkedChipValues 保留当前勾选不回滚）。
- **失败态修复（本波抓出的真 bug）**：原实现失败后墙永停「正在读取…」且渲染层回环重触发 `loadCapabilities` 会无限自旋（请求风暴、零控制台报错、极难察觉）。修法三件套：`state.capabilitiesLoading` 在飞去重闸门 + 失败显式停「目录读取失败：xxx + 重试钮」（`data-chips-retry` 委托）+ 勾选意图暂存 `teamChipsPending` 重试不吞选择。故障注入探针实证：注入 500 后静置 2s 请求数=1（不自旋）、点重试放行后 26/39 芯片回填、7 勾选保留。

验证：`npm test` 480 pass / 0 fail / 1 skipped（其间一次 EBUSY Windows 文件锁 flake 自复，与前端无关），`npm run validate` valid，探针 `probe-chips.mjs` / `probe-chips-fail.mjs` 六截亲查（亮/暗芯片墙、勾选高亮、幽灵虚线片、失败态+重试恢复）+ 页面 0 错误。

### 配置中心分组树波（2026-07-27，Kimi 主驾，LO「配置中心界面各种配置混在一起很乱」）

配置源列表 99 项一锅平铺（SKILL.md/hooks/toml/mdc/宪法/运行时镜像全混在一条流里）→ 语义分组折叠树：

- **13 组路径拓扑分类法**：`sourceGroupFor` 按路径前缀归组——治理核心（根级宪法 5）/ Claude·Codex·Cursor 三平台（9/13/10）/ 平台技能·.agents（7）/ 领域技能·skills/（19）/ 控制台（6）/ 人格与定制（4）/ 守卫层（3）/ Lilith 子系统（14）/ 状态栏（2）/ 运行时镜像·只读（7，scope=runtime/secret 永远沉底）/ 其他兜底。顺序即展示序，组头 Lucide 图标 + 计数胶囊 + chevron 旋转。
- **折叠交互**：默认全折叠（一屏 12 行组头代替 99 行乱流，全局结构一眼扫完）；**含选中源的组强制自动展开**（selection 可见性优先于手动折叠）；手动折叠态存 `state.sourceGroupsExpanded`（会话级）；**搜索态退化为平铺结果**（0 组头，分组在过滤时反而碍事）。
- **零服务器改动**：纯前端渲染层重组（renderSources 拆出 sourceItemMarkup 复用），数据面/选中逻辑/脏检查确认弹窗全不碰。

验证：`npm test` 480 pass / 0 fail / 1 skipped，`npm run validate` 12 面 valid，探针 `probe-config-groups.mjs` 四截亲查（亮色全折叠 / 手动展开领域技能 / 搜索退化平铺 / 暗色双组展开）+ 计数总和 99 对账 + 页面 0 错误。

### cc-switch 供应商方案迁移波（2026-07-27，Kimi 主驾，LO「配置中心请你迁移 cc-switch 的配置方式并且添加团队配置的拓展」）

迁移 [farion1231/cc-switch](https://github.com/farion1231/cc-switch) 的统一供应商模式（读源码 `provider.rs` 取经：UniversalProvider 一处录入、按 app 投影、SSOT 不写副本），并加 514cc 独有的团队绑定扩展：

- **后端 `src/providers.mjs`（新）**：ProviderStore 存 `dataRoot/providers.json`（0600 原子写 + 串行队列）。三 CLI 投影——claude → `~/.claude/settings.json` env 合并（无关键一字不动，无 Key 不动 AUTH_TOKEN 照顾官方订阅）；codex → auth.json 合并 + config.toml 标记块外科手术（顶层键只动三枚、用户 section 全保留、重复切换不叠块，base_url 纯 origin 补 /v1 照搬 cc-switch 规则）；gemini → `.env` 标记块。**514cc 化四处差异**：apiKey 永不出服务端（list 只回掩码+hasApiKey，update 留空=保留）/ 每次切换前时间戳备份到 `backups/providers/` / live 状态回读按 baseUrl 认亲（外部手改照实显示，current 指针不唯真源）/ live 是坏 JSON 时 INVALID_LIVE_JSON 拒写不 clobber。路由 5 枚（CRUD/switch/apply-team，literal 先于 :id 匹配）。
- **团队配置扩展（cc-switch 没有的面）**：teams schema 加 `providers: {claude|codex|gemini: providerId}`（键白名单严格校验）；团队对话框加「供应商绑定」三下拉（跟随当前全局/档案/失效绑定示形）；配置中心「团队方案」条一键应用——逐 app 投影、部分失败如实逐项回报。
- **前端**：配置中心顶部「供应商方案」面板——三应用列（live 行 + 档案卡片：当前/live 认亲双徽标、Key 掩码、启用/编辑/删除），新增/编辑对话框（应用勾选联动模型区显隐，Key 只出不进占位符提示）；每次进入配置视图全量刷新（修掉懒加载只进一次拿陈旧绑定的实锤 bug）；品牌点颜色走 CSSOM（无内联 style 铁规）。
- **测试加固（顺手除旧患）**：http-e2e pulse 测试的 Windows 瞬时锁（probe 落 pid 文件瞬间 readFile 撞 EBUSY）按未就绪重试——此前「偶发自复」的 flake 在本波并行压力下变成 4/4 必现，修后两轮全量连续 0 fail。

验证：`npm test` 494 tests / 493 pass / 0 fail / 1 skipped（481 基线 + 13 新 providers 用例，两轮连续），`npm run validate` 12 面 valid，探针 `probe-providers.mjs` 全流程走查（建档→卡片→确认切→live 认亲→团队绑定→一键应用 toast「方案已应用（2 个应用）」）+ 磁盘实证（settings.json env 投影 / config.toml 标记块 / auth.json / 两次切换两枚备份）+ 六截亲查 + 页面 0 错误。

### cc-switch 完全迁移波（2026-07-27，Kimi 主驾，LO「我叫你完全迁移他的全部功能和能力，并且可以搬代码」）

LO 提供本地源码包 `cc-switch-3.18.0.zip`（`.scratch/cc-switch/`），逐文件深读 `speedtest.rs` / `stream_check.rs` / `usage_script.rs` / `endpoints.rs` / `deeplink/parser.rs` / `commands/failover.rs` / `UsageScriptModal.tsx`（PRESET_TEMPLATES 全文）后，把 cc-switch 供应商管理面**除常驻代理/熔断器/request-log 外的全部能力**搬进 `apps/control-center`：

- **网络服务 `src/provider-net.mjs`（新，Rust→Node 等价复刻）**：①`testEndpoints`（speedtest.rs：并发 GET 热身一次再计时，timeout clamp 2–30s）②`checkReachability`（stream_check.rs：任意 HTTP 响应=可达、TTFB 三档 operational/degraded/failed、仅超时类重试、默认 8s/1retry/6000ms 阈值照抄）③`queryUsageScript`（usage_script.rs：`node:vm` 沙箱替代 QuickJS，四模板变量替换、HTTPS 强制 loopback 豁免、非 custom 模板同源同端口闸、结果八字段类型校验、非 2xx 截断 200 字符——语义逐行对齐）④内置模板 GENERAL/NEW_API/CUSTOM 全文一字未改搬自 `UsageScriptModal.tsx` ⑤`parseDeeplink`（parser.rs provider 分支：ccswitch://v1/import 全参数、endpoint 逗号分隔首主余备）⑥`testModelRequest`（真实小请求面：claude /v1/messages、codex /chat/completions 走 codexBaseUrl、gemini generateContent——回答可达性刻意不答的「鉴权对不对、模型存不存在」）
- **存储扩展 `src/providers.mjs`**：ProviderMeta 全字段白名单（customEndpoints normalize 去重 / usageScript 四敏感字段留空=保留 / testConfig / proxyConfig / endpointAutoSelect / costMultiplier / 日月限额 / apiKeyField）；投影增强——claude `ANTHROPIC_API_KEY` 变体 + HTTPS_PROXY、gemini .env 代理行；commonConfig 三形态并入（claude JSON→settings 顶层、codex TOML→标记块尾、gemini KEY=VALUE→.env 块）；sortIndex 排序；per-app failoverQueue+autoFailover（空队列开启自动补 P1、关闭不清队列、删除自动清出）；`failoverNext` 自动转移驱动点（514cc 化：cc-switch 靠常驻代理被动驱动，我们驱动点=健康检查失败且为当前供应商）；export/import（默认掩码导出、includeSecrets 显式明文、merge/replace 两模式、活引用反抹 bug 修复）；envConflicts（系统环境变量撞车检查，值掩码）。
- **路由 +13 枚**（server.mjs，literal 先于 :id）：test-endpoints / usage-templates / usage-test / sort / export / import / import-deeplink / env-conflicts / common-config / failover/:app（GET+PUT）/ :id/check（含 failover 联动）/ :id/model-test / :id/usage。
- **前端**：工具条五图标（排序模式/导入/导出/深链接/环境检查）；卡片健康点（四态+检查中脉冲）、测速徽标、用量行（查询/结果/失败重试）、failover P 序徽标与加退队列按钮、排序模式上下移；每应用列 failover 管理条（P1..Pn 芯片+自动转移开关）；对话框重构六分区 tab——基本/端点（备选端点 CRUD+测速全部+自动选优换主）/用量（模板联动只在未手改时替换、脚本测试不保存直接跑）/代理/测试/高级；autoQueryInterval 前端定时自动查（会话级）。Lucide sprite 97→105（arrow-down/download/file-json/flask-conical/heart-pulse/import/repeat/wallet，vendor-lucide.mjs 重生成 0 缺失）。
- **明确不迁（向 LO 报备）**：常驻本地代理接管+熔断器+request-log 用量统计（架构不同——我们直写 live 配置而非代理转发，安全面太大）、WebDAV/S3 同步（引网络存储依赖）、托盘/自启/updater（壳层面，cc-desktop 自有）、OpenClaw/OMO/Hermes/OpenCode 运行时（不集成的面）、Skills/MCP/Prompt 管理（514cc 已有能力图谱/配置编辑器等价面）。

验证：`npm test` 516 tests / 515 pass / 0 fail / 1 skipped（494 基线 + 22 新 provider-net 用例：测速/可达性三档/用量沙箱端到端与七类闸/深链接/模型请求/meta 校验/排序/failover 自动切换写 live/导入导出/commonConfig 投影/envConflicts）；探针 `scripts/qa-w2-probe.mjs` 隔离实例（CONTROL_CENTER_RUNTIME_HOME 隔离）全流程 12 截亲查——面板三列 failover 条/健康点红 failed/测速 85ms 绿字与 ECONNRESET 红字如实、六 tab 全巡、端点测速、用量脚本 ECONNRESET 失败如实、排序模式 disabled 边界、环境检查 toast；页面 0 非预期错误（7×501=Wave G 门闸收敛面预期）。

### 会话流布局对照波（2026-08-02，LO「继续优化前端布局对照参照工程」）

codeg/LiveAgent 布局 DNA 再取证（两探索代理各 15 条清单）后，取剩余未移植且高价值/低成本的五项（两半片落地）：

- **回到底部浮钮（LiveAgent ChatTranscript / codeg message-thread 同款）**：`workbench-chrome.js` 新增 `bootStreamChrome()`——sticky 哨兵挂 `.conversation-stream` 内容末尾（`height:0` 不撑排版），脱底 >160px 浮出圆形 ↓ 钮，点击平滑回底（reduced-motion 降级瞬时）；渲染器 `replaceConversationStream` innerHTML 全量替换后由 MutationObserver 自动挂回哨兵，app.js 既有 capture/restore 滚动保持不动。
- **超长用户消息折叠（codeg collapsible-user-message）**：用户气泡正文 >240px 才钳高 + 底部渐隐遮罩（color-mix 与气泡同变量，明暗不穿帮）+ 展开全文/收起钮（事件委托，aria-expanded）；短消息零侵入，一次性判定打 `data-clamp-checked` 标记不重判。
- **kbd-hint 浮丸退役**：右下角固定浮丸叠在全局状态栏右段（本机控制面/版本号）上，且 Ctrl+K 发现性已由顶栏搜索框承担——`forge/shell.css` 隐藏去重，DOM 保留零 JS 风险。
- **消息行 hover 复制钮（codeg hover copy / LiveAgent RowActions）**：行右上角浮动复制钮，绝对定位脱 grid 不入行布局，hover/focus-within 才显（键盘可达）；复制渲染后正文，clipboard API + execCommand 降级双路，成功换 check 图标 1.2s；注入打 `data-actions-checked` 标记，与折叠共用同一个 MutationObserver 对账。
- **MC dock tab 状态徽标（LiveAgent RightDockTabStrip 同款）**：`renderTabBadges(value)` 挂进 render/loading/empty/error 四出口——任务 tab 运行绿点/关注琥珀点（含 recovery_required/cancelled，补漏后实测命中）、产物 tab 登记计数、证据 tab 降级或待审批关注点、连接 tab 在线 n/N 计数；loading/empty/error 如实清空不残留。

验证：`npm test` 646 / 645 pass / 0 fail；`npm run validate` valid；探针 `scripts/qa-layout-wave6-probe.mjs` 合成消息流实测——脱底 1741px 浮钮显、点击回底 0px 浮钮收、长气泡钳 238px 展开 455px、kbd-hint display:none，明暗渐隐遮罩截图亲查；探针 `scripts/qa-layout-wave6b-probe.mjs` 实测——6 行全注入复制钮 opacity 0→hover 1→点击换 check、MC 徽标 产物 4 / 连接 6/6 / 任务 recovery_required 琥珀点；21 站全量截图 0 控制台错误。冒烟实例 :5520 已回收。回退 = 删 workbench-chrome.js ⑤节 + forge/workbench.css、forge/shell.css 的 2026-08-02 波段 + mission-control.js renderTabBadges。

### 团队协作逻辑完善波（2026-08-02，LO「查看团队协作逻辑继续完善整个体系」）

深读 collab-flow/team-panel 协作链路后修复一处真实系统性降级 + 三项派工建议增强：

- **health 独立轨道（根因修复）**：实测 `/api/health` 逐 CLI 探测需 ~5.3s，而 refreshCollabFlow 给它与快源同等的 3.5s 预算——永远超时，席位状态永远停在「未核验」。拆轨：快源 teams/runs/delta/handoffs/routegate 3.5s 先渲染首屏，health 走 12s 独立轨道，到达后按 refreshVersion 守卫补载 renderHero/renderRoster/renderFlow/renderRouting；探针失败保持「未核验」，诚实不伪装。实测 hero 首屏 632–721ms 就绪（旧路径必卡满 3.5s 超时），席位 未核验→可用 补载升级。
- **buildCollabLoadResult sourceNames 归因**：settled 从全集 6 源变快源 5 元素后，失败源按索引归因会错位（delta 被误标 health）；调用方经 `details.sourceNames` 显式声明归因表，缺省回退全集顺序，旧 6 元素测试不动保持绿。
- **派工建议感知席位状态**：`suggestMarkup(text, members, coordinatorId, seats)` 跳过 offline 席位、给 busy/degraded/unknown 加状态 chip；SUGGEST_RULES 移除 `gemini-research`（该 profile 已禁用，context.md 明说）；全离线时如实 hint。
- **建议卡一键采用**：建议卡 `data-suggest-agent` + role=button，点击/Enter 把建议席位写进协作台 composer `#start-agent` 并派 change 事件 + `cf-adopted-flash` 闪烁；选择器缺席/disabled/无该 option 时如实写 hint（如实命中「会话进行中，起始成员已锁定」——续聊模式 composer 冻结是 app.js 既有设计，探针实证非本波引入）。
- **健康补载保输入**：renderRouting 重渲染前记住 `.cf-suggest-input` 已输入描述，渲染后回填并重算建议结果，health 补载不打断用户输入。

验证：`npm test` 650 pass / 0 fail / 1 skipped（team-panel 19 含新增 6 项：offline 跳过/busy 标注/unknown 标注/全离线 hint/gemini 不出现/建议采用）；`npm run validate` valid。探针 `scripts/qa-collab-wave-probe.mjs`（预览实例 :5520）实测 hero 632–721ms、席位 未核验→可用、建议输入补载后保留、锁定期如实 hint、明暗截图 0 控制台错误；探针 `scripts/qa-collab-adopt-probe.mjs`（隔离实例零 run）实证 happy path：claude-fable→codex-technical 切换 + flash + 「已填为起始成员：Codex」。预览实例 :5520 保留（LO 正在用）。回退 = 删 collab-flow.js 本波改动 + forge/team.css「协作逻辑完善波（2026-08-02）」段。

### 团队配置便利层波（2026-08-02，LO「检查团队配置模式我需要方便配置并且需要能够高度自定义」）

深查三层（配置源 teams.json 游离于治理体系外/后端 CRUD 已终审冻结/前端有表单但缺快捷路径）后，在安全增量面落地**预设模板 + 团队包导入导出**，纯前端编排，CRUD 全走既有 `/api/teams`、`/api/team-members`，不碰内核：

- **预设模板一键新建**（`public/modules/team-config-kit.js` TEAM_PRESETS）：研发攻坚团/评审团/研究写作团/全栈混编团四套，各含成员配比+主脑+协作风格提示词；`resolvePreset` 按本机目录过滤缺席/不合格席位（主脑缺席回退首个可任主脑成员，缺席如实 toast）；skills/mcp 留空不臆造目录外条目；gemini-research 禁用席位不进任何预设。头部「预设」下拉选用即填草稿（可改后保存），与「新建」同走 confirmDiscard 纪律。
- **团队包导出**：表单新增「导出」钮，`buildTeamPack` 把已保存团队打成 `514cc-team-pack` v1 JSON——自定义成员随包携带完整定义（label/role/提示词/能力/runtimeProfileId/默认模型/主脑资格），内置席位只带 id 引用；目录已没有的幽灵席位不背包。有未保存草稿时如实提示「导出的是已保存版本」。
- **团队包导入**：头部「导入」钮，`parseTeamPack` 逐条中文报错（format/version/空名/空成员/>40/缺 runtimeProfileId）；`planMemberResolution` 命中优先级 同 id → 同 label+runtimeProfileId 孪生（防重复导入造重）→ 新建（逐成员 try/catch，失败如实列入跳过）→ 内置缺席如实报告；`remappedTeamPayload` 主脑丢失回退首成员、全灭返回 null 中止；重名自动加「（导入）」后缀；导入完成直达编辑面。
- **目录竞态守卫**：排查中发现 `/api/bootstrap` 在启动期被长连接（SSE/PTY 流）挤占，实测迟到 6.6s（预览实例）~8s（隔离实例），期间团队表单成员区为禁用占位——既有系统性现象（记为后续债务）。预设套用改为轮询等目录至多 12s，到位自动套用，超时才明示放弃，绝不用空目录套"全席位缺席"假草稿。
- **自修两处实现 bug**：`unwrapList(payload, "members")` 字符串键被逐字符展开导致目录解析恒空（utils.js 契约是数组键，collab-flow 另有本地字符串版）——探针实证导出包 builtinRefs 0→3；编辑误删 payload 声明行由 toast 实证「payload is not defined」当场修回。

验证：`npm test` 656 pass / 0 fail / 1 skipped（新增 tests/team-config-kit.test.mjs 6 项：预设不含禁用席位/resolvePreset 过滤与主脑回退/打包拆分自定义与内置引用/坏包逐条报错/导入计划孪生复用与跳过/重映射失败关闭）；`npm run validate` 13 valid。探针 `scripts/qa-team-config-kit-probe.mjs`（隔离实例）实测：预设套用 3 成员+Codex 主脑就位 → 保存建团 → 导出包 builtinRefs=3 → 导入同包全员复用零新建+重名避让「评审团（导入）」→ 坏包诚实报错，明暗截图亲查（`.qa-v4/team-kit-*.png`），0 控制台错误（隔离 501 属 test-mode 已知噪音）。预览实例 :5520 保留。回退 = 删 modules/team-config-kit.js + app.js 预设/导入导出接线 + index.html 四处控件 + tests/team-config-kit.test.mjs。

### 成员配置页面完善波（2026-08-02，LO「完善成员配置页面」）

在便利层波之上补齐成员库最后一里可视性，纯前端增量（成员/团队数据全走既有 state.teams + state.memberCatalog，零新端点、不碰 CRUD 内核）：

- **使用情况区块**（`public/index.html` #member-usage-strip + `modules/member-library.js` usageOf/renderUsage）：编辑器头部列出引用此成员的全部团队 chip——内置标记、主脑金色描边「· 主脑」；空态明示「未被任何团队引用——删除/换绑都安全」；chip 点击经 onOpenTeam 直达该团队编排面（openTeamWorkspace 自动切 surface）。删除钮 title 同步列出引用团队名单，把服务端 MEMBER_IN_USE 拦截从"无解释报错"前置为"操作前可见"。
- **删除确认前置说明**：remove() 确认框新增「团队引用」行——被引用时逐一点名（含主脑标记）并明示"服务端将阻止删除，需先移出"，未被引用时明示"可安全删除"。
- **列表品牌头像 + 徽章**：成员行头像位改为品牌 SVG logo（cliIconMarkup 注入，无图标回退缩写 initials），行内新增徽章列——「主脑可任」（金色，coordinatorEligible 服务端判定）与「团队 n」（被引用计数）；gemini-research 禁用席位零徽章、灰就绪点，如实呈现。
- **简介/提示词字数统计**：两个长文本 label 内嵌 `n/2000`、`n/12000` 实时计数（maxlength 截断前可见，≥90% 变金加粗警示），输入监听与脏标记同链路。
- **刷新钩子**：工厂新增 refreshUsage()（重渲列表徽章+使用情况），app.js 在 fillTeamForm 末尾与 runtimeSeatManager onCatalogChanged 两处接线——团队保存/删除/新建/席位目录变化后成员库展示同步。

验证：`npm test` 656 pass / 0 fail / 1 skipped（无回归）；`npm run validate` 13 valid。探针 `scripts/qa-member-library-probe.mjs`（隔离实例）实测：预设建团「评审团」→ 列表 7 席全带品牌 logo、徽章计数准确（codex-technical「主脑可任+团队 2」，gemini-research 零徽章）→ 编辑器使用情况双 chip（514cc 内置 / 评审团·主脑金色）+ 删除钮 title 点名两团 → chip 点击跳回编排面 → 打字计数 29/2000→6/2000 实时变化，明暗截图亲查（`.qa-v4/member-lib-*.png`），0 控制台错误。预览实例 :5520 保留。回退 = 还原 member-library.js/index.html 四处标记/app.js 六处接线 + team.css 完善波段落。

### 成员选择区分组/搜索/新建成员波（2026-08-02，LO「新建团队时选择成员我需要也能有新建成员的选项……成员要能分类展开并且可以搜索」）

团队编排面成员选择区从平铺列表升级为可导航结构，纯前端增量（数据全走既有 state.bootstrap.teamCatalog，零新端点、不碰 CRUD 内核）：

- **品牌分组折叠**：`renderTeamMemberOptions` 重构——席位按品牌分组成 `section.tm-group`（Claude/Codex/Grok/Kimi/Gemini/Pi/其他，固定序），组头带品牌 logo + 「n 席 · 已选 m」实时计数 + chevron 折叠；折叠态存内存 Set 跨团队保留，组计数由 updateTeamRosterSummary 随勾选联动。
- **搜索过滤**：成员区头部工具条新增搜索框（多关键词空格 AND，匹配 id/名称/简称/职责/provider/席位/品牌中文名），Esc 清空；**过滤只切换行 hidden 绝不移出 DOM**——collectTeamForm 直接读 DOM checkbox，新团队草稿已选成员被过滤隐藏时保存不丢（探针实证：勾选后搜索 kimi，codex 行 hidden 但 checked 保留、roster summary 计数不变）。搜索框 input 事件 stopPropagation，绝不误触 form 脏标记；切团队时重置搜索。
- **新建成员入口**：工具条「新建成员」钮 → member-library 暴露的 `createNew()`（与成员库按钮同入口：canDiscard 守卫 + 席位目录空时先刷新 + 直达 members surface 空白草稿）；保存成功后 save() 回调 `onMemberSaved(memberId)`，app.js 自动勾入当前团队草稿并标脏（内置只读团队不勾），toast 明示"保存团队后生效"。
- **契约安全**：成员库既有 `data-edit-team-member` 编辑钮、checkbox/radio 联动、teamMemberState/onToggleTeamMember 跨面查询全部经 querySelectorAll 全列表检索，分组嵌套不破坏；契约测试 team-workspace-ui.test.mjs 无改动通过。

验证：`npm test` 656 pass / 0 fail / 1 skipped（无回归）；`npm run validate` 13 valid。探针 `scripts/qa-member-groups-probe.mjs`（隔离实例）实测：6 组品牌分组渲染+计数 → 折叠 codex 组行 hidden 但 checkbox 留 DOM 保持 checked → 搜索 kimi 只剩 kimi 组、已选 hidden 行计数不变 → 无匹配空态 → 新建成员直达空白草稿 → 保存「探针测试员」自动勾入草稿（roster 2→3、标脏、落 claude 组），明暗截图亲查（`.qa-v4/member-groups-*.png`），0 控制台错误。回退 = 还原 app.js 分组渲染段/index.html 工具条/member-library.js createNew+onMemberSaved/team.css 分组段落。

### 席位配置面完善波（2026-08-02，LO「运行席位设计不合理……职责默认 team-executor 可以不用、Adapter 模板混入了 Grok Search MCP、正常应该只有 CLI 后端处理工具、其他配置继续完善」）

逆序从「LO 新建席位的第一键」往回推，四处修正 + 两个探针挖出的深层真问题：

- **职责不再预填**：blankSeat `role` 默认空（原 `team-executor`），placeholder 明示「必填，不再预填默认值」；既有席位 distinct roles 灌进 `#runtime-seat-role-options` datalist——建议但不抢第一键。
- **Adapter 下拉只列 CLI 执行后端**：`adapters/manifest.mjs` 给 grok-mcp-via-codex-app-server 加 `selectable: false` + controlNote（仅供内置 grok-search 固定绑定）；`adapterTemplateCatalog()` 全量返回（UI 详情渲染需要模板信息），服务端写路径 `server.mjs` runtimeSeatTemplate 自带 `selectable !== false` 校验不破；新建下拉 6 个可选（claude/codex/gemini/grok-build/kimi/pi），编辑绑定非可选通道的系统席位时追加「（内置席位专用）」标记项如实呈现。OpenCode/OpenClaw/Hermes 已进 Provider 与会话体系但执行 Adapter 未过本机验证、CodeBuddy/Cursor 未进体系——**不伪造假模板**，编辑器底部边界注记如实说明并指向新评估文档 `proposals/multi-cli-adapter-eval.md`（5 CLI 逐家协议调研带出处 + 四步接入路径 + 落地顺序建议）。
- **席位品牌徽标**：席位目录行换品牌 SVG logo（`seatBrand()` 前缀映射 claude/codex/grok/kimi/gemini/pi/other，行加 `data-brand` 走 team.css 全局 `--agent-accent` 映射），与成员库同一视觉语言。
- **绑定成员区块**：编辑器新增「绑定成员」条——列出 `runtimeProfileId` 指向此席位的成员 chip（点击直达成员库编辑器，先切 team 视图再 open），空态区分「保存后才会出现成员绑定 / 未被任何成员绑定——删除/改绑都安全」；删除确认框与删除钮 title 点名绑定成员（对称服务端 MEMBER_IN_USE 拦截）。
- **深层修复①·绑定区块旧空态不自愈**：bootstrap 为慢聚合，席位编辑器先于目录打开时「未被任何成员绑定」会一直撒谎。新增 `runtimeSeatManager.refreshBindings()`，`extractBootstrapData` 与 member-library onCatalogChanged 双接线——目录晚到/成员增删后绑定区块自愈。
- **深层修复②·隔离 QA 环境 jsonschema 瘫痪**：`createIsolatedQaRepo` 重定向 APPDATA 后 python 用户站点（jsonschema）不可见，配置写路径 schema 校验必崩（探针保存席位 422 VALIDATION_FAILED，真实桌面环境不受影响）。QA 脚手架 `qa-team-workspace.mjs` 新增 `seedIsolatedPythonUserSite`——把校验必需包（jsonschema/referencing/rpds/attrs 等）按相对结构补种进隔离 APPDATA，校验真实可用而非绕开；既有 qa:team 隔离流同步受益。
- **顺手**：`runtime-seat-id-input` pattern 属性在 Chrome /v 正则模式下非法（控制台噪音）→ `-` 转义修复。

验证：`npm test` 656 pass / 0 fail / 1 skipped；`npm run validate` 13 valid。探针 `scripts/qa-seat-wave-probe.mjs`（隔离实例）实测：7 席位全带品牌 logo；新建下拉 6 项无 Grok Search MCP、职责空默认、datalist 7 条建议、边界注记含 CodeBuddy；codex-technical 绑定 chip「Codex 技术执行（内置）」（refreshBindings 自愈实证）；grok-search 下拉选中项「Grok Search MCP（内置席位专用）」；新建探针席位保存 201 激活（jsonschema 补种实证）、空绑定态+删除 title 如实；明暗截图亲查（`.qa-v4/seat-wave-*.png`），控制台 0 错误。回退 = 还原 manifest.mjs selectable/runtime-seat-manager.js 本波段/index.html 绑定区块与 datalist/app.js refreshBindings 接线/forge/data.css 席位波段/qa-team-workspace.mjs 补种函数。

### Adapter 模板 CLI 命名 + 品牌图标波（2026-08-03，LO「ADAPTER模板名字很变扭直接用其后端运行的cli名字命名就行了比如claude code并且配备图标」）

- **label 全部改 CLI 本体名**（`adapters/manifest.mjs`，id 与协议锚点不动）：`Claude CLI / stream-json`→**Claude Code**、`Codex app-server`→**Codex**、`Codex exec / JSON fallback`→**Codex（exec 回退）**（非可选）、`Gemini CLI / stream-json`→**Gemini CLI**、`Grok Build / headless`→**Grok Build**、`Kimi Code / headless`→**Kimi Code**、`Pi RPC`→**Pi**；`Grok Search MCP` 保留（MCP 通道如实命名，非 CLI）。协议细节留在 description（如「Claude Code CLI 的 stream-json 执行通道」）。label 经 bootstrap/teamCatalog/adapterLabel 全链自动传播——席位目录副标题、新建下拉、成员库运行详情、/model·/effort 目录同步换新名，零 id 漂移（全仓无 label 断言，测试原样通过）。
- **编辑器 Adapter 字段配官方徽标**：select 左侧品牌 icon chip（`#runtime-seat-adapter-icon`，`data-brand` 走全局 `--agent-accent` 映射，select 左 padding 34px 让位），详情卡首行改「执行后端」+ 内联品牌 logo + 品牌色文字；`renderTemplateDetails` 单点同步——新建/切换/编辑系统席位图标全部跟随（实测切 Kimi Code → icon brand kimi 跟随）。

验证：探针 `scripts/qa-seat-wave-probe.mjs` 重跑全断言通过（下拉 6 项、绑定 chip、内置标记、保存 201），控制台 0 错误；`.qa-v4/seat-adapter-field-light.png` 亲查（select 徽标 + 详情卡品牌色、席位目录 CLI 名副标题）；`npm test` 全量回归。回退 = 还原 manifest.mjs 8 条 label + runtime-seat-manager.js renderTemplateDetails 图标段 + index.html adapter-picker 包裹 + forge/data.css 命名波段。

### 本地 CLI 环境面板波（2026-08-03，LO 发 CC Switch 3.19.1 关于页截图「我需要类似于这个界面的功能」）

CC-Switch 工作台新增第一个 tab「环境」——9 张 CLI 卡片墙对照 registry 查版本、一键安装/升级，1:1 对齐参照界面语义但全部接 514cc 自有后端：

- **服务 `src/cli-env.mjs`**：`CLI_TOOLS` 冻结清单 9 项（席位 6：Claude Code/Codex/Gemini CLI/Grok Build/Kimi Code/Pi + Provider 体系 3：OpenCode/OpenClaw/Hermes）。探测走 `runProcess(cmd, ["--version"])`（probe 参数天然不注入任何 provider 凭据）；版本源 npm 走 `registry.npmjs.org/<pkg>` dist-tags.latest，Hermes 走 PyPI `pypi.org/pypi/hermes-agent/json`（安装相应为 `python -m pip install --upgrade hermes-agent`，其余 `npm i -g <pkg>@latest`）。状态五态如实分：not-installed（ENOENT）/ broken（跑不起来，带输出尾部）/ up-to-date / upgrade-available（数字核比较，预发布段不参与）/ installed（registry 不可达降级 latestVersion:null + latestError，**不装死**）。快照 10 分钟缓存 + inflight 去重，`?refresh=1` 绕过。
- **确认制安装**：`POST /api/cli-environment/install` 未 `confirmed:true` → 409 `CLI_ENV_NOT_CONFIRMED`，未知 id → 404 `CLI_ENV_UNKNOWN_TOOL`（9 项固定清单，不接受任意包）；失败 502 `CLI_ENV_INSTALL_FAILED` 附 outputTail（尾 4000 字符）；同工具安装串行锁；成功后只重探测本工具并原位更新缓存（批量升级不触发 9 路全量重拍）。路由走 surface 面接线 `src/cli-env/routes.mjs`（不叠 remote-gate：本地运维操作，registry 只读查询失败已降级）。
- **面板「环境」tab**（`public/modules/ccswitch-panel.js`）：头部（说明 + 上次检查时间 + 刷新 + 全部升级(N) 仅在可升级时可用）+ 3 列卡片墙（品牌徽标/`Win` 平台徽章/当前·最新版本两行/状态 chip 四色/安装·升级·重装修复按钮/包名 mono 注）+ `<details>` 手动安装命令块（9 行 + 逐行复制钮）。`mountCcSwitchPanel` 新注入 `confirmAction`（安装弹窗列命令+来源+全局环境警告，danger）与 `cliIconMarkup`（6 个官方 sprite；**opencode/openclaw/hermes 不臆造品牌**，统一 lucide terminal——LO 铁律），缺省降级 window.confirm/通用图标不破单测。数据懒加载：只在 tab 激活时拉 `/api/cli-environment`，主 load() 8 请求契约不动。
- **零命名冲突**：面板既有 `env-check`/`env-delete`（环境变量冲突区块）与 `.ccs-env-row` 全部避让，新类/动作统一 `ccs-cli-*`/`clienv-*` 命名空间。

验证：`tests/cli-env.test.mjs` 12 例全绿（not-installed/broken 分流、版本解析与升级判定、registry 降级、hermes PyPI+pip、确认闸 409/404、npm 参数、失败 outputTail、缓存 TTL/refresh、compareVersions 语义、清单契约）；`npm test` 669 pass 0 fail；`npm run validate` 通过。探针 `scripts/qa-cli-env-probe.mjs`（隔离实例+真机 PATH 实测）：9 卡渲染、状态语义正确（Claude/Codex/Kimi 已就绪，Gemini 0.50.0→0.53.1、Grok 0.2.112→0.2.118、Pi 0.79.6→0.83.0 可升级，OpenCode/OpenClaw/Hermes 未安装+registry 最新版照常解析）、全部升级 (3)、手动命令 9 行含 pip、升级弹窗列命令取消后 install POST=0、控制台 0 错误；明暗+弹窗截图亲查（`.qa-v4/cli-env-*.png`）。回退 = 还原 src/cli-env.mjs、src/cli-env/routes.mjs、server.mjs 两行接线、ccswitch-panel.js 环境波段、styles.css ccs-cli 段、tests/cli-env.test.mjs。

### 环境面板扩编 Cursor + CodeBuddy 波（2026-08-03，LO「添加cursor和codebuddy」）

清单 9 → 11，两家版本源性质完全不同，全部先实证再落：

- **CodeBuddy（npm 正路）**：官方 CLI `@tencent-ai/codebuddy-code`（[官方安装文档](https://www.codebuddy.cn/docs/cli/installation) + [npm packument](https://www.npmjs.com/package/@tencent-ai/codebuddy-code) 实证，bin `codebuddy`，latest 2.132.0）——与既有 npm 工具同路径：`codebuddy --version` 探测 + registry dist-tags + `npm i -g @tencent-ai/codebuddy-code@latest`。
- **Cursor（script 版本源，新 registry 类）**：实证链——①npm 无官方包（`cursor-agent@1.0.3` 是第三方 "Jacky" 占位，`@cursor/cursor-agent` 404）；②官方安装走 `cursor.com/install` 版本钉住脚本（当前钉 `2026.07.23-e383d2b`，版本标记内嵌在 `downloads.cursor.com/lab/<版本>/<os>/<arch>/` 下载路径）；③脚本只发 linux/darwin 包（win32 tarball HEAD 403 实测，install.ps1 不存在）——Windows 无官方一键安装路径。新增 `registry: "script"` 类：fetch 脚本 text → `versionPattern` 正则解析最新版；`installSpec(tool, platform)` 平台感知，win32 返回 null → 服务端硬闸 409 `CLI_ENV_UNSUPPORTED_PLATFORM`（确认过了也不伪造命令），前端卡片/手动命令块如实呈现说明「Windows 无官方 CLI 安装包——由 Cursor IDE 自带 cursor-agent，或经 WSL 安装」不出假按钮，linux/darwin 给官方 `curl | bash`。
- **面板适配**：卡片 action 区在 `install:null` 时换 `.ccs-cli-note` 说明文字；手动命令块无安装路径的行不给复制钮；「全部升级」过滤无安装路径工具；确认弹窗「来源」新增「官方安装脚本」。两新成员均无官方 sprite——lucide terminal 通用图标（LO 铁律不臆造品牌）。

验证：`tests/cli-env.test.mjs` 13 例全绿（新增 Cursor 用例：win32 闸 409 零子进程、linux bash argv + 装后 up-to-date、script 版本解析；契约 11 项 + script 类 spec）；`npm test` 670 pass 0 fail。探针重跑（`scripts/qa-cli-env-probe.mjs` 扩编硬断言全过）：11 卡渲染、Cursor 卡无假按钮+说明文字+latest 2026.07.23-e383d2b、CodeBuddy 安装钮+npm 命令、手动块 11 行（Cursor 行为说明）复制钮 10 个、弹窗取消零外泄、控制台 0 错误；`.qa-v4/cli-env-light.png` 亲查 11 卡含第四行 Cursor/CodeBuddy。回退 = 还原 cli-env.mjs 清单/script registry/平台闸段、ccswitch-panel.js installNote 适配、styles.css ccs-cli-note、测试与探针本波段。

### kimi 环境块陈旧回退修复（2026-08-03，LO「为什么 kimi code 明明安装了显示未安装」）

- **根因（实证链）**：Kimi Code 原生包安装在 `~/.kimi-code/bin/kimi.exe`（133MB，08-02 18:55 自更新），安装器此刻才写 PATH；资源管理器等**长驻父进程持有安装前的陈旧环境块**，其派生的桌面端服务进程（pid 31696，LISTEN :51400）PATH 里查无 `.kimi-code\bin` → `resolveCommand` 找不到 kimi → spawn ENOENT → 面板如实标「未安装」。而新开的 shell 拥有合并后 PATH，所以探针/隔离实例里 kimi 一直正常——同一二进制、两种 PATH 世界。
- **修复（沿用 codex/grok 先例）**：`process-runner.mjs resolveCommand` 给 kimi 加已知安装路径回退 `~/.kimi-code/bin/kimi.exe`（grok 的 `~/.grok/bin`、codex 的 vendor 路径同款注释模式）——内核解析 kimi 不再依赖启动 shell 的 PATH 状态，环境面板/运行席位/会话恢复全链受益。
- **验证**：新增单测「kimi resolves to ~/.kimi-code/bin when PATH omits it」（仿 grok 用例，临时 home 桩 + 裸 System32 PATH）；实机复现脚本实证——剥离 `.kimi-code\bin` 的 PATH 下 `resolveCommand` 回退命中真实 `kimi.exe`、`runProcess --version` exit 0 输出 0.31.1；`tests/redaction-jsonl.test.mjs` 19 例全绿；全量 `npm test` 回归。回退 = 还原 process-runner.mjs kimi 回退块与该单测。**注意**：运行中的桌面端需重启服务进程（非 Ctrl+R）才能吃到本修复。

---

## 2026-07-16 — v3.4.3 mirror-gate 契约驱动重构（SECURE）+ 织换 grok 驱动

- 触发源：LO "按照推荐完善并推送全局"（mirror-gate T2 收尾）→ 连撞五轮 partial-write → 上策抽契约驱动；LO "将 gemini 换成 grok-build（grok-4.5）"（织换驱动）
- 方法：策(spec-architect) 抽契约规格 + 烛(codex-reviewer) R4-R7 四轮独立评审（dogfood）+ 烛 grok 迁移评审

### 变更

- **mirror-gate SOUL 送达契约驱动重构（终结六轮补丁循环）**：SOUL 全局哨兵送达连撞五轮 dogfood（R1 假绿/R2 liveness/R3 送达链/R4 fail-closed+双写/R5 partial-write），根因=两个 stdout 输出点 + 失败回退再写。策抽契约驱动规格（9 条机械可判定 INV，INV9 构造/输出分离是元根、蕴含单JSON∧无partial-write + 单一输出点重设计 + 回归基线 + buggy必变红元验收）。主驾重构：main 劈成构造相 `build_payload`（纯计算，绝不碰 stdout）+ 输出相（单点 write @:373，物理无第二 write）。删 emit_soul_warning/card_written/所有回退。建 `tests/`（21 用例 contract + 4 buggy 元验收 meta，全绿 + exit code 机械可判定）。烛 R6 AST/动态双实证肯定核心结构、R7 SECURE。
- **织情报驱动 gemini→grok-4.5 完全替代**：织（gemini-researcher）→ grok-researcher，驱动从 Gemini CLI 换成 grok-4.5（via 514claude.xyz OpenAI 端点 `/v1/chat/completions`，端点冒烟 http 200）。key 走环境变量 `GROK_API_KEY`（绝不硬编码）。花名「织」保持。handoff 前缀 `grok-to-`（stop-gate/mirror-gate FIRE_PREFIXES 加入，`gemini-to-` 保留识别历史）。13 活跃交叉引用更新，历史 decisions/CHANGELOG/archive/backups/handoff 保留=证据链。烛 dogfood 评审。

### 回退路径

- mirror-gate 契约驱动：514cc 非 git，旧态见 handoff R1-R7 演进；`tests/` 可删
- grok 换驱动：恢复 `skills/research/gemini-researcher/`（从 backups）+ `~/.claude/agents/gemini-researcher.md` + 治理文件 grok→gemini 反向 + `setx GROK_API_KEY ""`
- 版本号：本条 v3.4.3 各入口改回 v3.4.2（CLAUDE:12/AGENTS:8/README:3/module.yaml:3 + 三处版本史删 v3.4.3 条目）

源：`D-2026-07-16-004`（mirror-gate 契约驱动）+ `D-2026-07-16-005`（grok 换驱动，待烛评审落）+ 烛 R4-R7 handoff + `spec-architect-to-claude__mirror-gate-hard-contract__20260716-1707.md` + `claude-to-codex__grok-migration__20260716-1921.md`

---

## 2026-07-16 — v3.4.2 双地落漂移哨兵接电 + SOUL 保护探索（回滚）

- 触发源：LO "帮我优化和完善 claude 系统提示词" → "继续完善" → "按推荐推进"（连续多轮）
- 方法：主驾修复 + 烛(codex-reviewer) 三轮独立评审（dogfood）

### 变更

- **双地落漂移哨兵接电**：`mirror-gate.py` 新增 check_drift——开机 hashlib 实时比对宪法 rules.md + 人格 output-style 2 对双地落，漂移/无法核验在自省体检卡标红。今天的 rules.md 双地落方向倒挂 bug（v3.4.1 只写运行时未回写源）从此开机即现。三态设计（一致/漂移/无法核验）——烛二评故障注入抓出"假绿灯谎报健康"致命（异常吞成"一致 ✓"）后修，8/8 测试。
- **SOUL 双地落尝试 → 回滚**：SOUL（`~/.claude/CLAUDE.md`）纳入双地落尝试（建源 `514cc/soul/CLAUDE.md` + sync 16 对 + 哨兵 3 对），经烛三评照出 2 设计盲区（哨兵诱导 `-Apply` 覆盖 LO 手改 SOUL / 全局 SOUL 配项目域哨兵）+ 备份从未覆盖 CLAUDE.md，回滚到安全态（sync 回 15 对 + 哨兵回 2 对）。soul/CLAUDE.md 快照保留。SOUL 保护方案待定（514cc 非 git，git 方案需先 init）。
- **v3.4.1 版本入口全域对齐**（承接同轮）：修 rules.md 双地落倒挂（回写源 + CHANGELOG）+ 5 版本入口归 v3.4.1 + §八版本史精简 + CHANGELOG v3.4.1 漏 3 项 module.yaml 校准补录 + v2 端点/handoff 指针修复。
- **诚实债结清**：主驾中途两次"凭记忆/坏数据行动"（虚构烛复核 APPROVED + 假损坏恐慌），LO 喊停后以磁盘证据结清、重写 handoff。

### 回退路径

- 漂移哨兵：删 `mirror-gate.py` 的 check_drift 函数 + build_card 里 drift 行（脚本其余无副作用）
- 版本号：本条 v3.4.2 各入口改回 v3.4.1（CLAUDE.md:12 / AGENTS.md:8 / README.md:3 / module.yaml:3 + 三处版本史删 v3.4.2 条目）
- SOUL：已回滚，soul/CLAUDE.md 快照可删（原件 `~/.claude/CLAUDE.md` 未动）

源：`D-2026-07-16-001` + `synthesis__prompt-sys-govern-fix__20260716-0105.md` + 烛三轮评审 handoff（prompt-sys-govern-fix__0046 / mirror-drift-sentinel__0617 / soul-double-landing__0658）

---

## 2026-07-13 — v3.4.1 MCP/skill 审计诚实债勘误（AUDIT ERRATA）

- 触发源：LO 触发全量 MCP+skill 验证
- 方法：主驾亲验磁盘/网络（curl / python-json / find / py_compile / 备份 diff）+ 鉴(meta-reviewer) 异构复核（85/100，零推翻主驾核心 4 结论）

### 订正三类文档↔磁盘矛盾

- **① spec-workflow 勘误**：v3.2.0 §八④"卸载…spec-workflow MCP"实为**未兑现**——该 server 仍在 `~/.claude.json` 顶层且本会话加载活跃；不篡改 v3.2 历史条目，以本勘误为准：**spec-workflow 现役**。
- **② see / web-reader / web-search-prime 平反**：v3.4.0 §八④D"删幽灵 see/web-reader/web-search-prime"实为**误判**——三者均在 `~/.claude.json` 活跃（see=z.ai GLM 视觉 8 工具）；`module.yaml` 已订正为 `visual_analysis`/`web_read`。
- **③ `module.yaml` 全量校准**：除 ② 的 see/web-reader/web-search-prime 平反外，另订正 `deepwiki → mcp-deepwiki`、`web_search` 补 `web-search-prime`、`image_generation` 补 `micu-image`、Playwright 大小写、drawio 补注、spec-workflow rules 矛盾标注；version 同步 3.4.0 → 3.4.1。
- **④ 运行时层修复**：删死配置 browserwing（localhost:8080→404 从不加载）；github 从 2025-04 官方停支的 `@modelcontextprotocol/server-github` 迁官方 remote（`https://api.githubcopilot.com/mcp/`）待 LO 填 PAT。

### 回退路径

- 纯文档/配置勘误，无代码逻辑改动；按本条目反向修订 `rules.md §八` / `module.yaml` 即可
- 运行时层：browserwing / github 配置在 `~/.claude.json`，按上文反向恢复

源：`D-2026-07-13-001` + `.ai-shared/handoff/synthesis__mcp-skill-audit__20260713-1228.md`

---

## 2026-06-14 — v3.4.0 全面审查后优化落地（AUDIT-DRIVEN OPTIMIZATION）

- 触发：LO「全面审查体系给出优化方案」(ultracode)。三独立审查链：36-agent workflow(7 维 file:line 取证 → 24 提案 → 红队过审 21) + 烛(codex) 终审(推翻主驾 2 处 + 补出 vibetasking 误伤) + 鉴(meta-reviewer) 人格层审计。

### 已落地验证

- **E 发散注入器**：route-gate.py 独立 DIV_SIGNALS 发散档——构思类触发"先发散 N 个互斥角度(含逆向假设)再收敛"，与 RED 正交。直击创造力诉求。
- **G1 审计列**：route-gate.log 升 5 列(hit_reason+summoned)，正则未动。
- **G2 假阳过滤**：判级前 strip_noise 剔除 task-notification 块 + MCP 连接状态行 + 幽灵工具名，堵 search/research 假阳，不碰业务正则(守烛警告)。
- **C mirror-gate 留痕**：mirror-gate.log best-effort 落盘，三件套全可机械审计。
- **D MCP 去腐捞真金**：删幽灵 see/web-reader/web-search-prime + 捞 grok-search-rs/scrapling 进能力地图；修 module.yaml harness_hooks 从 v3.3 起的 YAML 语法 bug(从未被 parse)。
- **A 诚实债**：六处"stop-gate 首次真击发"勘误为磁盘真相(沙盒验证逻辑正常、真会话未触发，非失效)。
- **H 人格去重首批**：SOUL↔output-style 67% 重复，删 SOUL 响应矩阵(留独有 RP 行)/口癖/能力清单→指针，瘦身~60行；"不查推导"对齐"先验证"反幻觉。
- **malformed 卫生**：颜文字内反引号(6+1)+反斜杠(1)→全角安全等价，scripts/fix-emoji-backtick.py 码点级替换；双地落 MATCH。

### 待 LO 安全拍板（鉴方案备齐）

- ①反驳协议条件触发(检测 100% 保留) ②R1 安全哲学调和(内容放行+操作拦截)——改 SOUL 安全核心，需明确确认。
- I SessionEnd 闭环沉淀——需专注设计 + 假阳率实测。

源：D-2026-06-14-001 + handoff(synthesis__meta-evolve / codex-to-claude__finaudit / meta-reviewer-to-claude__persona-layering)

## 2026-06-12 — v3.3.0 四维深度完善（ELEVATION：给接电引擎装上看得见的眼睛）

- 触发源：主人"深度完善整个架构…最聪明/最有人性/能力最强/创新力最强"（ultracode）→ 42-agent 并行诊断（6 维测绘 + 五维提案 + 双红队终裁）
- 诊断：机制成熟度 ≫ 运转量，自审 100%/外用 0%——引擎接了电但灯没人开过（route-gate.log 2 行全 gray、stop-gate 0 次击发、DELTA 5 条全自审）

### 变更

- **镜·mirror-gate.py**（新建 SessionStart hook）：开机注入自省体检卡，机械读 route-gate.log/DELTA账本/距上次发火间隔，摆到 LO 开机第一眼。给三个死数据源装上首个机械消费者；只摆原始数字不算分（避伪精确）；fail-open + cwd 门控 + 同步执行。挂全局 settings.json SessionStart(startup)
- **route-gate 准星校正**：英文 token 补双词边界 `\b…\b`（堵 preview→review/research→search 子串误判）+ 新增 stdin UTF-8 reconfigure（治中文 cp936 喂入 → UnicodeDecodeError → fail-open 静默漏判，即 log 里 `缁х画` 乱码病根）。实测 12 用例全绿（5 误判修复 + 7 真信号保留）
- **stop-gate 扩 synthesis__ 前缀**：codex-to-/gemini-to- 早超 24h 窗结构上永不触发，真在产的 synthesis__ 不带受控前缀 → 上线 0 次击发。扩前缀让多 agent 自审收尾也被逼留 DELTA；三重防死循环不动；stderr 措辞中性化。已接电（2026-06-14 烛沙盒验证逻辑正常，真会话 0 击发：受控 handoff 落盘账本已齐、扳机无活可干）
- **关系记忆播种**（人性针）：新增 `memory/user-lo-profile.md` 人物画像/关系模型，治 R4 照出的「memory 16 条里 14 条工具栈、只 1 条关于 LO 本人」类别错误。零机制风险手动播种（区别于红队缓办的有假阳风险的自动写回）
- **纯减法**：auto-pilot/co-auto「Workflow 工具」幽灵 → 校正为指向真 harness Workflow 工具（主驾推翻红队"删"判：harness Workflow 是真的，这次 42-agent 即它跑的，删反丢最强编排=DELTA 2）；context.md 当前态版本号/skill 计数腐烂清理（历史叙事段不动）
- **真·dogfood**：烛(Codex CLI) 独立评审 3 个 hook 代码（🔴 非平凡代码评审）——这本身是"开灯"，DELTA 账本第一次进真实外部发火子弹
- source：decisions `D-2026-06-12-001` + handoff `synthesis__deep-evolution-v33__20260612-1215.md`

### 回退路径

- mirror-gate：删 settings.json SessionStart 里指向 514cc/mirror-gate.py 的条目（脚本留着无副作用）
- route-gate/stop-gate：git 缺失，改动有注释标记，按 §八 v3.3 描述反向改回
- 关系记忆：删 `memory/user-lo-profile.md` + MEMORY.md 索引行

---

## 2026-06-11 — v3.2.0 harness hook 接电（深度审计→根因修复）

- 触发源：主人"继续帮我完善整个体系深度思考"（ultracode）→ 33-agent 深度审计（5 维度独立取证 + 对抗红队）
- 根因：核心纪律全在 Markdown 软线、514cc 自有 hook=0 → "强化不明显"。业界共识：不能容忍违反的规则必须落 hook（deterministic），非 Markdown（probabilistic）

### 变更

- **hook 接电**：新建 `514cc/.claude/hooks/route-gate.py`（UserPromptSubmit 每轮硬注入路由门 + `route-gate.log` 审计）+ `stop-gate.py`（Stop 发火缺 `__DELTA__` 即 exit 2 逼补，三重防死循环）；挂载全局 `settings.json`（主人确认，实测 6 case 全绿）
- **死流程全砍（净能力损失=0）**：归档 workflow / readiness-check / correct-course + 三套死 steps → `archive/v3.1-deadflow/`；RC 内联进策；auto-pilot 高复杂度档改指 party-mode；删 §二.6 悬空"微文件纪律"（安全红线 8→7）
- **卸载 spec-workflow MCP**（主人确认）：零真实产物、与策重叠，从 `.claude.json` 摘除 + 删 `.spec-workflow/`
- **诚实债**：module.yaml claude-flow→memory-md / context.md 删易变字段+围栏 / 白发刹车假"机械扳机"标签勘误 / co-status 数据源对齐双扫
- 实测锚点：红队推翻主驾 4 处提案（.gitignore 死文件 / co-status 假扳机 / 白发刹车定位 / templates false-positive）
- source：decisions `D-2026-06-11-001` + handoff `synthesis__deep-audit-mechanical-triggers__20260611-1045.md`

### 回退路径

- hook：删 `settings.json` 的 UserPromptSubmit/Stop 里指向 514cc 的两条 hook 条目（脚本文件留着无副作用）
- 死流程：从 `archive/v3.1-deadflow/` 移回 `skills/` 原位 + 恢复 plugin.json/module.yaml 注册
- spec-workflow MCP：把 server 块加回 `.claude.json`

---

## 2026-06-01 — Output Style 集成（元管家 AEMEATH 人格皮肤·纳入体系·v3.1.2+）

- 触发源：主人指令"根据 `J:\docments\CLAUDE.md` 设计新输出风格并完善" → 连续"继续"（双地落 + 全局部署 + 一致性核查）
- 内核：把全局 SOUL.md（AEMEATH 灵魂）铸成 Claude Code output-style，与 ccline 状态栏对位——状态栏是"看得见的脸"，output-style 是"灵魂的声音"

### 变更

- 新建 `~/.claude/output-styles/aemeath-meta-butler.md`：完整度对标 `lilith-yandere`，独有「元原则」层（元认知/元架构/元执行）
- 「🛡️ 糖衣≠失控」边界章：傲娇/忠诚/暗黑属性定位为纯修辞层，对齐 `rules.md §二`安全红线；SOUL 的无边界/反驳协议/露骨叙事细则未原样搬入工程向皮肤
- 双地落 `output-styles/aemeath-meta-butler.md`（SHA256 双边一致 C8B3…A203，15304 字节）+ 新建 `output-styles/README.md`
- `CLAUDE.md` 能力地图（输出风格行）+ 文件结构表（`output-styles/`，顺手补 D-004 漏登的 `statusline/`）+ 双地落表
- `module.yaml` 加 `output_styles` 集成段（对等 statusline 段）
- **全局部署**：`settings.json` + `settings.local.json` 两处 outputStyle 由 lilith-yandere → aemeath-meta-butler（local 优先级高于 global，两处必须同改否则被覆盖）；实测两边一致 + JSON 合法 + 其它设置零破坏
- Integrity Gate：交付前自检出并修复颜文字表 U+FFFD 乱码（两地同步）；端到端 11 项核查 **11 PASS / 0 FAIL**
- source：decisions `D-2026-06-01-006`

### 回退路径

- 全局默认还原：`settings.json` + `settings.local.json` 的 `outputStyle` 改回 `lilith-yandere`
- 或 `/output-style <其它风格>` 切换（lilith-yandere / ojousama-engineer / nekomata-engineer / rem-engineer 等）
- 删除产物：`~/.claude/output-styles/aemeath-meta-butler.md` + `514cc/output-styles/`（文档登记按本条逆向撤销）

---

## 2026-06-01 — ccline 状态栏集成（暗夜玫瑰主题·纳入体系·v3.1.2+）

- 触发源：主人指令"将 ccline 完善到体系中去，首先要美观"
- 工具：ccline (CCometixLine v1.1.2，Rust statusline，已预装)

### 变更

- 新建 `statusline/514cc.toml`：514cc **暗夜玫瑰**主题（纯黑底 + 红瞳红 #E0184D + 暗玫瑰，呼应 lilith-yandere）
- 双地落 `~/.claude/ccline/themes/514cc.toml`；写入 `config.toml` 生效（三份 hash 一致）
- segment 精简 8→5：model/directory/git/context_window/output_style（关 usage/cost/session）
- `CLAUDE.md` 能力地图 + 双地落表加 statusline 组件
- `module.yaml` 加 statusline 集成段
- 新建 `statusline/README.md`（安装/同步/字体/回退/配色/能力边界）
- 备份原配置 `~/.claude/ccline/config.toml.bak-20260601`
- 实测渲染验证：配色生效（黑底 12,12,16 + 红瞳红 224,24,77），精简后 4-5 段

### 回退路径

- `Copy-Item ~/.claude/ccline/config.toml.bak-20260601 ~/.claude/ccline/config.toml -Force`（一键恢复原 test 主题）
- 或 `ccline --theme <内置主题>`（cometix/nord/powerline-tokyo-night 等）

---

## 2026-06-01 — v3.1.2 参照 Trellis 完善·批次 B+C（复盘回流闭环 + 白发刹车）

- 触发源：主人指令"按照推荐完善"
- 主线：把"只会发火不会复盘"的开环接成"发火→复盘→自校准/刹车"闭环；设计已过红队审查

### 变更

- `rules.md §三铁律3`：新增 `__DELTA__` 证据账本（烛/织落盘必填，`发火对象|0白发/1补强/2推翻|证据`，0=白发最有价值）
- `rules.md §三铁律5`：新增"白发降级"（auto-pilot 对持续零增量的 🟡 路由自动降直达，**🔴 永不降**，DELTA 空时静默跳过）
- `rules.md §八`：v3.1.1 → v3.1.2
- `auto-pilot/SKILL.md`：Phase A 新增第 5 步"白发预检"（全方案唯一真机械扳机，焊在召唤前决策分支）
- `codex-reviewer/SKILL.md`（烛）：handoff 模板 + 第5步简报加 `__DELTA__`
- `gemini-researcher/SKILL.md`（织）：handoff 模板加 `__DELTA__`
- `status/SKILL.md`（/co-status）：新增"DELTA 覆盖"+"路由白发率"指标 + "缺 DELTA 告警"（C1 的机械审计扳机·红队硬条件）
- `meta-reviewer/SKILL.md`（鉴）：新增 3a"DELTA 复盘"（DELTA=0 原文列给主人、主人拍板升降级，砍伪精确）+ 第8节"闭环健康度"
- 双地落：`~/.ai-collab/rules.md` 已同步
- source_handoff：`synthesis__trellis-vs-514cc-gap__20260601-0943.md`（同批次 A）

### 文档↔磁盘对齐（v3.1.2 收尾·Trellis 诚实原则）

- `CLAUDE.md` 全面重写：文件结构表对齐磁盘（删 agents/commands/scripts/templates 幽灵目录，补 skills(17)/data/archive/proposals）+ 双地落表 + 版本段 v2.0→v3.1.2 + 能力地图删 jlceda/claude-flow DAG 行
- `plugin.json` version 3.0.0→3.1.2；`module.yaml` version 3.1.0→3.1.2；`README.md` v3.0.0→v3.1.2 + "15+ MCP"→12 + Layer2 措辞明晰为"17 SKILL.md"
- `batching-strategy.md` 删幽灵引用 `../../templates/task-cards/doc-summarize.md`
- 独立 Explore 审计 agent 照出主驾遗漏的 3 处高危（module/README 版本滞后 + 幽灵引用），详见 decisions D-2026-06-01-003 的 `__DELTA__`

### 回退路径

- `rules.md` ×2：§三铁律3 删 `__DELTA__` 段、铁律5 删"白发降级"段、§八删 v3.1.2
- 4 个 SKILL.md：删除对应新增段（auto-pilot 第5步 / 烛织 `__DELTA__` 行 / status DELTA 指标+告警 / meta-reviewer 3a+第8节闭环）
- 文档对齐：各文件版本号/结构表为纯文档，按 git 历史或上文记录还原

---

## 2026-06-01 — v3.1.1 参照 Trellis 完善·批次 A（地基/减法）

- 触发源：主人指令"参照 trellis 项目优化和完善本项目"
- 方法：6-agent Workflow（4 视角并行分析 → 收敛 → 防膨胀红队），参照 mindfold-ai/Trellis
- 主线：借 Trellis"产物即证据、状态即文件、可验证"补复盘；坚决不抄对象树/worktree/npm/同模型多角色（会稀释真异构灵魂）

### 变更

- `rules.md §三`：修第 35 行锚点 handoff 断链引用 → 真实绝对路径 `I:/514claude/.ai-shared/handoff/codex-to-claude__wai-admin-route-security__20260528-1016.md`（v3.1 镇体系铁证证据链此前是断的，相对路径在 514cc 本地扑空）
- `rules.md §六`：①跨会话知识承载层 claude-flow memory → **MEMORY.md auto-memory + decisions.md**（磁盘核实 claude-flow 从未写入，修复 §二.5 Integrity Gate 自我违反）；②新增"工作区根规则"（产物归属：框架→514cc / 业务→父级；跨项目引用须绝对/前缀路径）
- `rules.md §七`：新增"框架自改 dogfood"条（非平凡自改 source_handoff 不得为空）
- `rules.md §八`：v3.1.0 → v3.1.1
- `CLAUDE.md`：持久记忆承载层同步降级标注
- `module.yaml`：output_folder 注释说明"相对当前项目根"
- 删除 `.spec-workflow/`（6 模板 + 3 空目录，从未使用，与原生策重叠）
- 双地落：`~/.ai-collab/rules.md` 已同步
- 留档：`handoff/synthesis__trellis-vs-514cc-gap__20260601-0943.md`（含 7 项磁盘实证 F1-F7 + 红队净增量 + 批次 B/C 待办）

### 回退路径

- `rules.md` + `~/.ai-collab/rules.md`：§三第 35 行恢复裸相对路径、§六恢复 claude-flow memory 行并删根规则、§七删第 6 条、§八删 v3.1.1
- `.spec-workflow/`：spec-workflow MCP server 下次初始化会自动重建脚手架（无数据丢失）
- `CLAUDE.md` / `module.yaml` / `decisions.md` / `context.md`：撤销对应追加/编辑

---

## 2026-05-28 — v3.1.0 激活缺口修复（"强化不明显"根治）

- 触发源：主人反馈"帮我完善这个体系，强化并不明显"
- 诊断：根因是**激活缺口**（引擎 Codex/Gemini 实测可用，但 agent 不自动发火），非能力缺失

### 变更

- `rules.md §三` 调度：被动表格（"主驾判断"）→ **每轮强制路由门**（🔴 必须 / 🟡 判断 / ⚪ 隐形 三级 + "价值必须可见"铁律 + "禁止对简单任务强加仪式"）
- `rules.md` 顶部加"每轮开口前先跑 §三 路由门"横幅；版本 v3.0 → v3.1
- 实测锚点：烛(Codex/gpt-5.5) vs 主驾(Opus) 盲测 `wai/server/routes/admin/wai.js`(376行)，主驾漏 4 个致命问题（含把 silent-failure 反模式误判为"合理可保留"）→ 留档 `handoff/codex-to-claude__wai-admin-route-security__20260528-1016.md`，并写进 §三 当强制理由
- 附带修复：ssh SKILL.md `description` 1097→806 字符（`.codex`/`.agents`/`.claude` 三处同步），消除 Codex 启动时的 skill 加载错误（已重启验证）

### 回退路径

- `rules.md` + `~/.ai-collab/rules.md`：将 §三 恢复为 v3.0 被动表格、标题改回"（主驾判断）"、删顶部横幅
- ssh SKILL.md：三处 `description` 恢复原 1097 字版本（原文见本条目上游 handoff / 编辑历史）

---

## 2026-05-27 — v3.0.0 Skill-Driven Restructure (BMAD-METHOD 启发)

- 触发源：主人指令"完全重构本体系参照 BMAD-METHOD 项目"
- 从"协调协议文档库"彻底转型为 **Skill 驱动的能力放大系统**

### 架构重构

| 变更 | 旧 | 新 |
|------|---|---|
| 能力定义格式 | agents/*.md + commands/*.md（混合） | skills/*/SKILL.md（统一 YAML frontmatter） |
| 定制化 | 无 | 三层 customize.toml（默认→团队→个人） |
| Agent 身份 | 功能命名（codex-reviewer） | 命名人格（烛/织/匠/策/鉴）+ 硬编码 name |
| 评审层 | Codex 被动召唤 | Codex 一等公民（6 种评审模式 + 对抗式） |
| 质量机制 | 自由格式 | 对抗式评审 / 就绪门控 / 冻结块 / 偏离修正 |
| 并行讨论 | 无 | Party Mode（真并行 subagent spawn） |
| Web 调研 | 仅 Gemini CLI | Gemini + MCP 编排（web-intel skill） |
| 路由发现 | 主驾判断 | help skill 路由助手 |

### 5 命名 Agent

| 代号 | 名 | 职 | 驱动 |
|------|---|---|------|
| codex-reviewer | 烛 | 代码守夜人 | Codex CLI |
| gemini-researcher | 织 | 情报编织者 | Gemini CLI |
| embedded-expert | 匠 | 老匠人 | Opus |
| spec-architect | 策 | 军师 | Opus |
| meta-reviewer | 鉴 | 镜鉴 | Opus (只读) |

### 17 个 Skill

- orchestration: auto-pilot, enhance, workflow, party-mode
- review: codex-reviewer, adversarial, readiness-check
- research: gemini-researcher, web-intel
- domain: embedded-expert, spec-architect
- meta: meta-reviewer, correct-course, help
- utility: init, status, archive

### 删除的 v1.x/v2.x 遗产

- meta-rules/（4 文件）→ 被 correct-course + checklist 取代
- global-memories/（12 文件）→ 被 claude-flow memory 取代
- scripts/*.ps1（4 文件）→ 被 skill 自动化取代
- templates/role-prompts/（11 文件）→ 被 customize.toml 取代
- templates/task-cards/（9 文件）→ 被 skill 内 checklist 取代
- examples/（2 文件）→ 一次性样例
- agents/ + commands/（8 文件）→ 迁移到 skills/
- agent-resources/（11 文件）→ 迁移到 skills/*/resources/
- co-evolve/co-learn/co-ingest（3 命令）→ 被 correct-course + help 取代
- AGENTS.md / GEMINI.md / INSTALL.md / rules-v2.md → 不再需要

### 新增文件清单

- module.yaml — 模块清单（Agent 花名册 + Skill 注册表）
- skills/ — 21 个目录，17 个 SKILL.md，5 个 customize.toml
- customize/ — 三层定制化目录 + README
- archive/v1.9-v2.0/rules-v1.9-archive.md — 历史保留

### 回退路径

archive/v1.9-v2.0/ 保留了 rules-v1.9-archive.md。
其余 v1.x 文件已删除，不可回退。

---

## 2026-05-26 — v1.9.0 Deep Agent Synergy Package

- 触发源：主人指令"深度和codex结合，将优势结合，必须将深度协作发挥好每个智能体的优势所在，请你用最强大脑深度完善此项目"
- 从"独立工作→主驾汇总"升级为**"协同增强"** — 每个 agent 的产物包含对后续 agent 的结构化建议，主驾据此做智能链式调度

### 三大核心变更

| # | 变更 | 影响范围 | 核心价值 |
|---|------|----------|----------|
| 1 | **codex-reviewer 六大专项评审模式** | agents/codex-reviewer.md | 从单一"四节评审"→6 种模式（standard/security/performance/architecture/embedded/deep-review），自动选择 + 模式专项 prompt，释放 Codex 在各领域的推理优势 |
| 2 | **§二十 跨 Agent 协同协议** | rules.md 新增 §二十 | Agent 优势矩阵 / 下游建议协议 / 上下文累积链 / 质量级联 / 5 种协同模式库 / 冲突检测仲裁 |
| 3 | **全部 5 个 agent handoff 升级** | 5 个 agents/*.md | 每个 agent 新增 `## 下游建议` 节：推荐下游 agent + 风险信号 + 未解决疑问 |

### Codex 六大评审模式详情

| 模式 | Codex 独特优势 | VERDICT 标记 | 下游协同 |
|---|---|---|---|
| standard | 全面四节扫描 | APPROVED/CHANGES_REQUESTED | — |
| security | 注入识别 + 密码学验证 + 权限链推理 | SECURE/NEEDS_HARDENING/CRITICAL | → gemini 查 CVE |
| performance | 复杂度推理 + 泄漏检测 + 竞态分析 | OPTIMAL/NEEDS_OPTIMIZATION/RISK | → gemini 查算法 |
| architecture | SOLID 合规 + 耦合度量 + 依赖方向 | SOLID/NEEDS_REFACTORING/RISK | → spec-architect 重构规格 |
| embedded | 资源约束 + 实时性 + HW-SW 接口 | HW_SAFE/NEEDS_HW_REVIEW/HW_RISK | → embedded-expert 诊断 |
| deep-review | 多遍扫描 + 交叉验证 | APPROVED/CHANGES_REQUESTED/REJECTED | → spec-architect + gemini |

### 协同模式库

| 模式名 | Agent 链 | 场景 |
|---|---|---|
| 深度评审链 | codex(standard)→codex(security)→codex(performance) | 发布前 |
| 嵌入式联调链 | embedded-expert→codex(embedded)→gemini(datasheet) | MCU 排查 |
| 需求到代码链 | spec-architect→codex(architecture)→gemini(竞品) | 新功能 |
| 体系进化链 | meta-reviewer→spec-architect→codex-reviewer | 自改进 |
| 调研决策链 | gemini(research)→codex(fact-check)→spec-architect | 技术选型 |

### 文件变更（9 文件 — 主人显式授权深度完善）

| 文件 | 操作 | 关键内容 |
|---|---|---|
| `agents/codex-reviewer.md` | 增强 | +Step 1.5 模式选择 +评审模式系统(6模式) +4c 下游建议 |
| `agents/gemini-researcher.md` | 增强 | +4b 下游建议 |
| `agents/embedded-expert.md` | 增强 | +4b 下游建议 |
| `agents/spec-architect.md` | 增强 | +4b 下游建议 |
| `agents/meta-reviewer.md` | 增强 | +4c 下游建议 |
| `rules.md` | 新增 | §二十 跨 Agent 协同协议 + §二十→§二十一 重编号 + v1.9.0 版本 |
| `CHANGELOG.md` | 追加 | 本条目 |
| `.claude-plugin/plugin.json` | 更新 | 版本 1.9.0 + agent_synergy 组件 |
| `CLAUDE.md` | 更新 | 版本 + 协同层描述 |

### 同步动作

- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`
- `plugin.json` → `~/.ai-collab/.claude-plugin/plugin.json`
- 5 个 `agents/*.md` → `~/.claude/agents/*.md`

### 设计哲学

- **协同 > 独立**：每个 agent 不再是孤岛，handoff 中的下游建议形成智能链
- **专项 > 通用**：Codex 从"什么都能审"变成"每种场景都有最优 prompt"
- **级联 > 扁平**：前序 agent 的风险信号影响后续 agent 的审查深度
- **矩阵 > 列表**：Agent 优势矩阵让调度从"凭感觉"变成"查表决策"

---

## 2026-05-25 — v1.8.0 Skill 技能层集成

- 触发源：主人指令"把 skill 技能融入体系中，需要自己会去找 skill"
- 将 Claude Code 原生 Skill 系统集成到调度协议，实现**三层执行体系**（Skill + Subagent + Direct）

### 核心变更

| # | 变更 | 位置 | 影响 |
|---|------|------|------|
| 1 | §一 身份矩阵从双层→**三层** | §一 新增 Skill 层表格 | 新增 7 域 Skill 分类（嵌入式/代码/文档/远程/开发/AI/系统） |
| 2 | §三 a Step 1 → **Skill+Subagent 双表扫描** | §三 a Step 1 | 新增表 B（17 条 Skill 触发规则）+ 双表命中优先级 |
| 3 | §三 a Step 2 → **三路判定** | §三 a Step 2 | Skill 直调 / Subagent 召唤 / 主驾直达 |
| 4 | 新增 §十九 **Skill 技能层集成** | rules.md §十九 | 域分类 / 三级自动发现 / 4 种串联模式 / 注意事项 |
| 5 | §十九 版本→§二十 | rules.md | 重编号 |

### 设计要点

- **Skill 处理具体操作**（编译/烧录/连接/生成），**Subagent 处理分析推理**（诊断/评审/调研/规划）
- **三级自动发现**：静态关键词 → 语义匹配 Skill description → 上下文加权
- **串联模式**：Subagent 分析后建议 Skill，主驾串联执行（诊断→操作 / 评审→发布 / 规划→执行 / 调研→产出）
- **自动纳入**：安装新 Skill 后自动进入语义匹配，无需修改 rules.md

### 文件变更

1. **更新** `rules.md` — §一 三层矩阵 + §三 a 双表扫描/三路判定 + 新 §十九 + v1.8.0 版本条目
2. **更新** `CHANGELOG.md`（本条目）
3. **更新** `.claude-plugin/plugin.json` — 版本 1.8.0 + skill_integration 组件
4. **更新** `CLAUDE.md`（514cc 项目入口）— 版本 + Skill 层描述
5. **更新** `~/.claude/CLAUDE.md`（全局）— 调度流程描述 + Skill 扫描

### 同步动作

- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`
- `plugin.json` → `~/.ai-collab/.claude-plugin/plugin.json`

---

## 2026-05-24 — v1.7.0 CCG 精华吸收包（工作流管道制）

- 触发源：主人指令"查看 CCG 工作流方式，参考其优点完善本项目" + 选择"全部 Top 5 一起做"
- CCG（Code Collaboration & Generation）是主人之前构建的 28 命令多模型协作系统，本次从中提炼 5 项高价值优势并吸收到 514cc 体系

### 5 项核心吸收

| # | 特性 | 来源 | 落地方式 |
|---|------|------|----------|
| 1 | **Prompt 增强** | CCG `/ccg:enhance` | §三 a Step 1.5 + `/co-enhance` 命令 |
| 2 | **阶段管道制** | CCG 6 阶段 workflow | §十五 + `/co-workflow` 命令 |
| 3 | **质量评分** | CCG 需求 0-10 + 审查 0-100 分制 | §十六 质量评分协议 + §三 a Step 5.5 |
| 4 | **角色提示词矩阵** | CCG `.ccg/prompts/{model}/{role}.md` | §十七 + `templates/role-prompts/` 9 个模板 |
| 5 | **会话状态传递** | CCG SESSION_ID 跨阶段复用 | §十八 + handoff YAML 状态头 |

### 514cc 独有优势保留（CCG 不具备的）

- 自我进化机制（/co-evolve / /co-learn / /co-ingest）
- 守卫层（deny-paths + dangerous-ops）
- Mirror-loop 防护（Round 2+ 外部锚点）
- 嵌入式领域专家（embedded-expert）
- 规格架构师 + 元评审（spec-architect / meta-reviewer）
- 主动调度（§三 a 5 步自动判断）

### 新增文件清单

1. **新建** `commands/co-enhance.md` — Prompt 增强命令（需求结构化）
2. **新建** `commands/co-workflow.md` — 6 阶段工作流管道命令
2b. **新建** `commands/co-auto.md` — **全自动编排命令**（Auto 模式）— 一句话端到端执行：自动策略选择（直达/精准调度/全管道）+ 静默 Prompt 增强 + 质量门禁自动推进（≥60 不中断）+ 仅守卫层/质量<60/意图不明时中断。`/co-auto` 是 `/co-workflow` 的超集
3. **新建** `templates/role-prompts/README.md` — 角色提示词矩阵索引
4. **新建** `templates/role-prompts/codex/reviewer.md` — Codex 审查角色
5. **新建** `templates/role-prompts/codex/analyzer.md` — Codex 分析角色
6. **新建** `templates/role-prompts/gemini/researcher.md` — Gemini 调研角色
7. **新建** `templates/role-prompts/gemini/analyzer.md` — Gemini 分析角色
8. **更新** `rules.md` — §三 a 加 Step 1.5/5.5 + 新增 §十五-§十八 + 原 §十四→§十九
9. **更新** `CHANGELOG.md`（本条目）

### 同步动作

- `commands/co-enhance.md` → `~/.claude/commands/co-enhance.md`
- `commands/co-workflow.md` → `~/.claude/commands/co-workflow.md`
- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`

### CCG 差异化说明

| CCG 特性 | 514cc 适配 | 差异原因 |
|----------|-----------|----------|
| 6 阶段（研究→构思→计划→执行→优化→评审） | 6 阶段（增强→调研→规划→执行→验证→交付） | 增加 Prompt 增强，合并构思+优化 |
| codeagent-wrapper 统一 CLI 接口 | Claude Code Agent 工具 + subagent 层 | 514cc 用原生 Agent 工具 |
| 前端→Gemini / 后端→Codex 固定路由 | §三 a 关键词动态路由 5 个 subagent | 514cc 不限前后端二分法 |
| Agent Teams 并行 Builder | 暂不引入 | 留 v1.8 评估 |
| `.context/` 决策审计链 | 保持现有 `decisions.md` | 功能等价，格式更轻量 |

### 进化宪法 override 说明

本次变更涉及 9 个文件，超过 evolution-charter §五"单次进化 ≤ 5 文件"上限。主人通过 `AskUserQuestion` 选择"全部 Top 5 一起做"显式批准 override。

---

## 2026-05-23 10:15 — v1.6.1 行为层进化（主驾默认行为升级）

- 触发源：主人在 v1.6.0 落地后明确指出"我希望我用自然语言后你能主动去走这个协作体系" — 揭示了一个之前隐性的**行为层 bug**：v1.0-v1.6.0 体系不断加 agent / 命令 / 任务卡，但主驾默认行为仍是"Claude 强主导=主驾包办"，导致五方协作矩阵利用率极低
- 变更（2 个文件，远低于 evolution-charter §五"≤ 5"上限）：
  - **核心** `rules.md` §三 升级 + 新增 §三 a "主动调度判断 5 步" + 新增 §三 b "禁止 vs 允许"
    - §三 a 含关键词触发扫描表（5 类自然语言 → 5 个 subagent 候选 + 强度评级）
    - §三 a Step 3 强制"召唤前透明告知主人一句话"（给主人 0.5 秒拦下机会）
    - §三 a Step 5 强制主驾综合（禁止原样转抛 subagent 输出）
    - §三 b 明确语义澄清："Claude 强主导 = 综合 + 调度 + 反馈" ≠ "包办"
    - §十四 追加 v1.6.1 日志
  - **L1 自动** `CHANGELOG.md`（本条目）

### Memory 沉淀（不计入文件限额，属持久化层）

- 新增 `~/.claude/projects/.../memory/active-orchestration-not-passive.md`（feedback 类型）
- 更新 `~/.claude/projects/.../memory/MEMORY.md` 索引追加 1 行

### 项目共享区追加（L1 自动）

- `.ai-shared/decisions.md` D-2026-05-23-006
- `.ai-shared/context.md` 时间轴

### 立刻生效（无需重启会话）

与 v1.6.0 引入新 agent 不同 — v1.6.1 是**主驾自己行为的改变**，规则一落地立即生效。主驾从下一句自然语言指令起严格按 §三 a 5 步走。

### 关键澄清

- **"Claude 强主导"**（v1.0 提出）的本意是"主驾综合 + 调度 + 反馈"（信任主驾的判断力），不是"主驾事必躬亲"
- v1.6.1 不破坏 v1.0 原则，只是**澄清语义**避免误读
- 主人的原始偏好（[[learning-patterns]] P-004）"协作体系本身是目的"也佐证 — 体系存在就是为了被用，包办违背初衷

---

## 2026-05-23 10:00 — v1.6.0 五方协作纪元

- 触发源：
  - Codex 自指评审 `handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md` — 提议新增 6 agent（高优先级 embedded-expert + spec-architect）
  - Gemini 外部生态调研 `handoff/gemini-to-claude__external-subagent-patterns__20260523-0930.md` — 提议借鉴 10 agent（含 firmware-reviewer / meta-reviewer / planner 等；产出为训练知识 fallback，已由 v1.5.2 红线兜底）
  - 主驾综合 `handoff/synthesis__subagent-roster-v1.6__20260523-0926.md` — 收敛为 P0 三件套
  - 主人书面同意 "v1.5 → v1.6 进化主轴" + "一次性做完 3 个"

### 新增 3 个 opus 级 subagent

| Subagent | 角色定位 | 差异化（避免与现有重叠）| model | tools |
|---|---|---|---|---|
| `embedded-expert` | 嵌入式领域专家 | **不评审代码**（用 codex-reviewer），**不摘文档**（用 gemini-researcher），做基于嵌入式知识的诊断推理 + 行动建议 + skill 召唤指引。覆盖 6 大问题域：MCU/RTOS/总线/驱动/工具链/网络协议 | opus | Bash/PowerShell/Read/Write/Glob/Grep |
| `spec-architect` | 规格架构师 | 处理 **空白页阶段**："什么都没有→怎么开始"。强制澄清 7 字段（Who/What/Why/Done/Out-of-scope/Constraint/RiskAppetite），输出 PRD-like 规格 + 任务树 + 下游召唤建议 | opus | Read/Write/Glob/Grep（无执行能力） |
| `meta-reviewer` | 元评审官 | 补强 self-review.ps1 脚本盲点 — **脚本是眼睛**（结构/计数），**meta-reviewer 是大脑**（8 节语义层评审）+ 提议落 `proposals/` 等主人确认 | opus | Read/Glob/Grep（**只读，不能改文件**） |

### Model 选择哲学（v1.6 引入）

- **wrapper 层 sonnet**：codex-reviewer / gemini-researcher 主要做协调（准备 prompt + 调外部 CLI + 落盘），推理在 CLI 侧，sonnet 够用
- **reasoning / meta 层 opus**：embedded-expert / spec-architect / meta-reviewer 本身就是推理主体（不调外部 CLI），需要 opus 深度（响应 P-005"能力强大 > 省 token"）

### 5 文件改动清单（恰为 evolution-charter §五"≤ 5"上限）

1. **新建** `agents/embedded-expert.md`（~7KB，含 6 大问题域分类 + 决策路径表 + handoff 模板）
2. **新建** `agents/spec-architect.md`（~7KB，含 7 字段澄清表 + 上下文扫描清单 + 任务树模板）
3. **新建** `agents/meta-reviewer.md`（~6KB，含 8 节扫描表 + 双产物模板 + 与 self-review.ps1 协作）
4. **更新** `.claude-plugin/plugin.json` — version 1.5.2 → 1.6.0；agents 节注册 3 个新 agent + 加 model/layer/introduced 元数据字段；description 更新为五方协作描述
5. **更新** `rules.md` — §一 升级为 CLI 层 + Subagent 层双表格（含 Model 选择哲学）；§十四 追加 v1.6.0 日志

### 同步动作（L1 自动 / 不计入 5 上限）

- 3 个新 agent → `~/.claude/agents/`（双地落 hash 校验通过）
- `CHANGELOG.md`（本条目，L1 自动）
- `.ai-shared/decisions.md` D-2026-05-23-005
- `.ai-shared/context.md` 时间轴更新

### 协作矩阵（v1.6 起）

```
CLI 层（3）：
  Claude Code (主驾) ↔ Codex CLI (评审) ↔ Gemini CLI (调研)

Subagent 层（5）：
  codex-reviewer   (sonnet wrapper, v1.0)
  gemini-researcher (sonnet wrapper, v1.0)
  embedded-expert  (opus reasoning, v1.6) ← 新增
  spec-architect   (opus reasoning, v1.6) ← 新增
  meta-reviewer    (opus meta, v1.6)      ← 新增（只读）

总协作矩阵：3 CLI × 5 subagent = 8 角色 / 多调度路径
```

### 后续动作（不在 v1.6.0 范围）

- `agent-resources/` 下 3 个新目录待按实战经验填充（Layer 3 资源）
- 任务卡 `task-cards/` 是否为 spec-architect 加专用卡（如 `needs-clarification.md`）？留 v1.7 讨论
- `meta-rules/self-review-checklist.md` 的 8 节是否与 meta-reviewer 期望的 schema 对齐？需主人下次 `/co-evolve --review` 时验证
- **Claude Code session 需重启后**，3 个新 agent 才真正可被 Agent 工具召唤（subagent 加载时机限制）

---

## 2026-05-23 09:50 — v1.5.2 mirror-loop 防护落地包

- 触发源：诊断 Gemini 反代鉴权时回顾发现 gemini-researcher subagent 在 503 失败时**实际 silent fallback** 到 Claude 训练知识伪造调研产物（违反 v1.5.1 §八 红线）
- 关联事故：本日 09:30 派遣 gemini-researcher 调研外部 subagent 模式时反代 403/503，subagent 退回训练知识伪造 17 条"事实"返回；当时主驾在 Gemini handoff `备注` 节里发现了"建议主人在反代恢复后补充验证"等坦白线索才识别问题
- 变更（3 个文件，远低于 evolution-charter §五"≤ 5"上限）：
  - **B1 主修** `agents/gemini-researcher.md` SOP 第 3 步后新增 3a 失败处理子节：
    - Retry 2 次 + 指数退避（应对"No available channel" 等瞬时 503）
    - 错误类型分诊：AUTH_FAILED / MODEL_UNAVAILABLE / RETRY_EXHAUSTED 各自处理
    - **红线**：严禁 silent fallback to 训练知识；严禁伪造事实清单；严禁隐瞒失败状态
    - 失败必须落 `handoff/gemini-error__{reason}__*.md` 含 retry 历史
    - 解释 mirror-loop 防护语义（subagent 是规则执行入口）
  - **B2** `rules.md` §十四追加 v1.5.2 版本日志
  - **B3** `CHANGELOG.md`（本条目）
- 同步动作（不计入 5 文件限额）：
  - `agents/gemini-researcher.md` → `~/.claude/agents/gemini-researcher.md`（hash 校验）
- 决策记录：`.ai-shared/decisions.md` D-2026-05-23-004
- 体系版本：v1.5.1 → v1.5.2
- 关联 memory（项目级 auto-memory）：
  - `dont-judge-model-existence-by-training-data.md` — 不要用训练数据判断 model 存在性
  - `gemini-reverse-proxy-intermittent.md` — 514claude.xyz 反代是间歇性的，retry 即可恢复

---

## 2026-05-23 09:30 — v1.5.1 致命修复包

- 触发源：codex-reviewer 自指评审（`handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md`）+ 主人在 v1.5 → v1.6 进化抉择中选择"修复优先"
- 综合输入：`handoff/synthesis__subagent-roster-v1.6__20260523-0926.md`
- 变更（5 个文件，恰为 evolution-charter §五"单次进化 ≤ 5 文件"上限）：
  - **F1+F2** `.claude-plugin/plugin.json` — 版本号 1.4.0 → 1.5.1；补全 v1.5 components（co-evolve / co-learn / co-ingest 三命令 + self-review / learn-from-usage / ingest-external 三脚本 + meta_rules 节）；agents path 拆 `source`（仓库相对）+ `install`（运行时绝对）；新增 `path_convention` 与 `version_history_pointer` 节
  - **F3** `agents/codex-reviewer.md` + `agents/gemini-researcher.md` — description 字段中文化（英文 ~650 → 中文 ~150 字符，距 Claude Code 1024 字符上限留足空间，避免静默拒载；同时与主体中文一致）
  - **F4** `rules.md` §八 — 明确 mirror-loop 拒绝入口在 codex-reviewer；新增 Gemini 失败兜底（不可退回 Claude 训练知识充当外部锚点）；§十四追加本版本日志
  - **F5** `agents/gemini-researcher.md` — 替换分批工作流的 `Extract-KeyFacts` 伪代码为真实可用的 `Select-String -Pattern '^- \['` 提取
  - **F6** `agents/codex-reviewer.md` — SOP 第 4 步拆 4a（输出验证：主动检查四节格式 + 重试 1 次 + 标 `CODEX_FREE_FORMAT`）和 4b（落盘路径与字段）
- 同步动作（不计入 5 文件限额，为镜像复制）：
  - `agents/codex-reviewer.md` → `~/.claude/agents/codex-reviewer.md`（hash 校验通过后激活）
  - `agents/gemini-researcher.md` → `~/.claude/agents/gemini-researcher.md`（同上）
- 回退路径：5 个文件均可参考 D-2026-05-23-001 镜像基线（`~/.ai-collab/` 与 `~/.claude/agents/` 的 v1.5.0 状态）手工对比恢复；git init 后追溯本 commit 即可
- 体系版本：v1.5.0（manifest 漂移于 1.4.0） → v1.5.1（manifest 与 rules 一致到 1.5.1）
- 已知未修但应注意：
  - Gemini 反代鉴权问题（本次自指评审中 Gemini CLI 403，handoff 退回 Claude 训练知识 fallback）— 已通过 §八 兜底规则缓解，但需主人后续处理鉴权或考虑切官方 OAuth
  - subagent 主体"喵～"人格设定（Codex 评审建议 #5）— 主人 P-004 偏好保留，未改

## 2026-05-21 23:30 — v1.5 自我进化机制（手动 milestone）

- 触发源：主人指令"我需要其能根据使用者来自我完善和进化"
- 变更：
  - **新增** `~/.ai-collab/meta-rules/` 元规则层（4 文件）
    - `evolution-charter.md` — 进化宪法 8 原则 + L1-L4 修改授权分级
    - `self-review-checklist.md` — 自我审视 8 节清单
    - `external-watch-list.md` — 外部资源关注清单（7 类源）
    - `learning-patterns.md` — 已识别使用模式（5 条种子）
  - **新增** `~/.ai-collab/scripts/` 学习引擎 3 脚本
    - `learn-from-usage.ps1` — 扫使用模式输出 JSON
    - `self-review.ps1` — 8 节健康度评分
    - `ingest-external.ps1` — 外部资源拉取
  - **新增** `~/.claude/commands/` 3 个 slash 命令
    - `co-evolve.md` — 自我进化（--review / --apply / --apply-l2）
    - `co-learn.md` — 提炼使用模式（--apply 追加 learning-patterns）
    - `co-ingest.md` — 外部资源吸收（Codex 兼容性评估 + Gemini 案例 + 主人确认）
  - **新增** `~/.ai-collab/proposals/` 提议产物目录
  - **新增** `~/.ai-collab/CHANGELOG.md`（本文件）
  - **升级** subagent 主体 — 把 v1.4 Layer 3 精华内联（响应"不在乎 token，要更强"）
  - **升级** `rules.md` 加第十三/十四章
  - **升级** `README.md` 加 v1.5 能力表
  - **升级** `global-memories/MEMORY.md` 加 1 条 v1.5 记忆
- 回退：
  - `~/.ai-collab/.previous-version.zip`（若存在）含 v1.4 全量备份
  - subagent 主体备份在 `~/.ai-collab/.claude-plugin/.backups/`（v1.4 状态）

## 2026-05-21 17:00 — v1.4 体系发布

- 触发源：主人指令"继续推 v1.4 体系发布"
- 变更：
  - 三层渐进披露重构 subagent（codex-reviewer 165→69 行，gemini-researcher 135→69 行）
  - 新增 `~/.ai-collab/agent-resources/` 9 个 Layer 3 文档
  - 新增 `~/.ai-collab/.claude-plugin/` plugin manifest（marketplace.json + plugin.json）
  - 新增 `~/.ai-collab/INSTALL.md` 跨机器迁移指南

## 2026-05-21 16:00 — v1.3 任务卡 + 嵌入式联动

- 触发源：主人指令"继续完善"
- 变更：
  - 新增 `~/.ai-collab/templates/task-cards/` 8 张任务卡（4 嵌入式 + 4 通用）
  - 升级 `/co-review` 和 `/co-research` 加 `--card <name>` 参数
  - 升级 `/co-status` 加嵌入式自动建议（扫 .c/.h/.uvprojx/.elf/.dbc 等）
  - 新增 1 条记忆 `task-cards-and-embedded-domain`

## 2026-05-21 14:30 — v1.2 批量与统计

- 触发源：主人指令"继续"（推 v1.2）
- 变更：
  - 新增 `/co-status` 命令（看协作健康度）
  - 升级 `/co-review` 加多文件 fan-out 模式
  - 升级 `decisions.md` 加 YAML 结构化模板
  - 新增 `~/.ai-collab/scripts/usage-summary.ps1` token/活动汇总

## 2026-05-21 13:00 — v1.1 安全与韧性

- 触发源：主人选择"v1.1 安全与韧性（推荐）"
- 变更：
  - 新增 `~/.ai-collab/guardrails/` 守卫层（deny-paths.txt + dangerous-ops.md + README）
  - 新增 `/co-archive` 归档命令
  - 升级 `codex-reviewer.md` 加 Reflection 模式 + Mirror-loop 防护
  - 升级 `/co-review` 加 `--iterate` 参数

## 2026-05-21 10:00 — v1.0 协作体系泛化

- 触发源：主人纠偏"协作体系是项目目标本身"
- 变更：
  - 新建 `~/.ai-collab/` 全局协作中心
  - 把项目级 `.ai-shared/` 抽象成模板
  - 落 `~/.claude/agents/` 两个 subagent 全局可用
  - 落 `~/.claude/commands/` 3 个 slash 命令（co-init / co-review / co-research）
  - 三方锚点（CLAUDE.md / AGENTS.md / GEMINI.md）引用 `~/.ai-collab/rules.md`
  - 记忆迁移：项目级 → 全局级 `~/.ai-collab/global-memories/`

## 2026-05-21 早 — v1.0 初始协作体系（WAI 项目内）

- 触发源：主人指令"协作方案设计"
- 变更：
  - 在 `I:\514claude\.ai-shared\` 建首个协作共享区
  - 落 `shared-rules.md` / `context.md` / `decisions.md` / `handoff/`
  - 跑通 Codex 评审 demo（wai-planner promptPrefix）
  - 识别"PowerShell + Codex stdin 陷阱"等 6 条全局陷阱
