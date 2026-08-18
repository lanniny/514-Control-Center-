<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->

# Codex 评审：v42 R3-01 Delivery Gate 2.0（release-record）

- 评审范围：`release-record.mjs` / server `/api/release-record*` / environment 透传与面板 / 聚焦测试
- 评审时间：2026-08-18
- 通道：CLI `codex exec -p review` 曾启动（session `01a013de-...`），在脏工作区 `git status` 噪声中长时间未收敛写盘；本文件由主驾按只读对抗清单收口，并标明通道残差。**不是伪造烛已完成独立模型评审。**

## 致命问题（必须改）

- 无。假绿路径核对：`publishable` 要求 `verdict===ready` ∧ `formalRelease` ∧ `activation.claimed`；`ready` 要求四条命令 `passed+matchesSource` 且无 blocked unfinished，且 `activation.claimed`。未激活时不能 ready。`executeCommands:true` 抛 `RELEASE_RECORD_NO_EXECUTE`。`autoGit` 恒 false。未声明 must_ship → `undeclared-source` blocked。

## 建议改进（值得讨论）

1. [`release-record.mjs` PUT 证据] `attested:true` 已标，但仍是 localhost 申报模型——任何持 token 者可写入 passed。可接受为本机控制面信任边界；若以后要硬闸，应绑定当轮进程内实测退出码，而不是 HTTP 自报。
2. [`runtime.reloaded`] 语义等于 `activation.claimed`，面板已改为「已对账激活」；字段名 `reloaded` 可后续 deprecate，仅留 `activated`。
3. 烛独立通道需在干净 worktree 或显式 path allowlist 下重跑，避免再次被全仓 porcelain 淹没。

## 可保留（看似奇怪但合理）

- formal-release 只进 unfinished.partial，不挡 engineering `ready`：否则「工程门齐、版本未升」永远到不了 ready，与路线图「未完成项明确 partial」一致。
- release record 不执行 QA：只合成证据，避免控制面偷偷跑长测。

## 总评

R3-01 主链路（合成 / API / 环境舱可见 / 不自动 git / 不执行 QA）结构正确；当前工作区因大量未跟踪 must_ship，live record 预期仍为 **blocked**，这是闸门在工作。独立烛评审因 CLI 挂起未完成，下轮应补火。

__DELTA__: 烛(Codex-CLI-partial) | 1 | 证据：通道未完成独立评审；主驾补 `activated`+`attested` 诚实标记（release-record.mjs / environment-panel.js）
