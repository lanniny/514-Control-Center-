<!-- 514cc-session-id: 019fcb94-00da-7f12-8b34-e1273927d90b -->

# 协作台 Codex 桌面式工作面收口

日期：2026-08-07

## 结论

- 协作台已收敛为 Codex 桌面式结构：左侧任务树、中央单会话、底部浮动 Composer。
- 全局导航与 Mission Control 分别成为左右按需抽屉；关闭时 `inert + aria-hidden`，右抽屉不再挤压中央会话。
- 活动成员标签是唯一直接收件人；Composer 同步显示该成员的 CLI 品牌、model、effort、权限与白名单命令，完整操作台默认折叠。
- 独立审查连续发现并闭环两层 P2：单次 Escape 曾同时关闭左右抽屉；初版 capture 修复又会抢占更高层命令面板。最终按 `dialog / 命令面板 -> 导航 -> Mission Control` 逐层消费，并由四档浏览器回归机械锁定。

## 关键实现

1. `apps/control-center/public/forge/codex-desktop.css` 是最后加载的 Codex 桌面视觉覆盖层，定义 240px 任务栏、克制的中央阅读面、底部 Composer、实色覆盖抽屉及 820px/390px 响应式结构。
2. `apps/control-center/public/app.js` 将全尺寸导航统一为按需抽屉；活动成员标签、目标标题和提交快照保持同源；导航只在更高层未消费 Escape 时关闭。
3. `apps/control-center/public/command-palette.js`、`workbench-chrome.js` 与 `app.js` 通过标准 `event.defaultPrevented` 建立命令面板、导航和 Mission Control 的稳定关闭顺序。
4. `apps/control-center/public/index.html` 默认折叠 CLI 操作台并隐藏旧营销空态；Mission Control 初始不可交互。
5. `apps/control-center/scripts/qa-ui.mjs` 覆盖 Mission 四视口、覆盖层几何、stale snapshot 所有权和双抽屉 Escape 层级；窄屏切会话按真实“收起 MC -> 选择 -> 重开”流程，不使用强制点击。
6. `apps/control-center/scripts/qa-cli-seat-catalog.mjs` 覆盖真实成员标签、Kimi/Codex/Pi 专属控件、slash 目录、配置读写、实际 POST 与 390px 几何。

## 机械证据

- `npm run validate`：13/13 valid。
- `npm test` 最终：729 tests / 728 pass / 0 fail / 1 explicit skip。
- 隔离 CLI QA：`apps/control-center/.qa-output/cli-seat-catalog/result.json` 为 `ok=true`、diagnostics=0、gracefulShutdown=true、tempRootRemoved=true。
- 隔离 Mission QA：`apps/control-center/.qa-output/codex-desktop-mission-layering/` 四档 findings 均 errors=0；390px 最终截图无底层文字透出。
- 视觉实拍：`apps/control-center/.qa-output/codex-desktop-preview/` 与 `apps/control-center/.qa-output/codex-desktop-ui-final/`。
- 语法：`app.js`、`state.js`、`workbench-chrome.js`、两份 QA 脚本及新增测试诊断均通过 `node --check`。
- 当前服务：`http://127.0.0.1:51400/` HTTP 200，Node PID 13004；本轮未重启。

## 残余边界

- 最终独立复审为 `APPROVED`，三层 Escape 顺序、焦点恢复、`inert` 与 `aria-hidden` 未发现残余阻断。
- 全量 TAP 曾两次在并发压力下于 `runtime-seats-http.test.mjs` 返回 422，目标用例独立通过且最终两轮全量通过；断言现会输出完整响应 payload，后续若复现可直接识别错误码。当前没有证据将其归因于本轮前端改造。
- `.scratch/qa-team-rail-probe.mjs` 与两个旧 QA 临时目录保持原状；本轮未获删除确认。
- 未 commit、push、runtime sync、重启或触碰凭据；无关脏改动未回退。

__DELTA__: 烛(Codex) | 1 | 证据：app.js、command-palette.js 与 workbench-chrome.js 用 defaultPrevented 建立三层 Escape 优先级，qa-ui.mjs 四视口回归闭环独立审查发现的双抽屉与命令面板误关闭问题
