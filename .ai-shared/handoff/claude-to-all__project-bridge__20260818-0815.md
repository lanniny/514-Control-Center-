<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# R1-01 稳定项目锚点 + Bridge Doctor

- **时间**：2026-08-18 08:15 +08:00
- **范围**：项目经理下一迭代。Inbox 仍只读。未升正式版本。
- **独立评审**：`.ai-shared/handoff/codex-to-claude__project-bridge__20260818-0810.md`（烛 DELTA=1，已当场收口）

## 用户能看见什么

环境舱「本地」下面多了一行 **项目桥**。四个面：源码 / 运行时 / 进程 / 证据。没有当轮证据时写「四面未齐，不能称为项目已接通」，不会变绿。

同一个 Git 仓库换目录，锚点不变、源码面标 stale。没有 Git 的文件夹搬家，就是新身份。

## 实现

- `514cc.project-bridge/v1`：`apps/control-center/src/project-bridge.mjs`
- `projectId` 跟规范化 cwd；`anchorId` 跟仓库首提交（无 git 则跟路径）
- `GET /api/workbench/environment` 附带快照；`GET /api/project-bridge` 只认 `runId`，**忽略 cwd query**
- 不新建视图，不替代 `runId/team/member/adapter`

## 烛补强（已收）

路径移动原先只锁了 store。指纹若编进 `.git` 路径，整棵 `mv` 会换身份。现改为首提交；并补真实 rename 与无 git 搬家测试。对外 `headDigest` 不再回完整 HEAD。

## 验证

- `tests/project-bridge.test.mjs` + 环境舱契约：14 pass / 0 fail（含真实 mv、无 git 搬家、缺失 source、旧 evidence、分支切换、进程重启）
- 未 reload 正式 Control Center，未 git add/commit

## 没做

R1-02 向导、R1-03 派工预演、R1-04 回放、R0-04 shutdown、Inbox 可写、版本升格。

__DELTA__: 烛(Codex) | 1 | 证据：project-bridge.mjs repositoryFingerprint 改为首提交，真实 mv 保持 anchorId；无 git 搬家换身份。原判断见 codex-to-claude__project-bridge__20260818-0810.md
