<!-- 514cc-session-id: 64adc88e-974f-4b70-aac5-e98599fea288 -->
# 远端真源安全网（配置图谱续波）

## 任务与判定

- LO：「接着 codex 的任务继续完善配置图谱」。起点＝`codex-to-claude__remote-config-workbench-parity__20260812-0446.md`（远程主机/项目已与本机三面同构）。
- 逐面对照后确认的**不对称**：远端写盘风险高于本机（跨网络、提交可能不确定），安全网却比本机少两道——
  - 本机有 `预览变更`(plan/diff) + 版本记录/历史对比/回滚（`/api/config/:id/versions`）；
  - 远端保存直接覆盖，且发布备份（`remote-graph.mjs` 的 `.514forge-backup-<txid>`）虽已存在、已被 inventory 扫到，UI 只列出文件名，不能看、不能恢复。
- LO 选定杠杆点＝**远端真源安全网**（diff 预览 + 备份时间线 + 服务端原文恢复）。

## 本波先修的一条数据损坏缺口（实证，非推演）

`readSource` 旧判定 `editable = file.editable && !sensitive && !truncated`，其中 `sensitive` 来自 `findSecretCandidates`，它对赋值型秘密有 **12 字符门槛**（`src/redaction.mjs:230`）；而返回内容走 `scrub`，`redactAssignment` **无长度门槛**（`src/redaction.mjs:166`）。

实测（`node -e` 直调 redaction）：

| 原文 | findSecretCandidates | scrub 改写 |
|---|---|---|
| `token: short` | 0（放行） | ✅ 改成 `token: [REDACTED]` |
| `api_key: abc123` | 0（放行） | ✅ 改成 `[REDACTED]` |
| `token = "opaque-value"` | 1（拦住） | ✅ |

⟹ 一个写在 AGENTS.md / rules.md / context.md 里的短值示例，会让文件既被脱敏、又被判为可编辑：LO 改别处后保存，`[REDACTED]` 就被写回远端真源，原值永久丢失（仅剩备份可救）。全部 editable 真源都是这类文档，写配置示例是常态。

修法是抽契约而不是追模式（对齐 `contract-driven-over-patching` 教训）：

> **INV-BK1**：`editable === true` ⟹ 返回的 `content` 与远端 raw 字节完全一致。凡 `scrub` 改写过（新增 `redacted` 字段）一律降级只读。

这条同时让差异预览的基线诚实——editable 文件的 diff 基线就是远端字节，不是脱敏投影。

## 落地

### 后端 `src/ssh/remote-graph.mjs`

1. `readSource`：新增 `redacted`，`editable` 增加 `!redacted`（INV-BK1）。只读分支在 UI 上如实说明原因。
2. `backupRemotePath()`（**INV-BK2**）：客户端只提交备份**文件名**，路径由服务端在真源 canonical 父目录下拼装；名字必须严格是 `<canonical basename>.514forge-backup-<token>`，token 形状 `[\w-]{1,64}`（与 `parseInventory` 识别口径一致，故 UI 列出的备份都能读）。`[\w-]` 不含分隔符与点，穿越与跨真源伪造在词法层不可能。
3. `readBackupRaw()` / `readBackup()`（**INV-BK3**）：原文只在服务端流转，HTTP 面只拿 `scrub` 投影 + 原文 digest + `restorable`。凭据载体（`contentPolicy: hidden`）的备份 403 不出机；备份单独 `test ! -L` 拒绝 symlink（被换成指向 `~/.ssh/*` 的链接时，读会外泄、恢复会把他人内容写进真源），缺失 404。
4. `restoreBackup()`（**INV-BK4**）：恢复 = 用备份原文再跑一次 `writeSource`——CAS、锁、原子发布、恢复台账全部继承，**且这次发布同样为"恢复前的内容"留下新备份，所以恢复本身仍可回滚**。截断（>1MB 读取上限）→ `GRAPH_BACKUP_TRUNCATED` 409（否则就是用截断内容覆盖真源）；含凭据 → `GRAPH_BACKUP_SENSITIVE` 403。零新增写通道。

### 路由（ssh + sftp 双门闸）

- `src/ssh/routes.mjs`：`GET .../graph/backup`、`POST .../graph/backup/restore`（走 `runRegisteredRemoteWrite` 注册 graph 事务，`recoveryRequired` 照旧透传，emit `remote.source_restore`）。
- `src/remote-projects/routes.mjs`：项目侧同构；host/path 由服务端台账解析，客户端只给 project id + 备份名。

### 前端

- `public/app.js`：复用既有 `createLocalDiff`/`diffMarkup` 做统一差异视图；editable 真源加「预览变更」（基线＝打开时的远端原文）；`config-source-content` 内新增**发布备份时间线**（按 `sourceId` 过滤，倒序），每行 `[对比]`（差异按"恢复方向"呈现：`-` 会失去、`+` 会回来）与 `[恢复]`；恢复走危险确认（远端路径/备份时间/大小/digest/可回滚/草稿将丢弃全部字面列出）+ `configRemoteWriteBlocked` 门禁 + 失败记 recovery。确认对话是异步窗口，确认后重取 digest 严格比对才提交。
- `public/state.js`：`configRemoteSourceDiffs` / `configRemoteBackupCompare` / `configRemoteBackupCache` 全部按 `targetKey` 隔离，慢响应只写回自己的键。
- `public/styles.css`：时间线/差异样式 + 390px（备份动作整宽换行，避免横向溢出）。

### 顺手修掉的既有债：7 处空白图标

`#lucide-*` 引用里有 7 个不在离线 sprite 中（CSP 下无 CDN 兜底，`LEGACY_ICON_MAP` 只重映射 `icon-*` 旧前缀，故无运行时兜底）——其中 4 处就在配置图谱远程面：`chart-no-axes-combined`(健康仪表盘标题) / `file-search`(打开真源 ×2) / `file-cog`(同步文件行) / `file-code-2`(高级真源 tab，本机+远端) / `inbox`(空态) / `power`(设为当前团队)。已全部换成 sprite 内真实图标（`gauge`/`scan-search`/`file-input`/`file-json`/`archive`/`plug-zap`）。

根治而非这次修完下次再漏：新增 `tests/lucide-sprite-contract.test.mjs`——public 下每个写死的 `#lucide-*` 必须在 sprite 里有 symbol。空白图标从不让测试变红，只能靠人眼撞见；这条把它变成机械红灯。

## 验证（当轮实测，非记忆）

- 新增单元/路由回归：`tests/remote-graph.test.mjs` +4（脱敏漂移只读 / 备份名绑定与伪造·穿越·symlink·缺失·hidden 拒绝 / 恢复复用事务且写原文 / ssh 侧双门闸与参数传递）、`tests/remote-projects.test.mjs` +2（项目侧备份读取台账解析、未知项目 404）。
- **元验收（防假基线）**：把 `editable` 打回旧逻辑 → 脱敏漂移测试 `fail 1`；还原 → `pass 1`，文件锚点复原。图标契约同样验证：注入一个不存在的图标 → `fail 1`，移除 → `pass 1`，无残留。
- 相关组：`remote-graph` + `remote-projects` + `config-topology-{ui,state}` + `recovery-ledger` + `remote-config` + `remote-gates` → **114 tests / 114 pass / 0 fail**。
- 浏览器 QA：`npm run qa:remote-config` → **`ok: true`**。新检查 `sourceDiffPreview` / `backupCompare`（打到 `/api/ssh/hosts/host-a/graph/backup`）/ `backupRestoreEnabled` / `backupRestore`——恢复请求体实测为 `{path:"/api/remote-projects/project-b/graph/backup/restore", file, name, digest}`，**无 content 字段**，INV-BK3 在真实浏览器端到端验住。
- `npm run validate` → 13/13 `valid: true`，0 false。
- 全量 `npm test` → **1028 tests / 1025 pass / 2 fail / 1 skip**（2 条失败为既有腐烂，见下）。
- `node --check` 覆盖本轮全部改动文件，exit 0。

## 如实记录的三条既有问题（不是本波造成）

1. **`tests/remote-graph.test.mjs` 的 `graph/graph-source 双门闸` 原为红灯**：fixture 硬编码 `transactionId: "tx-graph"`，撞上恢复台账的身份校验（`recovery-ledger.mjs:313` `REMOTE_RECOVERY_IDENTITY_MISMATCH` 502）。已绕开路由层单独复现根因确认与路由无关。因为它挡住"全绿基线"，本波按真实契约修正：fixture 回传服务端生成的 `transactionId`，断言改为校验 uuid 形状 + `recoveryRequired`。
2. **`npm run qa:remote-config` 在当前磁盘状态下原本跑不到发布那步**：QA 未 mock `/api/ssh/hosts/recoveries`，请求落到真 server 撞未授权 ssh 门闸 → 账本不可读 → 前端按设计 fail-closed 阻断**全部**远端写入。前端行为正确，缺口在 QA。已补空账本 mock（`loadConfigRemoteRecoveries` 只清 `serverPersisted` 记录，本地 remember 的证据不受影响，后续 `recoveryBanner` 检查照旧成立）。⚠️ 这意味着上一份 handoff 的 `qa:remote-config → ok: true` 在当前代码上不可复现。
3. **`tests/team-workspace-ui.test.mjs` 2 条失败（本波未修）**：断言 app.js 含单行 `!configIsDirty() && !teamFormDirty[...]`，但 `app.js:1436-1439` 已被重构为多行 `||` 正逻辑且含 `configRemoteDirtyDraftCount()`（即远程配置波次自己引入的）。语义等价，源码正则腐烂。该测试文件 `git diff HEAD` 为空、本波从未写过 `teamFormDirty`。属 team-workspace 波次范围，未擅自改动别人正在推进的契约——建议由该波次或经 LO 授权后按新写法更新正则。

## 边界

- 未 commit、未 push、未同步用户运行时；未对任何真实远端主机执行读写（全部证据来自单元 fixture 与隔离 Chromium mock）。
- 工作树含 Kimi/Codex 多轮未提交改动，本波未 reset、未清理、未替他人造绿。
- **本波为主驾直达，未召唤外部 agent**，因此没有发火 DELTA 账本行。但按 `rules.md` §三，改动落在远端写入路径与脱敏判定上＝🔴 安全敏感，同一个模型有同一套盲区（尤其我自己写的安全代码）——建议由烛（Codex，read-only profile）做独立复核，重点核 INV-BK2 的名字绑定能否绕过、INV-BK3 恢复原文是否真的不出服务端、以及 `restoreBackup` 复用 `writeSource` 后恢复台账语义有无缝隙。未擅自发起，等 LO 一句话。
- 备份无清理/保留策略（每次保存与恢复各留一份，会累积）。本波未做，UI 亦未伪称有——留作后续。
