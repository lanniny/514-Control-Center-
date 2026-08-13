# v41 远程 agent 工作区设计（远程项目 ≠ 终端，是完整 agent 运行面）

> 2026-08-11 · 烛 · LO 指令：「不止是进入终端……一样是需要建立会话等等类似于 codex，只是远程连接了其目录和系统；远程主机界面要有类似配置图谱的远程探测和设置，连接的服务器可以远程检测配置和安装 CLI，并且设置一键同步本机配置的按键；协作台上还是按照团队类型进行操作配置。」

## 1. 目标与非目标

**目标**：远程项目（remote-projects 台账的 `{hostId, path}`）成为一等运行位置——在其下新建的会话/run 由远端主机上的 CLI 执行（cwd=远端路径），事件流/审批/取消体验与本机 run 一致；远程主机界面升级为「探测 + 环境治理」（OS/CLI 矩阵探测、远程安装 CLI、一键同步本机配置）。

**非目标**：不做远端常驻守护进程（无 514cc-agent 远端服务，SSH 是唯一通道）；不动团队模型（teamId 语义与本地 run 完全一致，远程只是运行位置维度）；不改变本地 run 的任何既有行为。

## 2. 全链路架构

```
协作台 composer（远程项目上下文，团队选择器照旧）
  └─ POST /api/runs { prompt, teamId, remote: { hostId, path } }     ← 取代 cwd
      └─ orchestrator：remote 分支（跳过本机 isAbsolute/stat，远端探针校验路径）
          └─ adapter.spawnImpl 注入 = remoteSpawn(hostId, remotePath)
              └─ ssh2 openExecChannel(`cd '<path>' && exec <cli> <args>`)   ← 新 streaming 封装
                  ├─ stdin  ◀── prompt / JSON-RPC 上行 / 审批响应
                  └─ stdout ──▶ 行 JSON / JSONL（原协议字节，零 scrub 零截断）
```

**关键事实（调查实证）**：adapter 构造器已预留 `spawnImpl`/`runProcessImpl` 注入点（codex-app-server.mjs:234、pi-rpc.mjs:85、kimi/opencode 的 runProcessImpl）；CLI 协议全是 stdio 行 JSON/JSON-RPC，**对 SSH 桥接透明**；codex app-server 的交互审批就是 stdio 内的 JSON-RPC 请求-响应（APPROVAL_METHODS，codex-app-server.mjs:54-60），忠实管道即可原样工作。

## 3. 核心设计决策

### 3.1 传输层：新 streaming channel，不复用现有 exec

现有 `ssh.mjs exec()` 四硬伤：120s 硬顶、256KB 截断、无 stdin 写、scrub 改写协议字节。新增：

```
ssh.openRunChannel(hostId, remotePath, commandLine, { onData, onClose, signal })
  → { write(chunk), close(), remoteKill() }
```

- `client.exec("cd '<path>' && exec <cmd>")`，ChannelStream 当全双工 pipe：无 cap、无 scrub、无硬超时（看门狗沿用 adapter 既有 idle/turn 闸）。
- 远端命令组装复用 `sanitizeRemotePath` 校验 + 单引号 `'\''` 转义（pty/routes.mjs 先例）。
- 门闸：`ssh` 闸 + run 创建既有审批语义。

### 3.2 取消语义（最易留孤儿的地方）

- codex app-server / pi：协议内 `turn/interrupt` / `{type:"abort"}` —— 天然安全，优先。
- spawn 型（claude/kimi/grok/codex-exec…）：本地 `taskkill /T` 够不到远端。远端命令包 `setsid` 记 pgid，取消时另开短 exec `pkill -TERM -g <pgid>`（超时补 `pkill -KILL`）；channel 关闭仅作兜底。
- 重启重述：控制面重启后远端在途 turn 一律 `recovery_required`（沿用既有重启语义），不假装能重连远端 stdio。

### 3.3 cwd 与本机路径语义圈

- `orchestrator.mjs:1436-1452` 校验：remote 分支跳过本机校验，改探针 exec `test -d '<path>' && printf ok` 远端校验（建 run 时一次，失败 422 INVALID_REMOTE_PATH）。
- `run-workspace.mjs` / `run-diff.mjs` / worktree 链（orchestrator.mjs:2325-2357）全是本机 fs+git：**远程 run 首波禁用 build worktree 隔离**（如实标记 `workspaceIsolation: "remote-unsupported"`），diff 展示依赖 agent 协议自带 fileChange 事件（codex progress 载荷本就有 `changes[{path,kind,diff}]`），不依赖本地 git。
- build 审批哈希（orchestrator.mjs:880-882）workspace 字段对远程 run 用 `ssh://<hostId><path>` 规范化串，保持哈希口径稳定。

### 3.4 env / 凭据策略

远端 CLI 的 provider 密钥**不经命令行/env 传递**（命令行会被远端 `ps` 看见），走「一键同步配置」预推送的运行时文件（§4.3）。远端 CLI 用自己的配置文件/登录态。`childProcessEnv` 白名单裁剪仅本机语义，远程 spawn 不注入本地密钥。

### 3.5 会话归属

远程 run 的原生 CLI 会话文件在远端（远端 `~/.claude/projects` 等），本地扫描投影（sessions.mjs）看不到。首波：远程项目节点下展示 **514cc run 台账**（本机 eventStore 的 runs，含远端 sessionId），resume 走 run 台账持久化的 sessionId（`--resume`/`thread/resume` 参数照常），不扫远端会话库。远端历史浏览留后续波。

## 4. 远程主机面（配置图谱式）

### 4.1 聚合探测 `POST /api/ssh/hosts/:id/probe`

一条 shell 脚本跑完（health.mjs:167 探针风暴教训：禁止 N 并发 channel）：
- `uname -srm`、`$SHELL`、`$HOME`、`df -h /`、`free -h`（存在性守卫，BSD/proc 差异容忍）；
- CLI 矩阵：复用 `cli-env.mjs CLI_TOOLS` 清单（11 项纯数据），`command -v <cmd>` + `<cmd> --version`（逐项 timeout 守卫），判读逻辑（ENOENT/exit/版本正则）与本地同源；
- 返回 `{ os, shell, home, disk, memory, clis: [{id,label,installed,version,command}] }`。latest 版本对比留本机侧（fetchLatest 不上远端）。

### 4.2 远程安装 `POST /api/ssh/hosts/:id/install-cli { toolId }`

`installSpec(tool, platform)`（cli-env.mjs:107 已平台参数化）生成命令 → exec 执行（npm i -g / pip / curl 脚本）。执行输出如实回显（code/stdout/stderr），不伪造成功。写操作：前端确认对话框明示命令全文。

### 4.3 一键同步 `POST /api/ssh/hosts/:id/sync-config`

- 数据源：**本机运行时实况文件**（不是 providers 投影预览——标记块外科手术语义在远端无法等价重放，整文件同步语义最诚实）：
  `~/.codex/config.toml`、`~/.codex/AGENTS.md`（存在才推）、`~/.kimi-code/config.toml`、`~/.claude/settings.json`。
- **凭据文件默认不推**（auth.json / .env / secrets 台账），远端 CLI 用各自登录态。
- 安全闸：服务端推送前用 redaction 高熵模式扫描内容，命中标 `containsSecrets`；前端确认框列出文件清单+大小+secret 红字警示，显式确认才执行。
- 执行：`exec mkdir -p` 建父目录（sftpWrite 不建目录）→ `sftpWrite` 逐文件推送（默认围栏 [home, /tmp] 覆盖 ~/.codex 等）→ 逐文件回报 ok/失败原因。

### 4.4 远程项目三面图谱（波六）

远程主机图谱只描述 `$HOME` 级运行环境；远程项目还必须表达项目目录里的覆盖层。配置目标因此固定为三类：本机、SSH 主机、远程项目 `{projectId -> hostId,path}`。项目目标沿用相同三个工作面，但数据口径是“主机级实况 + 项目级覆盖”：

- **供应商与应用**：主机 live 配置叠加项目 `.claude/settings*.json`、`.codex/config.toml`，项目行显式标记 scope；
- **Agent·Skill·MCP**：同时浅扫描主机和项目的 `.claude/{agents,skills,commands}`、`.codex/prompts`、`.agents/skills`，并读取项目 `.mcp.json`；
- **运行席位与真源**：CLI 探测仍是主机级，真源追加项目 `AGENTS.md`、`CLAUDE.md`、`rules.md`、`.ai-shared/{context,decisions}.md`、`module.yaml` 等白名单文件。

安全与所有权：前端只提交 remote-project id 和真源 file id；`/api/remote-projects/:id/graph[/source]` 在服务端台账解析 host/path，叠加 `ssh + sftp` 双门闸，项目路径再次通过该主机 `rootAllowlist`。图谱缓存键固定为 `host:<id>` / `project:<id>`，慢主机响应只能写回自己的缓存，不能覆盖已切换的项目目标。

## 5. 分波计划

| 波 | 内容 | 风险 |
|---|---|---|
| **波一（本波）** | §4 全部：远程探测 / CLI 安装 / 一键同步；主机面 UI（行内展开卡 + ⋯菜单新项） | 低：纯增量，不动 run 链路 |
| 波二 | §3.1-3.4：openRunChannel + remoteSpawn 注入 + orchestrator remote cwd 分支 + composer 远程项目提交（首发 codex app-server + spawn 型 CLI；build worktree 禁用如实标注） | 中：动 orchestrator，全程契约测试 |
| 波三 | §3.5 打磨：远程项目下 run 列表/resume 体验、远端文件变更视图、远程项目 SFTP 快显 | 低 |
| **波六** | §4.4：远程项目成为独立三面图谱目标；项目配置/能力/MCP/真源叠加；项目 id 服务端解析与 latest-wins | 中：读远端项目文件，必须双门闸与路径围栏 |

## 6. 安全边界汇总

- 门闸复用：probe/install/sync 全走 `ssh` 闸（sftp 写叠加 `sftp` 闸），未授权 501 如实引导。
- sync-config 是唯一让本机秘密出机的通道：双确认（对话框文件清单 + containsSecrets 警示），凭据文件不进默认清单。
- 远程杀进程只发 TERM/KILL 到自己 setsid 的 pgid，不宽泛 pkill 模式串（防误杀远端他进程）。
- exec 探针全部只读；install/sync 写操作前端必须显式确认，审计事件走既有 eventStore。
