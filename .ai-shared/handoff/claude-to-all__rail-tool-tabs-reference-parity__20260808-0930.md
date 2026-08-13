<!-- 514cc-session-id: 8493be03-89d4-479c-a5c2-b19214bdcfdf -->
# 右栏改造为工具标签栏（对齐 Codex 桌面端参考图）+ 终端回底部抽屉

LO 提供 5 张 Codex 桌面端截图，要求右栏"尽可能模仿并美化"：左图标开下侧终端、右图标开右栏；点审阅/浏览器/文件各显示对应界面；标签全关时露出工具选择列表。

**IA 由 LO 拍板**：Mission Control（环境舱 + 任务/产物/证据/活动/连接）成为默认工具页「任务上下文」，与审阅/浏览器/文件并列。

## 落地

- `public/rail-tools.js`（新）：工具标签控制器。`RAIL_TOOLS` 单一真相同时驱动标签条、➕ 菜单与空态选择器；打开顺序与激活态持久化；`external` 工具（终端/侧边对话）不占标签只转发动作。
- `public/modules/rail-panels.js`（新）：三个工具页内容。审阅把 `/api/runs/:id/diff` 的 unified diff 解析成带新旧行号的着色块（`parseUnifiedDiff` / `summarizeDiffStat` 可单测）；文件页复用受控 workspace 投影做左预览右目录树 + 筛选；浏览器页做地址栏与历史。
- `public/forge/rail-tools.css`（新）：标签条、➕ 菜单、空态选择器、三个工具页与底部终端抽屉的完整样式。
- `public/index.html`：右栏顶部换成 `rail-tabbar`，环境舱与五页包进 `data-tool-panel="mission"`，新增审阅/浏览器/文件三页与空态；底部终端抽屉回归（无常驻条）。
- `public/workbench-chrome.js`：`bootDockTerminalTab` → `bootTerminalDrawer`（底部抽屉，保留拖高/双击复位/↑↓ 步进）；右栏折叠钮改挂常驻的 `rail-tabbar-actions`。
- `public/app.js`：抽出 `openExternalUrl` 统一外链出口（先 `about:blank` 再断 opener 后 replace），右栏浏览器页与既有对话框共用；`syncRailToActiveRun()` 挂在全部 4 个 `selectRun` 出口。
- `server.mjs`：`/rail-tools.js` 进静态白名单（`/modules/` 与 `/forge/` 走前缀白名单）。

## 刻意不跟参考图的两处

1. **浏览器页不内嵌 webview**：Console 是本地网页，iframe 加载外站会被绝大多数站点的 `X-Frame-Options`/CSP 拒绝，且既有边界是「Browser 是系统浏览器入口，不授予 CLI 浏览器权限」。做成参考图的形态（前进/后退/刷新 + 地址栏 + 空态 + 历史），打开仍走系统浏览器新标签，页面上写明这条边界。契约测试断言该模块不得出现 `<iframe>`。
2. **补回「侧边对话」**：参考图的工具列表只有审阅/终端/浏览器/文件。照搬会悄悄丢掉 514cc 的直接收件人入口，故作为 `external` 工具保留在菜单与空态列表中。

## 排障中查实的五个缺陷（均已修）

1. **右栏结构错位**：上一轮删除旧工具标签槽时，切片终点落在了 `registry-tabs` 的闭合标签上，留下两个多余 `</div>`，把 `rail-tool-panels` 提前关掉——空态与选择器被浏览器移出 `aside`，控制器因元素不在 root 内退化成 no-op 桩。用标签栈平衡检查定位并修复。
2. **Escape 越权**：右栏折叠器也监听 Escape，用户关 ➕ 菜单会连带折叠整条右栏。改为 capture 阶段消费并 `preventDefault()`。
3. **同一页发两遍请求**：`open()` 之后必然跟一次 `activate()`，宿主两处都接会让审阅页发两次 diff 请求并互相 `abort`（QA 抓到 `net::ERR_ABORTED`）。只接 `onActivate`。
4. **换任务不刷新**：切 run 不触发标签激活，审阅/文件会停在旧任务内容。新增 `syncRailToActiveRun()` 并由契约测试机械保证每个 `selectRun` 出口都调用。
5. **终端关闭钮被浮层吃掉**：右栏是 `position:absolute; z-index:85` 的浮层，永久覆盖对话区右上角。`elementFromPoint` 探到点击落在环境舱行上，遂把关闭钮移到抽屉左上角。

## 证据

- `npm test`：809 tests / 808 pass / 0 fail / 1 explicit skip。
- `npm run validate`：13/13 valid。
- `npm run qa:environment`：`ok=true`、`diagnostics=[]`；四视口 1440/1280/820/390 均 `scrollWidth === innerWidth`、`gitActionReachable=true`。
- **审阅页的 diff 渲染路径被真实验证**：QA 主任务无隔离 worktree（只显示边界空态），故新增切到 `buildRunId` 的分支，断言渲染出 `.rail-diff-file`、命中 `worktree-only.txt`、`.rail-diff-line.is-add` 数量 > 0、统计条出现 `+N`。截图 `rail-tab-review.png` 人工复核：文件块 / `@@` hunk 头 / 绿底新增行 / 新旧行号列齐全。
- 常驻视觉证据：`rail-tab-mission.png`、`rail-tab-review.png`、`rail-tab-files.png`、`rail-tab-browser.png`、`rail-tool-menu.png`，均人工复核无叠字、透字、横向溢出。
- 新增契约：`tests/workbench-rail-and-tools-contract.test.mjs` 锁标签条结构、任务上下文页确实包住环境舱与五页、菜单与空态同源、终端为底部抽屉且常驻条不得回归、`selectRun` 出口全量同步、Escape 作用域、浏览器页无 iframe。
- 复核中修掉的视觉瑕疵：非活动标签的 × 隐藏但仍占位，把「打开文件」挤成「打开」（改常显低透明度）；审阅页范围行打印完整临时路径占两行（两端改末段目录名 + title 保留全路径）。

## 运行时与边界

- 未 commit、push、runtime sync、重启 51400 或修改凭据。
- 2026-08-08 治理补全：context.md 已更新至 2026-08-08，decisions.md 补录 4 条 08-08 决策，proposals 跟踪表已创建于 `.ai-shared/proposals-tracking.md`，版本一致性审计已创建于 `.ai-shared/version-audit.md`。
- 本轮排障用的临时诊断输出（RAIL DEBUG / RAIL IMPORT / RAIL SCOPE / DRAWER DEBUG / DRAWER STATE）已从 QA 脚本移除；一次性改造脚本跑完即删。
- `.conversation-pane` 的 `grid-template-rows` 仍保留原第 6 行，现由终端抽屉占用。
- 本轮未召唤外部 CLI（harness 层限制本会话不主动调用 Agent 工具），故无 DELTA 账本行。**改动量大且含 5 处缺陷修复与 QA 断言重写，建议 LO 补一次烛评审。**
- 本轮非刷 DELTA 但需记录：右栏从 Mission Control 单页扩展到 4 工具标签 + 空态选择器 + 终端抽屉（`rail-tools.js`/`rail-panels.js`/`rail-tools.css` 新建），5 处排障查实缺陷均修。
