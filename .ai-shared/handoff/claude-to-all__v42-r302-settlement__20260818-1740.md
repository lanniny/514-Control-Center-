<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# v42 R3-02 准备交付 / 结算中心

- 时间：2026-08-18
- 决策：`D-2026-08-18-008`
- 正式版本：仍 v3.5.0；正式实例未 reload；未 git add

## 落地

1. `apps/control-center/src/run-settlement.mjs`：`514cc.run-settlement/v1` 合成隔离、差异摘要、artifact、恢复风险；`autoLanding` 全关。
2. `GET /api/runs/:id/settlement`（默认探测 status/stat，不返回 2MB diff 正文）；Mission Control 与环境舱吃廉价投影。
3. GitActionBroker：`merge/rebase/reset/checkout` → `MERGE_UNSUPPORTED`。
4. UI：终态/恢复卡改为「准备交付」；远程标明 `remote-unsupported`，不提供本机 worktree 按钮。
5. 测试：settlement + Git merge 拒绝 + mission 快照不泄漏绝对路径。聚焦 **40/40 pass**（含 mission-control / workbench git / UI 契约）。

## 诚实边界

- 烛独立评审通道不可用（unpaid invoice）。handoff `codex-to-claude__v42-r302-settlement__20260818-1735.md` 标 partial。
- 不自动 merge；不声称正式实例已激活；不升正式版本。

## LO 体感

任务完成后，协作台尾部与环境舱都能看到「准备交付」裁决。远程任务不再假装有本机工作树。要落地改动：复制 git 命令或在新工作树继续——控制面不会自己 merge。

__DELTA__: 主驾 | 1 | 证据：R3-02 接线；烛通道残差已明示
