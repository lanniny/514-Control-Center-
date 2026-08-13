<!-- 514cc-session-id: 8493be03-89d4-479c-a5c2-b19214bdcfdf -->
# 侧栏团队过滤缺陷修复 + 任务工具迁入右栏标签条

LO 2026-08-08 三条：①有正在工作的对话但会话不显示、侧栏只剩「无从属项目」②右栏要能多标签且方便点（附 Codex 桌面端参考图）③对话框下方的终端条撤掉，入口只放右上角。

## ① 侧栏团队过滤吃掉全部项目（真缺陷）

**根因**：`public/app.js:3874` 的 `effectiveProjectTeamId()` 对"从未右键归属过"的项目一律返回内置团队 id；而 `projectTreeModel()` 只放行 `teamId === 选中团队` 或"归属到未知团队"的项目。两者叠加 → **只要选中的不是内置团队，几乎所有历史项目连同其会话都被过滤掉**，树渲染落到「无从属项目」兜底文案。

**排除的非根因**（离线实证，不是猜）：真实 home 下 `SessionAggregator.projects()` 返回 61 个项目、5 源全 `available`，`I--514claude-514cc` 有 244 个会话且本会话排第一；`sessionRecent()` 读的 `modifiedAt` 后端有返回且在 30 天窗口内。数据链路完好，问题纯在前端团队过滤。

**修复**（LO 拍板"未归属=全团队可见"）：
- 新增 `explicitProjectTeamId()`：只有显式归属且目标团队仍存在才返回 id，否则 `null`。
- `effectiveProjectTeamId()` 改为 `explicitProjectTeamId() ?? defaultTeamId()`，其余调用点语义不变。
- `projectTreeModel()` 的放行判据改为显式归属：`null`（未归属）无条件可见；显式归属其他已知团队的不进本团队；归属到已失效团队的仍归当前团队兜底。
- 非内置团队视图下，未归属项目带虚线「未归属」淡标（内置团队视图不显示，避免满屏噪音）。
- 空态文案由「无从属项目——右键项目可改从属团队」改为「没有可显示的项目——检查顶部「近期」「已隐藏」开关，或右键项目改从属团队」（真正空时才出现，且给可操作方向）。

## ② 任务工具迁入右栏标签条（对齐参考图）

- `registry-tabs` 由 `grid(5 列)` 改 flex：固定视图页均分并单行省略，工具页按内容宽、`+` 固定在右端。
- 新增可收起的**终端标签**（图标 + 名称 + ×）与 `+` 下拉菜单（终端 / 审阅 / 浏览器 / 文件 / 侧边对话，五个工具动作一个不少，只是换了入口）。
- 终端 panel 进 `registry-panels`，首次激活懒挂载 `createTerminalPanel`；× 只收起标签、**不销毁 PTY**，与终端视图共享同一台账，重开回到原会话。
- 打开态持久化到 `514cc-wb-term-tab`；标签激活复用 `tab.click()` 走 mission-control 自己的 `activateTab`，不另存一份激活态。

## ③ 底部终端条撤除，入口只剩右上角

- 删 `index.html` 的 `terminal-dock` 整块与 `mission-tool-launcher` 底部启动条。
- `workbench-chrome.js` 的「① 底部终端 dock」（grip 拖高 / 折叠条 / 高度持久化，108 行）整段替换为「① 右栏终端标签」控制器。
- 右上角 `global-terminal-toggle`：非协作台先切回协作台；已在终端标签则收起，否则打开。`Ctrl+\`` 同语义，`Esc` 关 `+` 菜单。
- 孤儿样式清理：`workbench.css` 删 114 行、`codex-desktop.css` 删 8 处 `mission-tool-launcher` 规则与 2 处 `terminal-dock` 规则。**迁移而非丢弃**了 `.terminal-dock-body .terminal-shell / .terminal-tabs` 的铺满规则 → `.registry-terminal-body`，否则真实 xterm 会带整页边框挤进标签页。

## 证据

- `npm test`：807 tests / 806 pass / 0 fail / 1 explicit skip（新增契约文件 3 条）。
- `npm run validate`：13/13 valid。
- `npm run qa:environment`：`ok=true`、`diagnostics=[]`；四视口 1440/1280/820/390 均 `scrollWidth === innerWidth`、`gitActionReachable=true`；隔离服务优雅退出、临时根删除。
- 新增 `tests/workbench-rail-and-tools-contract.test.mjs`：锁未归属放行判据与「未归属」标、锁 tab 条五工具动作齐全与底部两块 DOM 已消失、锁三份 CSS 无孤儿选择器且花括号平衡。
- QA 新增两张常驻截图 `tool-tab-terminal.png` / `tool-tab-menu.png`（终端标签在位态、`+` 菜单展开态），人工复核无叠字、透字、溢出。
- 复核中修掉两处：tab 条挤进工具页后「连接 2/2」折成两行撑高 tab 条（补单行省略）；环境舱在「0 个运行中」时仍渲染一排头像（头像条改为只表示此刻在跑的，无运行中即不渲染）。

## 当轮修复（QA 脚本）

`qa-workbench-environment.mjs` 的五处 `#mission-tool-launcher [data-environment-action=...]` 改为经 `invokeTool()` 先展开 `+` 菜单再点条目；终端断言由「底部 dock 未折叠」改为「标签可见 + 激活 + `#terminal-dock` 计数为 0 + × 后收起」。

## 运行时与边界

- 未 commit、push、runtime sync、重启 51400 或修改凭据；离线扫描只读真实 `~/.claude|.codex|...` 历史，未起用真实 home 的服务实例（避免 ccswitch 类写盘路径污染 LO 的真实 CLI 配置）。
- 2026-08-08 治理补全：context.md 已更新至 2026-08-08，decisions.md 补录 4 条 08-08 决策，proposals 跟踪表已创建于 `.ai-shared/proposals-tracking.md`，版本一致性审计已创建于 `.ai-shared/version-audit.md`。
- `.conversation-pane` 的 `grid-template-rows` 保留了原第 6 行（dock 曾占位），现无子元素占用、无视觉影响，未动以免触碰既有布局。
- 移动端 390px 下环境舱仍受既有 `max-height: min(310px, 42dvh)` 约束，提交/推送与分组需滚动触达（codex 既有设计）。
- 本轮未召唤外部 CLI（harness 层限制本会话不主动调用 Agent 工具），故无 DELTA 账本行。改动含 QA 断言重写与治理性 CSS 删除，**建议 LO 决定是否补一次烛评审**。
