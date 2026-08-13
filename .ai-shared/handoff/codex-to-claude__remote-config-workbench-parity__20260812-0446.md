<!-- 514cc-session-id: 019ff160-7e58-77c2-acc5-25e3162daff6 -->
# 远程配置工作台同构交付

## 目标与状态

远程主机和远程项目选中后完整复用本机配置图谱的三个工作面：

1. 供应商与应用
2. Agent · Skill · MCP
3. 运行席位与真源

实现、专项回归、全量回归、隔离 Chromium QA、安全对抗复核和桌面运行态重启回读均已完成。真实主机 `lanniny-45` 和远程项目 `new-api` 未执行发布、保存、安装或同步。

## 实现

- `apps/control-center/public/app.js`：远端供应商面保留九应用标签、live 配置行、Provider 档案和发布入口，并在顶部加入真实主机健康仪表盘；能力面按本机结构重排为 Agent 花名册、Skill 检测矩阵、MCP 表格；运行面按本机结构重排为健康总览、运行席位/高级真源分段、CLI 席位目录与详情编辑区。
- `apps/control-center/public/state.js`：应用标签、工作台页、图谱缓存、真源缓存、运行模式和所选 CLI 均按 `host:<id>` / `project:<id>` 隔离；主机指标历史最多保留当前页面生命周期内 24 个真实刷新样本，不预填虚构趋势。
- `apps/control-center/src/ssh/remote-graph.mjs`：主机与项目图谱、稳定 `sourceId`、单次 raw 读取派生 content/digest/sensitive、凭据载体硬隐藏、真源 CAS/备份/0600 临时文件/原子发布。
- `apps/control-center/src/ssh/remote-config.mjs`：Provider 发布使用发布时 SHA-256 CAS、最终 symlink 拒绝、`wx` 私有临时文件、staged digest 校验和原子替换；多文件失败只回滚仍等于本事务发布值的文件。
- `apps/control-center/src/ssh/remote-ops.mjs`：只读探针新增 CPU、内存、根磁盘、1/5/15 分钟负载、在线时长、进程数和网络累计字节；Linux 优先读取 `/proc` 与 `df`，缺失或异常值返回 `null`，不猜测。环境同步原有临时文件、CAS、备份、staged digest、原子发布与有条件回滚语义保持不变。
- `apps/control-center/src/ssh.mjs`：SSH exec 超时关闭 channel、销毁并丢弃池化连接；SFTP 创建时直接使用 `0600`，事务临时文件支持 `wx`。
- `apps/control-center/src/ssh/routes.mjs`、`apps/control-center/src/remote-projects/routes.mjs`：主机与项目图谱、Provider plan/apply、真源读写均绑定 SSH + SFTP 门闸；`recoveryRequired` 透传 HTTP。
- 保存期间仍允许继续编辑；旧保存响应只重基线到新 digest，不删除请求期间产生的新草稿。保存期间禁用重新载入，409 保留草稿。
- `apps/control-center/src/ssh/remote-graph.mjs` 能力扫描补入 `.codex/agents` 和 `.codex/skills`，主机与项目两层一致；未为没有稳定契约的 CLI 猜测目录。

## 本轮补强

### 致命问题

- 已修复：`apps/control-center/src/ssh/remote-graph.mjs:442` 原先未验证上传临时文件的 SHA-256，与 UI 的“digest 复核”承诺不一致。现发布前验证 staged digest，失败返回 `GRAPH_SOURCE_STAGING_MISMATCH`，并清理未发布临时文件。
- 已修复：`apps/control-center/src/ssh/remote-graph.mjs:117` 先规范化目标父目录，再保留最终路径分量参与 symlink 拒绝和原子发布，避免把已解析边界仅用于检查而继续操作词法路径。
- 已修复：初版健康仪表盘用内联 `style` 表示进度，真实 Chromium 被项目 CSP `style-src 'self'` 拦截。现改为 SVG `stroke-dasharray` 圆环和原生 `<progress>`，最终 QA 零 CSP/console 诊断。
- 已修复：环境同步原先只按 plan 的 `containsSecrets` 做 UI 二次确认，执行时重新读本机文件却不绑定内容。现 plan 返回 SHA-256 digest，apply 重读后严格比较、重新判敏，并仅对显式 `allowSecrets: true` 的同一 digest 放行；漂移或缺确认返回 409。
- 已修复：Provider 发布确认原先未绑定实际 apply。现 `planRevision` 覆盖 app、provider、目标、远端基线 digest 与发布内容 digest；主机/项目 apply 重建计划并严格比较，前端确认文案使用冻结目标 label，团队发布同样复用冻结快照。
- 已修复：远端 Provider/MCP 字段的敏感兜底原先使用不完整脱敏，且首轮修复在脱敏前 `slice(0, 200)`，独立复核用 190 字符 URL userinfo 成功绕过。现完整值先 `scrub`/判敏，再限制返回长度；长 userinfo 行为回归已补。

### 建议改进

- 已修复：环境同步回报中的远端可控 label/path/error 统一经 `escapeHtml()` 后进入日志。
- 已修复：能力/备份清单的远端文件名改为规范 base64 行协议，拒绝旧 `CAP|` 伪造与非法编码；远端缺 `base64` 时 inventory 明确 exit 79，由图谱返回 `REMOTE_GRAPH_FAILED`，不把能力伪装为空。
- 第一条安全复核支线因外部服务 `403 INSUFFICIENT_BALANCE` 失败，已如实保留；另一条独立只读复核实际返回 5 项 findings，并在两轮修复中推翻了“首轮脱敏已关闭”的判断。

### 可保留

- 写入超时保持 `*_COMMIT_UNKNOWN + recoveryRequired`，不做可能覆盖已提交结果的自动回滚。
- 凭据容器内容永不进入浏览器；其他文件只返回同一 raw 字节串派生的脱敏内容和 digest。
- 本机代理启停没有远端安全后端，远端界面没有伪造这一控制能力。

### 总评

远程主机与远程项目均已具备与本机一致的信息架构：供应商、Agent/Skill/MCP、运行席位/真源，并新增真实服务器健康总览。写入链的 CAS、临时文件完整性、回滚所有权和不确定提交语义没有因 UI 重构被放松。

最终独立只读终审：`APPROVED`。终审实际复现 190 字符长 URL userinfo，输出 `https://[REDACTED]@example.com/v1`；`tests/remote-graph.test.mjs` 独立运行 `17/17 pass`，未发现新增阻断。

## 验证

- 当前 UI/图谱/探针专项：`57 tests / 57 pass / 0 fail`。
- 全量：`954 tests / 953 pass / 0 fail / 1 explicit skip`。
- `npm run validate`：13 项全部 `valid: true`。
- `npm run qa:remote-config`：`ok: true`；五工作台页 `5/5`、资源子页 `6/6`、供应商单项发布、团队部分失败、Provider `planRevision` 绑定、Agent/Skill/MCP 同构、运行席位同构、真源 409 保留草稿、主机/项目状态隔离、graph latest-wins 全通过；桌面 Provider/能力/席位与 390px Provider/能力/真源六个 overflow 检查均为 `body=0`、`main=0`、`visibleControls=[]`，浏览器零诊断。
- QA 报告：`apps/control-center/.qa-output/remote-config/report.json`。
- QA 截图：`apps/control-center/.qa-output/remote-config/remote-host-desktop.png`、`remote-capabilities-desktop.png`、`remote-runtime-seats-desktop.png`、`remote-host-390.png`、`remote-capabilities-390.png`、`remote-source-editor-390.png`；当轮人工回读确认服务器仪表盘、能力三段和席位主从布局无空白、遮挡或超大图标。

## 真实桌面回读

- 2026-08-12 最终安全修复后重启：`cc-desktop.exe` PID `57232`，托管 Node PID `47936`，`127.0.0.1:51400`，窗口标题 `514 Forge · Control Center`，`Responding: true`，HTTP `200`。
- 本轮没有对真实主机再次执行 SSH 探针或浏览器自动化写操作；UI 与交互证据来自隔离 Chromium fixture，真实桌面证据限定为进程、窗口、端口与 HTTP 回读。

## 边界

- 工作树包含 Kimi/Claude/Codex 多轮未提交改动和大量未跟踪模块；本轮未 reset、未清理、未 commit、未 push、未同步用户运行时。
- 真实 `lanniny-45` 全程只读；未经 LO 针对具体写操作重新确认，不执行发布、保存、安装或同步。

__DELTA__: 烛(Codex) | 2 | 证据：独立复核先在 apps/control-center/src/ssh/remote-ops.mjs 与 remote-config.mjs 推翻“UI 已确认即可执行”，再用 190 字符 URL userinfo 推翻“首轮 safeField 脱敏已关闭”；现 digest/planRevision/完整值先脱敏均有行为回归，apps/control-center/.qa-output/remote-config/report.json 为 ok
