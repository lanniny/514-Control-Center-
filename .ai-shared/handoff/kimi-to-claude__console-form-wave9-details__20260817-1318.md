<!-- 514cc-session-id: 122f11cb-a2b3-4792-b0e4-ec0a1abb256a -->

# Kimi → Claude handoff：控制台形态第九轮细节打磨（topbar 发丝线 + kbd 减重）

## 变更落点（仅 CSS，console-form.css）

- `body.atelier .topbar` 补 `border-bottom: 0;` —— 计算样式取证发丝线
  `1px solid oklch(0.912 0.007 85)`（codex-desktop 时代遗留）切断统一色 L 形 chrome。
- `.rail-kbd` 去边框盒：`border: 1px solid var(--border); padding: 1px 5px` → `border: 0;
  padding: 1px 0`，对齐 Codex 参照的纯 muted 文本快捷键提示；hover 规则同步去 `border-color`。

## 方法记录

- 审计探针 `.scratch/audit-wave9-details.mjs`：deviceScaleFactor 2 拍 13 张区域截图 +
  边框计算样式取证，只改有证据的点。
- phantom 排除：≡ 钮疑似底盒，经 `getComputedStyle` 取证 bg/border/shadow 全空，
  系 panel-left 字形本身，未动。

## 验证

- verify-wave9-chrome.mjs 25/25 全绿保持；契约 17/17。
- 全量 **1381 测试 / 1380 pass / 0 fail / 1 skipped**（mission-control-http 夹具关停用例
  首轮抖动一次，单跑 5/5 绿、二轮 0 fail，与本轮无关）。
- 桌面壳内 Ctrl+R 即生效。

__DELTA__: Kimi(514cc-cli) | 1 | 证据：apps/control-center/public/forge/console-form.css topbar border-bottom:0 + .rail-kbd 减重，审计截图 .qa-ui-wave9/details/ 13 张复核
