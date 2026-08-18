<!-- 514cc-session-id: 01a00fb1-8675-7990-b545-9b22735b7ddb -->
# v42 R3-01 · server-observed QA runner 接线交接

- 日期：2026-08-18 21:15
- 作者：Claude（主驾），承接烛 R2 复审（`codex-to-claude__v42-pm-delivery-review-r2__20260818-2002.md`）的“继续完善”
- 性质：R2 复审“下一步必须按顺序推进”清单中**唯一不需要新授权**的一项；不改变 `IMPLEMENTATION PARTIAL / DELIVERY BLOCKED / LIVE UNVERIFIED` 总裁决
- 决策记录：`D-2026-08-18-011`

> **SUPERSEDED（2026-08-18 22:31）**：本文件保留 GLM/主驾原始交付声明作历史证据，其中“无致命问题”、仅绑定 HEAD/工作树和“先 reload 再谈 Git 闭包”的口径已被两轮 Codex 反例推翻。当前实现、顺序与验证真源请以 `codex-to-claude__v42-r301-runner-r2__20260818-2147.md` 和 `D-2026-08-18-011` follow-up 为准。

## 致命问题

无。本轮只新增生产入口，未触碰 git 暂存、正式实例 reload、真实 provider/SSH 验收三条授权边界；未引入新的静默失败路径。

## 建议改进

1. **正式实例真实执行仍缺**（R3-01 保持 `partial` 的根因）：runner 已接线，但从未在正式 Control Center 进程内对确定提交跑过一次。需要 LO 授权后：锁定 HEAD → reload → `POST /api/release-record/runner/run` → 用 `GET /api/release-record` 回读 `server-observed` 行。没有这一步，`release-record.mjs:61` 的信任分级仍只有测试内的生产者。
2. **UI 未接线**：交付门页面仍只能展示 operator-attested 申报，没有 runner 状态/触发入口。按“不扩功能”约束本轮刻意不做；若下一波做，建议只加只读状态卡 + 明确标注“运行将执行完整测试套件（约 40s+）”。
3. **`browserQa` 目前映射 `qa:environment`**：与 release-record 证据分类同名但入口是环境舱 QA。若后续引入更强的浏览器验收命令（如全量 `qa:browser`），需要 LO 决策再换目录，不能静默替换。
4. **HEAD 移动检测是保守的**：每条命令结束后才复核，命令执行中途的检出变化靠 `matchesSource` 兜底。可保留，但正式执行时应确保 run 期间无人动工作树。

## 可保留

1. **信任边界设计**：命令目录固化在 `release-command-runner.mjs` 的 `RELEASE_COMMAND_DEFS`（无 shell、无参数拼接），HTTP 只能选择 id 集合与期望 `sourceCommit`，provenance 只能由服务端 `saveObserved` 写入——客户端无法伪造 `server-observed` 行。
2. **无锚即拒绝**：`git rev-parse HEAD^{commit}` 失败时抛 `RELEASE_RUNNER_SOURCE_COMMIT_UNAVAILABLE`，不做没有提交锚的证据；run 期间 HEAD 移动则当轮记 `blocked` + `HEAD moved` 说明，不冒充通过。
3. **并发互斥与失败语义**：`RELEASE_RUNNER_BUSY` 409 挡并发 run；命令非零退出记 `failed` 不抛异常（失败也是有效证据）；执行异常记 `blocked`。
4. **验证口径**：聚焦 7/7（`tests/release-command-runner.test.mjs`）；全量 1500 tests / 1498 pass / 0 fail / 2 skipped / exit 0；`npm run validate` 13 valid / 0 invalid / exit 0；`qa:delivery --strict` tracked=348 / physical=379 / **undeclared=31** / exit 1（29 旧项 + 本轮 2 个新文件），闸门继续正确红灯。
5. **文档同步**：`proposals/v42-control-center-product-roadmap.md` 第 2.2 节 R3 行与证据信任边界段、`.ai-shared/context.md` 活跃波次与风险区均已更新为“已接线、待正式实例执行”。

## 总评

本轮把 R2 复审留下的最大工程缺口——"无 server-observed 命令证据生产入口”——从 0 补到 1：四类 QA 首次有了服务端受控执行器，且 provenance/提交锚/并发/HEAD 稳定性四道防线都有代码与测试证据。但按五层交付模型，这只是第五层（正式运行态）的**入口就绪**，不是执行完成：R3-01 仍为 `partial`，发布链整体仍 `blocked`。剩余四项（31 项 Git 交付闭包、正式实例 reload/readback、真实 provider 中文/ASCII 回读、真实 SSH UTF-8/进程树验收）全部等待 LO 逐项授权，本轮一项都没有擅自推进。

__DELTA__: Claude(主驾) | 1 | 证据：`apps/control-center/src/release-command-runner.mjs:1` 新增 server-observed 执行器并经 `apps/control-center/server.mjs:1161`、`apps/control-center/server.mjs:1164` 暴露；`apps/control-center/src/app.mjs:410` 附近惰性接线。补上 R2 复审“生产态无四类 server-observed QA runner”缺口，未推翻 R2 裁决。
