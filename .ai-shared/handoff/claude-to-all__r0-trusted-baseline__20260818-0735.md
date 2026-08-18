<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# R0 可信发布基线落地

- **范围**：项目经理批准的 R0-01 → R0-02 → R0-03
- **时间**：2026-08-18 07:35 +08:00
- **正式版本**：仍为 v3.5.0，未升格
- **独立评审**：`.ai-shared/handoff/codex-to-claude__r0-trusted-baseline__20260818-0720.md`（烛 DELTA=1，已当场收口）

## 做了什么

### R0-01 中文传输契约

- 新契约 `514cc.promptTransport/v1`：`apps/control-center/src/prompt-transport.mjs`
- 通道：Claude/Codex-exec/Gemini = stdin；Kimi/Grok/OpenCode = argv；Codex app-server / Pi = jsonl；SSH 本地往返后再拼命令行
- 只记 `inputDigest/byteLength/codePointCount/transport`，不记原文
- Windows `.ps1` + 非 ASCII：argv **和** stdin 都 fail-closed 为 `PROMPT_TRANSPORT_UNSAFE`（烛补强）
- `?` / U+FFFD 替换 → `PROMPT_TRANSPORT_CORRUPT`，orchestrator 标 `failureClass=provider_error`，不自动恢复
- 子进程环境钉死 `PYTHONIOENCODING/PYTHONUTF8/LANG/LC_ALL`
- `preparePromptTransport` **不 await** emit，避免 EventStore 挂死 `turn/start`

### R0-02 交付集合

- `apps/control-center/delivery-ownership.json` cut `v42-r0`，`formalRelease: false`
- `qa:delivery --strict` 按 must_ship/generated/scratch/deferred 判意图；未声明或 must_ship 未跟踪仍红
- focus 现含 `server.mjs`（烛补强）；`.ps1` 算源码
- CI：`.github/workflows/control-center-ci.yml` 增加 `qa:delivery --strict` 与 `git diff --check`

### R0-03 运行态对账

- `514cc.releaseTruth/v1`：源提交 / 脏树摘要 / PID / generation / cwd / startedAt / 验证证据
- 无当轮 `validationEvidence` → `unknown`；脏树 → `stale`；`passed` 缺 `sourceCommit` → `unknown`（烛补强，不再误绿）
- 环境舱只读「运行态」行：文案「没有当轮 readback，不能称为已激活」
- `.workflow/ultracode/collab-console-review-20260815/state.json` 已 `superseded`

## 验证（我跑过的）

- 聚焦测试：24 pass / 0 fail / 1 skip
- skip 含义：本机 `powershell.exe -File` + echo fixture **保住了**「中文任务」argv。历史真实 provider 闭环里的 `?` 仍成立，所以 `.ps1` 路径继续封死，不把本机 echo 当成「PowerShell 已安全」
- native node argv/stdin：中文 / emoji / 组合字符 / 换行 / 超长 digest 一致
- `qa:delivery --strict`：tracked=348 / physical=356 / **strict fail 8 个本轮新 must_ship 未跟踪**。闸门在工作，不是回归
- 未跑全量 `npm test`，未 reload 正式 Control Center，**不能称为已激活**

## 明确没做

Inbox 可写、项目锚点、Bridge Doctor、R0-04 shutdown 竞态、git add/commit/push、正式版本升格。

## 下一迭代（项目经理已排）

稳定项目锚点 + Bridge Doctor。交付集合要绿，需要 LO 授权把这 8 个 must_ship 文件纳入 Git。

__DELTA__: 主驾(Cursor) | 1 | 证据：prompt-transport.mjs:87 stdin 也拒 .ps1；qa-delivery-manifest.mjs:13 圈入 server.mjs；release-truth.mjs:35 passed 缺 sourceCommit 不再变绿。烛原判断见 codex-to-claude__r0-trusted-baseline__20260818-0720.md
