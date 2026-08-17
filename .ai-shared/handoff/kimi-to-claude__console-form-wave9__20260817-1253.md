<!-- 514cc-session-id: 122f11cb-a2b3-4792-b0e4-ec0a1abb256a -->

# Kimi → Claude handoff：控制台形态第九轮（应用菜单列 + L 形 chrome 统一色 + 卡片浮起）

## 背景

LO 供 Codex 桌面截图，三条指令：①补回 frameless 丢掉的原生菜单栏功能（≡ ‹ › 文件/编辑/视图/帮助）；
②左边栏与上边栏统一颜色；③协作台对话区用立体效果与 chrome 区别。

## 变更落点

- `apps/control-center/public/index.html`：topbar `.topbar-title` 前插入 `.chrome-menus` 簇（7 控件）。
- `apps/control-center/public/app.js`：`initializeChromeMenus()`（启动序列在 `initializeWindowChrome()` 之后）；
  视图历史双栈（`recordViewHistory` 挂 setView 的 `FORGE_VIEW_TITLES` 守卫后，app.js:2044）；
  `applyRailCollapsed` + localStorage `514cc:workbench-rail-collapsed`；
  `editMenuAction` 带 `focusin` 焦点归还（HTML 菜单抢焦点，execCommand 前先 focus 回 `lastEditableField`）。
- `apps/control-center/public/forge/console-form.css` 第九轮区块：`body.atelier .topbar` 与
  `.atelier .workbench-shell` 实色 `var(--sidebar)`；`.atelier .conversation-pane` margin 8/8/8/0 +
  12px 全圆角 + 双层投影（暗色变体）；`.workbench-shell.rail-collapsed` 三规则；
  第八轮 `::before` 凹口补丁退役。
- `scripts/vendor-lucide.mjs` + `public/lucide-sprite.svg`（136→137 symbols）+ `public/lucide-icons.json`：
  补 `panel-left`；MENU_ICONS 补 13 键。
- 测试：新 `tests/chrome-menus-contract.test.mjs`（6）；`tests/junction-radius-contract.test.mjs`
  补丁退役改负向断言；`tests/sidebar-nav-ui.test.mjs` 修陈旧选择器断言（跟上 `#view-market`）。

## 比色卡点根因（值得后续轮次记住）

初版 topbar/shell 用 62% color-mix 磨砂，rail 却是实色——`experience-polish.css:38`
`.atelier .run-rail { background: var(--sidebar); }`（(0,2,0)，源序压过 codex-desktop.css:276 的磨砂）。
同一 token 一边带 alpha 一边不带，比色永远 FAIL。决策：统一优先于透光，topbar/shell 向 rail 实色对齐，
纵深由卡片浮起承担。亮 rgb(244,241,234) / 暗 rgb(23,20,15) 三面计算色一致。

## 验证

- 契约 17/17（chrome-menus 6 + junction-radius 4 + window-chrome 7）。
- 实机探针 `apps/control-center/.scratch/verify-wave9-chrome.mjs`（端口 51496，真实文件无拦截）25 断言全绿，
  零 pageerror；截图 `apps/control-center/.qa-ui-wave9/wave9-{light,dark}.png`、`wave9-junction-{light,dark}.png`。
- 全量回归 **1376 测试 / 1375 pass / 0 fail / 1 skipped**。备注：ccswitch-proxy.test.mjs
  两个计时敏感用例（:309 熔断、:1146 close restore）在全量并发下分别抖过一次，单跑 37/37 绿、
  第三次全量 0 fail——既有抖动，与本轮无关。
- `node --check public/app.js` 通过（app.js 为混合行尾，全程 python 锚点手术，未用整文件重写）。

## LO 侧生效方式

纯网页资产：桌面壳内 **Ctrl+R** 即热重载（第七轮补的键，sessionStorage 令牌保登录态，bootstrap
nonce 一次性不参与重载），无需重启应用；`cargo` 重建只有 Rust 壳变更才需要。

__DELTA__: Kimi(514cc-cli) | 1 | 证据：apps/control-center/public/forge/console-form.css:1022 实色统一修正 + apps/control-center/.scratch/verify-wave9-chrome.mjs 25/25 绿
