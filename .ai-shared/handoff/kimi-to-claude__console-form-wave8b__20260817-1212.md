<!-- 514cc-session-id: 122f11cb-a2b3-4792-b0e4-ec0a1abb256a -->
# Kimi → Claude：第八轮二轮修正（圆角看不见 + 页签带割裂）

2026-08-17 · 执行：Kimi(514cc-cli) · 触发：LO 重启后反馈"还是不对"，分无标签页/有标签页两态供图

## 根因（逐像素取证）

- **圆角一直在渲染，只是肉眼不可见**：conversation-pane 是 78% 半透明玻璃，圆角裁出的缺口直接透出 atelier 舞台近白底色——无标签页态弧外点 (242,54) 采样 (250,249,245)，与卡内同色，弧线隐形。有标签页态只是略可见。
- **conv-tabs 的 muted 横带**把卡片割裂成两段，不符合 Codex"标签行与内容同一张卡面"。

## 改动（仅 console-form.css 第八轮区块，编辑而非追加）

- 新增 `.atelier .workbench-shell::before`：在 (var(--codex-task-rail), 0) 垫 12×12 rail 同配方玻璃色（`color-mix(in oklab, var(--sidebar) 62%, transparent)`），`z-index:-1` 沉到 grid 子项之下，只从圆角缺口露出；移动端 rail 100% 时自然出屏。
- `.atelier .conv-tabs` 背景改 `transparent`（圆角保险丝保留），页签行并入卡面。

## 验证

- 契约 `tests/junction-radius-contract.test.mjs` 4/4（新增垫底三断言）。
- 探针 `.scratch/verify-wave8-junction.mjs` 6 断言全过（垫底 z:-1/12×12/left:240px、pane 10px、rail 无线无影、conv-tabs 10px+透明）；无标签页态截图 `.qa-ui-wave8/final-notab-junction.png` 缺口可读。
- 缺口像素：亮色 (246,244,238) ≈ rail (244,241,234)；暗色 (25,22,17) ≈ rail (23,20,15)。
- 全量 `npm test`：1367 测试 / 1366 pass / 0 fail / 1 skipped。
- 编年：`DESIGN-NOTES.md` 第八轮二轮修正条目。

LO 侧：壳内 Ctrl+R 即生效（本轮起已支持），无需重启应用。

__DELTA__: Kimi(514cc-cli) | 2 | 证据：逐像素取证推翻"圆角未生效"误判（弧一直存在，缺口透近白舞台色导致隐形），console-form.css 凹口垫底+页签并入卡片后双态双主题成立
