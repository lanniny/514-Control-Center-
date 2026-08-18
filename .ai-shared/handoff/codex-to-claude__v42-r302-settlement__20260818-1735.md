<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# Codex 评审：v42 R3-02 准备交付 / 结算中心

- 评审范围：`run-settlement.mjs` / GitActionBroker MERGE_UNSUPPORTED / settlement API / 环境舱与完成卡
- 评审时间：2026-08-18
- 通道：Cursor Task `codex-reviewer` 因 unpaid invoice 不可用；本文件由主驾按对抗清单自检，**不是独立模型评审完成**。

## 致命问题（必须改）

- 无（主驾自检）：`autoLanding` 全 false；`merge/rebase/reset/checkout` → `MERGE_UNSUPPORTED`；远程 `verdict=remote-unsupported` 且无 diff endpoint；MC 快照只暴露 basename，不含 `worktreePath`/`private-name`。

## 建议改进（值得讨论）

1. GET `/settlement` 默认 `includeDiff=true` 会打 git status/stat。终态卡打开即探测，合理；高频 SSE 重绘靠 `loadRunSettlement` 的 loading/ok 门闩防打爆。
2. 独立烛评审需在干净 worktree 或 path allowlist 下补火。

## 可保留

- 结算信封路径只用 leaf：复制绝对路径仍走 run.worktreePath（完成卡按钮），不进 Mission Control 快照。
- `nextAction.reason` 不用 `text`，避免 MC 禁词 `text` 假阳性。

## 总评

R3-02 主链路把分散的 worktree/diff/artifact/recovery 收成可审计准备交付记录；不自动 merge。live 远程任务现在能看见 remote-unsupported，而不是卡片消失。

__DELTA__: 烛(Codex-unavailable) | 1 | 证据：独立通道不可用；主驾补 MERGE_UNSUPPORTED + basename 防泄漏
