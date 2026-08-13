# v4.0 Wave G — 门闩面开放与深度融合设计（LO 授权版）

> Date: 2026-07-25 · 主驾：Kimi · 触发：LO「这需要继续完成……可以吸取甚至搬他们的代码……排版分类完善……再做 Awwwards 实验艺术面」
> 侦察证据：`.scratch/codeg`、`.scratch/LiveAgent` 三份深读报告；依赖实测 `.scratch/dep-probe`

## 0. 授权与边界

LO 于 2026-07-25 明确授权开放：channels / ssh / sftp / office / pty / skills_marketplace / mcp_marketplace 七门。
**未授权仍封锁**：gateway（第三运行时）、remote_web（非本机绑定）。
授权落盘为可审计 grant 账本（见 §2），非代码硬编码。

## 1. 侦察结论摘要（决定搬运策略）

| 面 | codeg | LiveAgent | 514 策略 |
|---|---|---|---|
| Channels | Telegram/Lark/微信 Rust ~9000 行 + 出站 webhook | 无 | Node 直译 Telegram 长轮询 + 双向 webhook；Lark/微信列增强债 |
| SSH/SFTP | **无** | proto 有 TerminalSsh/Sftp/Tunnel | ssh2 自建 = 超越 codeg |
| Office | 外挂 officecli 二进制 | 无 | 进程内 docx/exceljs/pptxgenjs = 超越 codeg |
| PTY | portable-pty + xterm6 多页签 + write-queue | proto 有 | node-pty（实测 ConPTY OK）+ vendored xterm |
| 市场 | MCP 双 registry REST，**零校验** | ClawHub + stage-swap 原子装 + 写锁 | 双 registry + 暂存审查 + 哈希记录 + 原子交换（两家之和） |

## 2. 门闸演化（remote-gates v2）

- 新增 grant 账本 `<dataRoot>/remote-gates.grants.json`：`{ grants: [{ gate, grantedAt, source, note }], revocations: [] }`，初始由本波写入 LO 授权的七门（source: "LO conversation 2026-07-25"）。
- `assertRemoteGate(id)` 行为变更：未知门→UNKNOWN；无 grant→BLOCKED(501)；有 grant 且模块已注册→放行；有 grant 未实现→NOT_IMPLEMENTED(501)。
- `listRemoteGates()` 增加 `implemented` 字段；快照 schema 升 `514cc.remote-gates/v2`。
- 新增 `POST /api/security/remote-gates/grant|revoke`（写账本 + 审计事件）。保留旧端点契约可演化，`tests/remote-gates.test.mjs` 相应更新。

## 3. 后端五面（src/，各带 tests/）

### 3.1 `src/channels.mjs`（gate: channels）
- Telegram Bot：长轮询 `getUpdates`（原生 fetch，无新依赖），入站消息→bus/会话路由；出站回复。token 走 secrets 编校（redaction），不落明文日志。
- 通用 webhook：出站 fire-and-forget POST JSON；入站端点 `POST /api/channels/webhook/:id` 需 HMAC-SHA256 头校验 + ResponseLeaseLimiter 限流。
- 事件扇出：run/审批/交接事件可订阅推送到渠道（对应 codeg event_subscriber 思想，简化为规则表）。
- 全部走 EventStore 审计：`channels.inbound|outbound|error`。

### 3.2 `src/ssh.mjs`（gate: ssh / sftp）
- ssh2（createRequire 加载 CJS）。连接池（按 host 复用、空闲回收）。
- 凭据**引用制**：配置只存 `{ host, port, user, authRef }`，密码/私钥内容经 secrets 机制，响应白名单字段不外发。
- 主机校验：known_hosts 指纹比对，首连需 LO 确认指纹（审批式）。
- SFTP：`list/read/write/stat`，路径策略（根白名单 + assertWithin 同款围栏）。
- 审计：`ssh.connect|exec|sftp.*`。

### 3.3 `src/office.mjs`（gate: office）
- 进程内生成：docx（docx 库）、xlsx（exceljs）、pptx（pptxgenjs）。
- 模板化创建（标题/段落/表格/样式参数）+ 文档 inspect（解包读取结构摘要，不渲染）。
- 输出围栏：目标目录白名单 + dryRun 预览（与 bootstrap.mjs 同款「计划→确认→落盘」）。
- 审计：`office.generate|inspect`。

### 3.4 `src/pty.mjs`（gate: pty）
- node-pty（createRequire）。会话表 { id, shell, cwd, pid, cols, rows }，shell 探测（COMSPEC→powershell→pwsh→bash）。
- cwd 沙箱：默认限 repo 内/登记工作区；显式放行其他路径。
- I/O：输出经 SSE 推流（环形缓冲 + 背压丢弃计数），输入 POST（write-queue 单飞有序，借鉴 codeg write-queue）。
- 生命周期：取消级联接入 child-registry；审计 `pty.spawn|input|resize|exit`；输出大小上限 + 敏感模式 redaction。

### 3.5 `src/market.mjs`（gate: skills_marketplace / mcp_marketplace）
- MCP：官方 registry + smithery 搜索/详情 REST；安装 = 暂存下载→审查报告（权限/命令/环境变量）→确认落库。哈希记录入台账。
- Skills：zip/HTTP/GitHub URL 安装，**stage-then-swap 原子交换 + 写锁**（LiveAgent 模式）；SKILL.md frontmatter 校验；来源 allowlist。
- 离线降级：registry 不可达时明确报错，不 silent fallback。
- 审计：`market.search|stage|install|reject`。

## 4. 前端五面 + IA 重组

### 4.1 新 IA（替代现 4 组 11 项）
- 协作：协作台 / 团队协作 / **渠道**
- 创建：项目启动器 / **文档工坊** / **终端**
- 观测：系统总览 / 体系观测 / 会话聚合 / 能力图谱
- 资源：**市场** / **远程主机**
- 系统：配置中心 / 模型路由 / 安全诊断
（5 组 16 项；topnav/mobile/palette VIEW_TITLES 同步）

### 4.2 视图实现约定
- 每视图 = `public/<surface>-panel.js`（自举模块，`await apiReady`）+ `public/forge/<surface>.css`。
- 零 emoji；图标 `lucideIcon()`；禁内联 style（data-brand / CSSOM setProperty）；骨架/空态/错误态齐备。
- 终端：vendored `@xterm/xterm` + addon-fit（静态 CSS 走 style-src 'self'），多页签，明暗主题跟随。

## 5. codeg UI 移植批（G3）

1. ws-surface/ws-msg 磨砂 CSS 族 + inline-code pill → forge/primitives.css（纯 CSS 直搬，数值对齐 globals.css OKLCH）
2. Shimmer 思考流光 → `@keyframes` 声明式重写（codeg 用 inline style，CSP 下必须类化）
3. InstantCollapsible → `grid-template-rows: 0fr/1fr` vanilla 版
4. 侧栏行 hover 快捷键徽章（SHORTCUT_BADGE_CLASS 等价）
5. 代码块：highlight.js vendored 子集 + `--shiki-dark` 同款双主题变量契约 + max-h-96 折叠
6. 可拖拽分栏（pointerdown + 百分比，~100 行）用于协作台/终端
7. 自托管可变字体 + 运行时 `--font-sans` 切换 + 防闪字脚本（appearance-script 模式）

## 6. G4 Awwwards 艺术层（最后做，LO 排序）

- 团队星图 → 全屏英雄页（物理动效、实验排版、canvas 协作流）
- 启动/关于页实验性版式；保持工具面克制，艺术面独立路由
- 全程 reduced-motion 降级

## 7. 施工与集成纪律（蜂群）

- 依赖由主驾统一安装进 apps/control-center（node-pty/ssh2/docx/exceljs/pptxgenjs/@xterm/*/highlight.js），工位不自行加依赖。
- 后端工位：只写 `src/<surface>.mjs` + `src/<surface>/routes.mjs`（导出 `register<SX>Routes(ctx)`）+ `tests/<surface>.test.mjs`；**不碰 server.mjs**（主驾统一接线，防五向冲突）。
- 前端工位：只写自己的 panel.js + forge css；**不碰 index.html/app.js**（主驾统一注册视图）。
- 每个工位交付前 `node --check` + 自测通过；报告列出：文件清单、端点清单、测试数、未竟项。
- 主驾集成：接线 → 全量测试 → validate → 截图走查 → handoff/CHANGELOG/DELTA。

## 8. 增强债（本波明确不做）

- Lark/微信渠道后端（protobuf/私有协议，独立波次）
- Office 可视化预览渲染（mammoth/沙箱 iframe，独立设计）
- SSH 端口转发/隧道（LiveAgent TunnelFrame，独立波次）
- 跨 run Evidence Graph / Heterogeneous Replay / Counterfactual Dispatch（沿用 R3 目标态）
