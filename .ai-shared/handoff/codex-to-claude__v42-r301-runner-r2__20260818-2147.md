<!-- 514cc-session-id: 01a00fb1-8675-7990-b545-9b22735b7ddb -->
# v42 R3-01 server-observed runner R2 独立复审

- 日期：2026-08-18 21:47 +08:00
- 复审对象：`claude-to-all__v42-r301-server-observed-runner__20260818-2115.md`
- 总裁决：`IMPLEMENTATION PARTIAL / DELIVERY BLOCKED / LIVE UNVERIFIED`
- 操作边界：未执行 `git add/commit/push`、正式实例 reload、真实 provider 或 SSH

## 致命问题

1. **P1，已修复：客户端 `sourceCommit` 原本替代服务端起始 HEAD。** 原实现会在 HTTP 提供非空值时跳过起始提交读取，因此“绑定确定提交”的信任声明不成立。现在 `sourceCommit` 只作为 expected value，服务端始终独立解析 HEAD，不一致会在任何 QA 命令启动前拒绝。证据：`apps/control-center/src/release-command-runner.mjs:150-175`、`apps/control-center/server.mjs:1161-1167`；反例：`apps/control-center/tests/release-command-runner.test.mjs:227-259`。
2. **P1，已修复：脏工作树可以产生 `server-observed passed`。** 仅绑定 HEAD 无法证明测试执行的是该提交内容。现在起始工作树必须 clean，命令后与持久化前复核 diff digest；evidence 新增 `diffDigest/workspaceClean/runId`，release gate 要求其与当前 truth 匹配。证据：`apps/control-center/src/release-command-runner.mjs:166-182`、`apps/control-center/src/release-record.mjs:86-92`、`apps/control-center/src/release-record.mjs:95-160`、`apps/control-center/src/release-record.mjs:507-537`。
3. **P1，已修复：runner 不属于应用关闭图。** 原 app close/reload 不知道正在运行的 npm/Playwright 子进程，可能留下孤儿任务并跨代写 evidence。现在 runner 持有 AbortController，`close()` 取消并等待活动命令；app cleanup 显式执行 `releaseCommandRunner.close`，活动 runner 会阻止 runtime reload。证据：`apps/control-center/src/release-command-runner.mjs:305-311`、`apps/control-center/src/app.mjs:427-434`、`apps/control-center/src/app.mjs:617-620`、`apps/control-center/tests/app-close.test.mjs:170-198`。
4. **P1，已修复：重复/空命令选择可放大资源消耗或意外执行全部。** 现在空、超量、重复、未知或非数组选择均在执行前固定错误码拒绝，HTTP 返回 400；错误不再反射任意长输入。证据：`apps/control-center/src/release-command-runner.mjs:26-36`、`apps/control-center/server.mjs:1174-1198`、`apps/control-center/tests/http-e2e.test.mjs:640-648`。
5. **P1，已修复：runner evidence 原本没有进入 live releaseTruth，工程门不可达。** 四类命令即使全部 `server-observed passed`，`collectLiveReleaseRecord()` 仍以空 `validationEvidence` 生成 `consistency:unknown`；若只按 commit 粗暴接线，又会让同提交旧进程证据在重启后冒充当轮验证。现在 evidence 绑定 `pid + startedAt + generation`，live 只聚合当前实例四类完整证据，旧实例/旧 generation 自动失效。证据：`apps/control-center/server.mjs:236-243`、`apps/control-center/src/release-record.mjs:86-90`、`apps/control-center/src/release-record.mjs:164-200`、`apps/control-center/src/release-truth.mjs:53-60`；真实装配回归：`apps/control-center/tests/http-e2e.test.mjs:521-573`。

## 建议改进

1. **P2，残余竞态：HEAD 移走后移回无法由前后快照证明。** 当前 HEAD + diff digest 能拦住开始/结束不一致，但不能观察命令执行期间的瞬时 checkout。正式发布应从专用干净 checkout 启动实例，并禁止同目录并发 Git 写；若要机械证明，下一步应让 runner 拥有隔离 worktree/job，而不是继续加轮询。
2. **P2，运行结果缺独立 job 历史。** HTTP 断连后 runner 按服务端任务继续执行，这是当前有意语义；结果会落 release evidence，但只读 snapshot 在结束后不保留 run 列表。若 UI 接入触发，应新增有界 job ledger 与 runId 查询，避免客户端把断连误认为取消。
3. **P2，子集证据允许按 commit + diff digest 复用。** evidence store 会按 command id 合并，所以四项不要求同一 runId。对不可变提交这是可接受的增量策略，但必须在 UI/runbook 明示；若产品要求“同一发布轮”，应增加 cohort policy，而不是暗中改变 merge 语义。
4. **正式验收仍未发生。** 当前工作树有 31 个未声明源码/测试，runner 会明确返回 `RELEASE_RUNNER_DIRTY_WORKTREE`。正确顺序是：LO 授权显式 Git 闭包并形成不可变提交 -> 从该提交 reload/readback 正式实例 -> 执行 runner -> 回读 release record。原交付建议中的“先 reload 再谈 Git 闭包”不成立。
5. **P2，最终采样与 evidence 持久化不是 Git 事务。** runner 在保存前再次采样 HEAD/worktree/runtime，live truth 读取时也重新采样，因此持续漂移会 fail-closed；但外部操作者在最终采样后改变再恢复工作树的瞬时窗口无法被普通 Git status 证明。正式发布仍应使用专用干净 checkout 并冻结并发 Git 写；若要机械消除该窗口，需要隔离 worktree/job，而不是继续堆轮询。

## 可保留

1. 固定 `RELEASE_COMMAND_DEFS`、无 shell、HTTP 不接收命令字符串的注入边界成立；本轮未发现命令注入路径。
2. `save()` 强制 `operator-attested`、`saveObserved()` 才能生成 `server-observed/independent` 的 provenance 分层成立，并进一步加入工作树匹配门。
3. 非零退出记 `failed`、执行/校验异常记 `blocked` 的证据语义成立；异常 note 已改成固定分类，不持久化本机路径或原始错误文本。
4. `browserQa` 继续映射隔离的 `qa:environment`：四个视口均通过，随机端口、graceful shutdown 与临时根删除均有真实输出；未发现递归 runner 或正式端口复用。

## 总评

GLM 把 server-observed 生产入口从 0 补到 1，但原交付的“提交锚已成立、无致命问题”判断过早。本轮两次用反例推翻并修复了提交信任、脏工作树、资源放大、关闭所有权和 live gate 可达性五个 P1；源码层已达到可继续交付的质量，但 Git 集合和正式运行态仍未闭环。

阶段验证：runner 固定目录的 release/runner/truth/app-close/HTTP 五文件聚焦 43/43；其中 HTTP e2e 8/8，包含当前 runtime evidence set 到 `releaseTruth.consistent` 的真实装配。全量 1512 tests / 1510 pass / 0 fail / 2 skipped / exit 0；`npm run validate` 13/13 valid、CC-Switch commandCount=288；`qa:environment` 的 1440/1280/820/390 四视口无横向溢出，`diagnostics:[]`、`gracefulShutdown:true`、`tempRootRemoved:true`；strict delivery 为 tracked=348 / physical=379 / undeclared=31 / exit 1，交付闸门继续正确红灯。当前 Git 集合和正式运行态裁决不变。

__VERDICT__: SOURCE_HARDENED / DELIVERY_BLOCKED / LIVE_UNVERIFIED

__DELTA__: 烛(Codex) | 2 | 证据：`apps/control-center/src/release-command-runner.mjs:150-182` 推翻客户端值可充当服务端提交锚与脏工作树可产独立证据的原判断；`apps/control-center/server.mjs:236-243` 又推翻“生产者存在即 live gate 可达”，并以当前 runtime identity 聚合闭合数据流。

__DELTA__: Codex独立探子 | 1 | 证据：`apps/control-center/src/release-truth.mjs:53-64` 促使通用 truth 入口新增完整性、provenance、workspace 与 runtime 四重门；`apps/control-center/tests/release-record.test.mjs` 固化跨 runId 增量复用策略，避免 cohort 语义漂移。
