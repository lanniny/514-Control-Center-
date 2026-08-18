<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# v42 R3-01 Delivery Gate 2.0 收口

- 时间：2026-08-18
- 决策：`D-2026-08-18-007`
- 正式版本：仍 v3.5.0；正式实例未 reload；未 git add

## 落地

1. `apps/control-center/src/release-record.mjs`：合成 `514cc.releaseRecord/v1`（manifest + releaseTruth + 四命令证据 + unfinished）；`executeCommands` 硬拒；`autoGit` 全 false；formal-release 只挡 publishable。
2. `createReleaseCommandEvidenceStore`：落盘 `release-command-evidence.json`；passed 缺 commit/exit/duration 拒绝；写入标 `attested:true`。
3. API：`GET /api/release-record`、`PUT /api/release-record/commands`；环境舱注入 `releaseRecord`。
4. UI：环境舱「交付门」行，明示不自动 git、命令证据为申报。
5. 测试：`tests/release-record.test.mjs` **7/7 pass**（`--test-force-exit`）；UI 契约已钉 `/api/release-record`。

## 诚实边界

- live 闸仍会因未声明 must_ship / 未激活 / 缺命令证据保持 blocked 或 partial——**正确**。
- 烛 Task 因 unpaid invoice 失败；烛 CLI 启动后挂在脏仓噪声，未完成独立写盘评审。handoff `codex-to-claude__v42-r301-delivery-gate__20260818-1545.md` 已标 partial。
- 不声称正式实例已激活；不升正式版本。

## LO 下一拍（体感）

环境舱打开即可看到「交付门」裁决与 nextAction。要变绿：先授权 **git add** 把 must_ship 纳入跟踪，再补当轮验证证据并 reload——我不会擅自 add。

__DELTA__: 主驾 | 1 | 证据：R3-01 接线完成；烛独立评审通道残差已明示
