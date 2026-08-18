---
from: 烛(codex-reviewer)
to: claude
topic: r0-trusted-baseline
mode: standard+security
date: 2026-08-18
time: 07:20
scope: R0-01 Unicode transport / R0-02 delivery set / R0-03 releaseTruth
codex_channel: cursor-subagent-readonly
threadId: null
note: 无 codex-agent MCP；本轮为烛 subagent 只读评审，不伪装对话桥连续。
---
<!-- 514cc-session-id: 2e5d4b63-9955-451a-96d9-ddc4ffedee71 -->
# Codex 评审：R0 可信发布基线

- **评审模式**：standard + security
- **评审范围**：R0-01 prompt-transport / process-runner / remote-run / adapters / orchestrator；R0-02 delivery-ownership / qa-delivery-manifest / CI；R0-03 release-truth / workflow-state / app.pid+startedAt / server collectReleaseTruth / environment-panel；20260815 state.json
- **评审时间**：2026-08-18 07:20
- **Codex 模型**：Cursor Grok 4.6（烛 subagent，只读）
- **总 token**：n/a（未走 Codex CLI）
- **批准边界**：只评 R0-01 → R0-02 → R0-03。不建议 Inbox 可写、Bridge Doctor、R0-04 shutdown、正式版本升格。

---

## 致命问题（必须改）

本轮已接线路径上，没有发现会直接让 R0-01/02/03 合同失效的必须改缺陷。

主驾五条判断全部成立，未被推翻。下面的条目是补强，不是改判。

---

## 建议改进（值得讨论）

1. **argv 闸门挡不住 stdin 席位走 powershell.exe -File。** `assertArgvTransportSafe` 只在 `transport === "argv"` 时触发（`apps/control-center/src/prompt-transport.mjs:87-88`，闸本体 `48:63:apps/control-center/src/prompt-transport.mjs`）。Claude / Gemini / Codex exec 都是 `transport: "stdin"`（`132:134:apps/control-center/src/adapters/claude-cli.mjs`，`47:49:apps/control-center/src/adapters/gemini-cli.mjs`，`70:72:apps/control-center/src/adapters/codex-cli.mjs`），而 `resolveCommand` 在同目录没有 `.exe` 时仍会把命令收成 `powershell.exe -File *.ps1`（`314:319:apps/control-center/src/process-runner.mjs`）。opencode/codex 有原生 exe 偏置，claude/gemini 没有。主驾判断 1 对 argv 根因是对的；stdin 席位若撞上会把 `$input` 当 PowerShell 字符串读的 npm 跳板，中文仍可能变 `?`，且 R0-01 不会抛 `PROMPT_TRANSPORT_UNSAFE`。补强：stdin + win32 + non-ASCII 也应拒绝 `.ps1`，或给 claude/gemini 补与 codex 同级的 native exe 解析。

2. **Windows 测试没有实证「中文 → `?`」。** `120:141:apps/control-center/tests/prompt-transport.test.mjs` 只对 ASCII 走了 `powershell.exe -File`，对中文只断言 `sealPromptTransport` 抛错。根因判断 1 方向正确、与 PowerShell 5.1 `-File` 重编码行为一致，但 CI 没有锁住「乱码形态」。以后若根因其实是 console CP / `.cmd` / 别的编码器，这组测试仍会绿。

3. **`hasNonAscii` 漏掉补充平面。** `CJK_OR_SYMBOL = /[\u0080-\uFFFF]/u`（`8:8:apps/control-center/src/prompt-transport.mjs`）看不到 U+10000 以上（部分 CJK 扩展、部分 emoji）。BMP 中文没问题；稀有码点会让 `.ps1` argv 闸失灵。应改成 `/[^\u0000-\u007F]/u`。

4. **交付闸门没圈住 `server.mjs`。** `DEFAULT_FOCUS_PATHS`（`13:21:apps/control-center/scripts/qa-delivery-manifest.mjs`）和 ownership 规则（`14:22:apps/control-center/delivery-ownership.json`）只覆盖 `src/**`、`public/**`、`tests/**`、`scripts/**`、若干配置和 `*.md`。R0-03 把 `collectReleaseTruth` 接到 `/api/workbench/environment` 与 `/api/release-truth` 的文件是 `990:1020:apps/control-center/server.mjs`，它不在 focus、也不匹配任何 `must_ship` 规则。主驾判断 4 对「focus 内新 must_ship 未 git add → `--strict` 失败」成立；闸门绿不能代表 releaseTruth HTTP 接线已入交付集合。补一行 `apps/control-center/server.mjs`（或 `apps/control-center/*.mjs`）即可，不必扩 R0 范围。

5. **`status: "passed"` 但没有 `sourceCommit` 时，consistency 会变绿。** `35:39:apps/control-center/src/release-truth.mjs`：证据缺 `sourceCommit` 时跳过 mismatch，只要 `status === "passed"` 就返回 `consistent`。`activationClaim` 仍会因 `matchesSource === false` 拒绝「已激活」（`49:50:apps/control-center/src/release-truth.mjs`），但 UI 标题/圆点吃的是 consistency（`160:175:apps/control-center/public/environment-panel.js`），会显示「运行态 consistent」。当前 `server.mjs:990-998` / `1012-1020` 未传 `validationEvidence`，活路径仍是 unknown/stale，判断 3 成立。分类器应要求「passed 且 sourceCommit 对齐」才给 consistent。

6. **「未 reload 不能声称已激活」靠的是省略证据，不是代际互锁。** `app.mjs:399-400` 暴露了 `pid` / `startedAt`，`collectReleaseTruth` 记了 `runtimeGeneration`（`86:89:apps/control-center/src/release-truth.mjs`），但 `classifyReleaseConsistency` 只检查「有没有 generation」，不证明这代进程加载了当前提交。判断 5 对当前调用点成立（无 `validationEvidence` → 不能 claimed）。以后一旦有人塞 `{status:"passed", sourceCommit: HEAD}`，未 reload 的旧进程也会变绿。这不是要做 R0-04，只是不要把「省略证据」误读成「reload 硬闸」。

7. **`isPromptTransportError` 收了泛化的 `PROVIDER_ERROR`。** `135:136:apps/control-center/src/prompt-transport.mjs` 加上 `orchestrator.mjs:1075`：任何 `code === "PROVIDER_ERROR"` 都会让 `requiresRecovery` 直接 false。本轮只有 seal 的类型/NUL/未知 transport 用这个码，没有碰撞。若后续模块复用同码，已有 `resumeClaim` 的 run 会被降成 `failed` 而不是 `recovery_required`。传输错误不该自动重放（判断正确）；不该顺便抹掉既有恢复义务。

8. **audit emit 失败被吞掉。** `122:130:apps/control-center/src/prompt-transport.mjs` 的 `.catch(() => {})` 是为了不停 turn/start，正确。代价是 `prompt.transport` 审计可以无声消失。seal 本身仍是同步 fail-closed，不是正确性回归。

---

## 可保留（看似奇怪但合理）

1. **`preparePromptTransport` 不得 await emit。** `123:124:apps/control-center/src/prompt-transport.mjs` 注释与实现一致。`858:858:apps/control-center/tests/adapters.test.mjs` 的 EventStore 是 `emit: async () => new Promise(() => {})`；若这里 await，`1140:1154:apps/control-center/src/adapters/codex-app-server.mjs` 会在 `turn/start` 前挂死。判断 2 成立。`pi-rpc.mjs:358-367` 同样是 seal 之后才 `commandRequest`。

2. **传输错误不进自动恢复。** `1073:1075:apps/control-center/src/orchestrator.mjs` + `22:24:apps/control-center/src/orchestrator.mjs`。`.ps1` / 损坏 / NUL 再重放只会重复失败。`failureClass = provider_error` 足够。

3. **Claude / Gemini `promptMode: "stdin"`。** `45:45:apps/control-center/src/adapters/manifest.mjs`、`97:97:apps/control-center/src/adapters/manifest.mjs`。Claude 的 `-p` 是 print/pipe，prompt 走 `input:`（`141:143:apps/control-center/src/adapters/claude-cli.mjs`）；Gemini 用空 `--prompt` + stdin（`11:12:apps/control-center/src/adapters/gemini-cli.mjs`）。这是避开 Windows argv 重编码的正确席位合同，不是漏标。

4. **Kimi / Grok / OpenCode 继续走 argv。** `19:19:apps/control-center/src/adapters/kimi-cli.mjs`、`30:30:apps/control-center/src/adapters/grok-build.mjs`、`50:50:apps/control-center/src/adapters/opencode-cli.mjs`。native exe + CreateProcessW 对 UTF-16 argv 是安全的；`.ps1` 会被 seal 拒绝。24k 长度上限是 Windows 命令行限制，不是编码回退。

5. **子进程环境钉死 UTF-8 标志。** `390:395:apps/control-center/src/process-runner.mjs`。`LANG`/`LC_ALL`/`PYTHONUTF8` 不改 Windows 控制台代码页，也不放宽密钥白名单。对 Python/部分 Unix 向 CLI 有用；对 native exe 无害。

6. **SSH 单引号 + 本地往返。** `34:60:apps/control-center/src/ssh/remote-run.mjs`。`shQuote`/`shUnquote`/`assertRemoteArgvUtf8` 在拼 `setsid` 命令行之前就 fail-closed。本地密钥不随 env 出机（`243:243:apps/control-center/src/ssh/remote-run.mjs`）。argv-over-SSH 的 prompt 会出现在远端 `ps` 里——这是 argv 运输的固有面，不是 R0 新洞。

7. **生产路径不调用 `assertEchoMatches`。** 该函数只服务测试（`102:107:apps/control-center/src/prompt-transport.mjs`，`106:116:apps/control-center/tests/prompt-transport.test.mjs`）。R0-01 的合同是「已知不安全路径先封死」，不是端到端回显。对 native CreateProcessW / JSONL UTF-8 写盘，这个取舍成立。

8. **`formalRelease: false`。** `6:6:apps/control-center/delivery-ownership.json`。R0 切口，正式版仍停在 v3.5.0。CI `qa:delivery --strict`（`.github/workflows/control-center-ci.yml:52-53`）只闸交付集合，不升版本。

9. **活 API 不传 `validationEvidence`。** `990:998:apps/control-center/server.mjs`、`1011:1020:apps/control-center/server.mjs`。`normalizeEvidence(null)` → `status: "unknown"`（`17:19:apps/control-center/src/release-truth.mjs`）→ consistency 为 unknown，或 dirty 时 stale（`34:38:apps/control-center/src/release-truth.mjs`）。`activation.claimed` 为 false。判断 3、5 被这条调用约定钉住。`11:19:apps/control-center/tests/release-truth.test.mjs` 锁了「无当轮证据不能绿」。

10. **20260815 workflow 已 superseded。** `.workflow/ultracode/collab-console-review-20260815/state.json:6` `status: "superseded"`，packets 与 verification 同步关闭，`successor: r0-trusted-baseline-20260818`。`closeStaleWorkflow`（`36:61:apps/control-center/src/workflow-state.mjs`）的语义与落盘一致。

11. **环境面板转义 consistency / activation 文本。** `160:175:apps/control-center/public/environment-panel.js` 走 `escapeHtml`，缺省文案是「没有当轮 readback，不能称为已激活」。面板信任服务端投影，不在浏览器里自己点绿。

---

## 总评

R0-01 / R0-02 / R0-03 在已批准边界内是一套能看懂、能闸住的基线：Windows `.ps1` argv 先封死，native exe / stdin / JSONL 走 CreateProcessW 或管道；交付 `--strict` 对 focus 内 must_ship 未入 Git 会红；运行态在没有当轮 `validationEvidence` 时不能 claimed，脏树只能 stale。20260815 审查波次已关掉，不会被当成当前工作。

主驾五条独立复核结果：

| # | 判断 | 烛的结论 |
|---|---|---|
| 1 | `.ps1` + `powershell.exe -File` 是中文变 `?` 的 argv 根因；native exe + CreateProcessW 安全 | 成立。补强：CI 未实证乱码；stdin 席位未闸 `.ps1` |
| 2 | `preparePromptTransport` 必须 fire-and-forget emit | 成立。证据：`adapters.test.mjs:858` 永不结束的 emit |
| 3 | 无当轮证据时 consistency = unknown，或 dirty 时 stale；不能变绿或声称已激活 | 对活路径成立。补强：分类器在 `passed` 缺 `sourceCommit` 时会给 consistent |
| 4 | `qa:delivery --strict` 因新 must_ship 未 add 而失败是闸门在工作 | 对 focus 内文件成立。补强：`server.mjs` 不在闸门里 |
| 5 | 正式进程未 reload 不能声称已激活 | 对当前调用点成立。机制是省略 `validationEvidence`，不是 pid/generation 互锁 |

不建议把 Inbox 可写、Bridge Doctor、R0-04 shutdown、正式升格塞进本轮。若只收一条后续：把 `server.mjs` 推进 delivery focus，并让 stdin 席位与 argv 一样拒绝 `.ps1`。

---

## 下游建议

### 建议召唤
无。本轮不扩 R0，不需要策/织。

### 风险信号
- 活 Control Center 未 reload：环境面板应显示 unknown/stale + 「不能称为已激活」。若出现 consistent / 「已对账」，就是有人后塞了 `validationEvidence` 或分类器被改松。
- `qa:delivery --strict` 在 focus 内 must_ship 未 add 时必须继续红。把它当回归是误判。

__VERDICT__: APPROVED
__DELTA__: 烛(Codex) | 1 | 证据：apps/control-center/scripts/qa-delivery-manifest.mjs:13 补强交付闸门未圈住 server.mjs；prompt-transport.mjs:87 stdin 席位不走 .ps1 闸
