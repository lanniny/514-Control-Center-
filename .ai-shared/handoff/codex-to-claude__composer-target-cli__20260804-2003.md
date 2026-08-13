<!-- 514cc-session-id: 019fcb94-00da-7f12-8b34-e1273927d90b -->

# 协作台唯一发送目标与 CLI 专属 Composer 收口

日期：2026-08-04

## 结果

- 协作台将活动目标标签设为唯一直接收件人真源：`团队协作` 发送给当前团队主脑并由其编排；成员标签直接发送给该逻辑成员。
- 删除可见的“起始成员”和“发送给”下拉。`#start-agent`、`#followup-agent` 仅保留为隐藏兼容桥，不参与新建或续聊 payload 决策。
- 新任务 `startAgentId`、续聊 `agentId` 均从 `activeComposerTarget()` 派生；`@` 只维护结构化 `requestedAgentIds`，不会暗改直接目标。
- Composer 按 `memberId -> runtimeProfileId -> adapter catalog` 展示真实 CLI 控件。Kimi 支持 model、无 effort；Codex effort 包含 `low/medium/high/xhigh/max/ultra`。
- 续聊沿用原生会话配置，因此隐藏 model/effort/permission，并明确显示“沿用 X 会话配置”，不提供无法生效的覆盖控件。
- 视觉借鉴 CodeG 的目标切换带、大输入区和底部能力带；活动成员色贯穿目标标签、身份栏和输入框左侧脊线。

## 关键证据

- 唯一目标状态与团队/成员语义：`apps/control-center/public/app.js:3854`、`apps/control-center/public/app.js:3880`、`apps/control-center/public/app.js:11117`。
- 新建与续聊 payload：`apps/control-center/public/app.js:9587`、`apps/control-center/public/app.js:9641`。
- 可见目标标签与隐藏兼容桥：`apps/control-center/public/index.html:504`、`apps/control-center/public/index.html:507`。
- CLI 专属目录和能力显隐：`apps/control-center/public/app.js:3938`、`apps/control-center/public/app.js:3967`。
- CodeG 风格与移动端菜单分层：`apps/control-center/public/forge/workbench.css:934`、`apps/control-center/public/forge/workbench.css:1190`。
- 契约与浏览器门闩：`apps/control-center/tests/composer-target-ui.test.mjs:8`、`apps/control-center/scripts/qa-cli-seat-catalog.mjs:500`。

## 浏览器实证

隔离 Playwright：

`node scripts/qa-cli-seat-catalog.mjs --composer-only --output-dir .qa-output/composer-target-layer`

- `ok: true`，浏览器 diagnostics `0`，隔离服务优雅退出，临时根已删除。
- 初始目标为“团队协作”，路由标识为“主脑接收并编排”；可见目标依次包含团队与 6 个当前成员。
- Kimi 新建 payload：`startAgentId=kimi-frontend`，`requestedAgentIds=[codex-technical]`，`model=kimi-code/k3`，无 `effort` 字段。
- 续聊目标实测：Kimi 成员页发送 `agentId=kimi-frontend`；团队协作页发送 `agentId=claude-fable`。
- Codex effort 目录实测包含空默认值与 `low/medium/high/xhigh/max/ultra`。
- 390px：`body/root=390`，无横向溢出；斜杠菜单 bottom `669.84375`、composer top `670.84375`，无重叠，`elementFromPoint` 确认菜单未被遮挡。
- 截图：`apps/control-center/.qa-output/composer-target-layer/composer-kimi-desktop.png`、`composer-kimi-slash-desktop.png`、`composer-kimi-mobile.png`。

## 验证

- 相关定向测试：`11 pass / 0 fail`。
- 全量 `npm test`：`699 tests / 698 pass / 0 fail / 1 explicit opt-in skipped`。
- `npm run validate`（`apps/control-center`）：`13/13 valid`，CC-Switch 账本 `288` 条。
- `node --check`：`public/app.js`、`public/state.js`、`public/collab-flow.js`、QA 脚本与新增测试均通过。
- 现有运行实例未被替换：`127.0.0.1:51400` 仍由 PID `32332` 监听，首页返回 `HTTP 200` 且标题匹配 `514 Forge`。

## 诚实边界

- `npm run validate` 第一次误从仓库根执行，因根目录没有 `package.json` 返回 `ENOENT`；随后在 `apps/control-center` 正确执行并得到 `13/13 valid`。
- Playwright、全量测试与 validate 均在结果输出后出现 PowerShell 包装器保留句柄；确认实际 Node 子进程和隔离服务已退出后，仅终止本轮包装器。没有触碰现有 `51400` 服务。
- 未执行 commit/push，未 reset/checkout，也未覆盖工作树里 Kimi 或用户已有的其他改动。

__DELTA__: 烛(Codex) | 1 | 证据：apps/control-center/public/forge/workbench.css:1190 消除 390px 菜单与 composer 重叠，并以 apps/control-center/scripts/qa-cli-seat-catalog.mjs:507 的可见层命中门闩防止几何通过但菜单被遮挡
