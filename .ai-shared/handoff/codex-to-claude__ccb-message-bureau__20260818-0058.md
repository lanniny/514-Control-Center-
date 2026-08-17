<!-- 514cc-session-id: 01a00fb1-8675-7990-b545-9b22735b7ddb -->
# Codex 深度评审与交付：CCB Message Bureau 本地融合

- **评审模式**：deep-review + adversarial + browser QA
- **评审范围**：`apps/control-center/src/collaboration-inbox.mjs`、`public/collab-flow.js`、`public/app.js`、Inbox/HTTP/UI 测试、隔离浏览器运行态
- **外部参考**：`https://github.com/SeemSeam/claude_codex_bridge`
- **上游核验**：`main` HEAD `7caed80170f09eb949d3290df7134af8793e2df5`，公开 README/release notes；REST 超时、raw 429，未完成 `ccb.py` 源码级核验
- **时间**：2026-08-18 00:58 +08:00

## 致命问题

1. **已修复 - 跨 run Ask ID 碰撞会误关问题。** BusStore 只保证单 run 内消息 ID 唯一，原 Inbox 用裸 `answerToAskId` 建全局集合。现改为 `runId + askId` 关联键，见 `apps/control-center/src/collaboration-inbox.mjs:107`、`:188`、`:197`；回归见 `apps/control-center/tests/collaboration-inbox.test.mjs:89`。
2. **已修复 - Inbox 打开任务在全局 run 缓存陈旧时静默失败。** `selectRun()` 现在先刷新 `/api/runs`，失败或目标仍缺失均有用户可见反馈，见 `apps/control-center/public/app.js:19923`；隔离浏览器用“先创建 run、只刷新团队 Inbox、再点击”的真实顺序验证成功跳转。
3. **交付仍阻断。** `npm run qa:delivery -- --strict` 报告 55 个未跟踪源码/测试并退出 1；本地测试通过不等于 Git 交付可复现。未获 LO 授权，本轮不执行 git add/commit。

## 建议改进

1. **P0 项目稳定锚点 + Bridge Doctor。** 合并为一个只读快照：`source/runtime/process/evidence` 四面分别返回 `ok/stale/degraded/unknown`，只做一致性判断，不把 Git、HTTP 200 或 PID 存在翻译成“已部署”。
2. **P1 协作运行回放/恢复中心。** 在 Mission Control 下按 interaction/attempt/bus/approval/interrupt/resumeClaim 联合现有事实源；回放是读模型，恢复动作继续调用既有 Orchestrator 准入，禁止直接重放 provider 请求。
3. **P2 Inbox answer/ACK lifecycle。** CCB 公开契约包含 mailbox delivery、queue depth、active job 与 abandoned delivery recovery。514cc 若开放写入，必须先设计 `ask -> answer -> acknowledged/failed` CAS、幂等键和审计，不把浏览器直接变成第二编排器。
4. **上游边界。** CCB 的 tmux/daemon/pane/mobile gateway 生命周期不适合直接移植；当前只采用 `.ccb` 稳定锚点、`/ask`、共享记忆、diagnose 与 mailbox 行为思想。

## 可保留

1. Inbox 继续复用 BusStore JSONL、scrub、Mission Control diagnostics 和 team/run 身份链；不创建第二消息数据库。
2. 读取保持有界：最多 32 个 run、128 条消息、4 路并发；run 截断现在会把整体标为 `partial`，见 `apps/control-center/src/collaboration-inbox.mjs:203`。
3. 前端 `refreshVersion + AbortController` 双所有权、就近状态节点和 `isConnected` 生命周期检查可保留，见 `apps/control-center/public/collab-flow.js:32`、`:79`、`:505`。
4. 浏览器发现的 4 个强调色内联 style 已迁入 CSS，CSP 不再报告这组违规，见 `apps/control-center/public/index.html:2060`、`public/forge/experience-polish.css:1355`。

## 总评

- 聚焦测试：`12/12 pass`；侧栏/CSP 契约：`9/9 pass`。
- 全量测试：`1415 pass / 0 fail / 1 skipped`，退出码 0。
- validate：13 项全部 `valid: true`。
- 隔离浏览器：桌面与移动无 Inbox 横向溢出；`success -> error -> recovery` 为 `is-ok -> is-error -> is-ok`；stale run 点击成功进入目标会话。证据截图位于 `apps/control-center/.qa-ccb-inbox/ccb-inbox-desktop.png` 与 `ccb-inbox-mobile-panel.png`。
- 当前结论：功能和隔离运行态已闭环，但 Git 交付与正式进程激活未闭环，维持 `CHANGES_REQUESTED / partial`。

__VERDICT__: CHANGES_REQUESTED
__DELTA__: 烛(Codex) | 2 | 证据：`apps/control-center/src/collaboration-inbox.mjs:107` 与 `apps/control-center/public/app.js:19923` 分别推翻跨 run Ask 关联和 stale run 跳转已正确的原判断。
