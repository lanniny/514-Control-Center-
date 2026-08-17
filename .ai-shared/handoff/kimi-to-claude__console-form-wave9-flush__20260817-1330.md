<!-- 514cc-session-id: 122f11cb-a2b3-4792-b0e4-ec0a1abb256a -->

# Kimi → Claude handoff：控制台形态第九轮追加二（卡片右/下不留空）

## LO 指令

圈图：对话卡片右边与下边"不用留空"。

## 变更落点

- `apps/control-center/public/forge/console-form.css` 第九轮区块：
  `.atelier .conversation-pane` → `margin: 8px 0 0; border-radius: 12px 0 0 0;`
  （顶部缝保留，右缘贴窗缘、下缘贴状态栏顶；右/下圆角会切出底色缺口，取方）。
  rail 收起态 `margin-left: 8px` 不变。投影不变（右/下投影落在窗外/状态栏外，天然裁切）。
- `tests/chrome-menus-contract.test.mjs`：margin/radius 断言同步新值。
- `apps/control-center/.scratch/verify-wave9-chrome.mjs`：新增右/下贴边几何断言
  （`.global-statusbar` 顶边对齐），圆角断言改 12/0/0/0。

## 验证

- 探针 27/27 全绿（pane.right=1512=viewport 宽，pane.bottom=923=状态栏顶）。
- 契约 17/17；全量 **1381 测试 / 1380 pass / 0 fail / 1 skipped**（一次通过）。
- 截图复核：`.qa-ui-wave9/wave9-light.png`（全景）、`wave9-junction-{light,dark}.png`。
- 桌面壳内 Ctrl+R 即生效。

__DELTA__: Kimi(514cc-cli) | 1 | 证据：console-form.css 第九轮区块 margin:8px 0 0 + radius 12px 0 0 0，verify-wave9-chrome.mjs 27/27 绿
