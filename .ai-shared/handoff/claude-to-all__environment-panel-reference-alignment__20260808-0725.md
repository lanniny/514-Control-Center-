<!-- 514cc-session-id: 8493be03-89d4-479c-a5c2-b19214bdcfdf -->
# 环境舱向参考图形态对齐（接 codex 环境舱与任务工具收口）

## 目标

LO 提供 Claude Code 桌面端「环境信息」面板参考图，要求在 codex 已收口的能力之上继续完善对应 UI。
本轮只做渲染层与交互层对齐，**不改动任何 Git 安全门、来源持久化或环境 API 投影**。

## 落地

- `public/environment-panel.js`
  - 主区按参考图重排：变更 → 本地 → 分支 → 提交或推送 → Pull Request。
  - 「本地」「分支」升级为可展开行（`data-environment-expand`），展开区为次要事实（目录 / 仓库根 / Git 可用性；HEAD / 上游 / 领先落后 / 冲突 / 远端）。展开态跨刷新保留，SSE 重绘不再把用户手动展开的行弹回去。
  - 刷新不再整屏替换成 loading：已有内容时只在变更行内联转圈（`environment-inline-spinner`），消除面板闪烁与滚动位置丢失。首次加载仍走整屏 loading。
  - diff 计数变为按钮，点击进入变更审阅（复用既有 `review` 分支）；刷新按钮从工作区行移到变更行 trail（原位置已变为展开按钮，button 不可嵌套）。
  - 提交 / 推送收成单行「提交或推送」，两个动作按钮保留各自 `data-environment-action` 与禁用原因 title。
  - 智能体分组新增运行中头像堆叠（`renderAgentAvatar` 注入，复用 CLI logo，缺失回落两字缩写）+「N 个运行中」。
  - 后台进程行补图标、PID 与相对启动时间。
  - 来源分组合并「已登记来源 + 待发送附件」，`summary` 内新增 ➕（复用 Composer 附件链路），超过 3 条折叠并提供「查看全部 / 收起」。
  - 三个分组默认展开（参考图形态）。
- `public/forge/codex-desktop.css`：新增 `environment-row-trail` / `environment-chevron` / `environment-detail` / `environment-commit-actions` / `environment-avatar*` / `environment-more` / `environment-source-add` / `environment-inline-spinner`；`environment-diff-count` 补按钮重置；删除已无引用的 `environment-git-actions`。
- `public/app.js`：注入 `renderAgentAvatar` 与 `agentLabel`；新增 `sources-add`（点击复用 `attach-button` 的服务端原生文件选择）与 `changes`（并入 `review` 分支）。
- `tests/workbench-environment-ui-contract.test.mjs`：新增一条契约，锁参考图形态的可展开行、内联刷新态、来源 ➕ 与查看全部、头像堆叠，并机械断言 UI 不得反向要求进程台账保留 argv。
- `scripts/qa-workbench-environment.mjs`：见下方「当轮修复」。

## 刻意不跟参考图的两处

1. **「子智能体」→ 保留「智能体活动」**：`tests/workbench-environment-ui-contract.test.mjs:37` 有 `doesNotMatch(/子智能体/)` 的诚实命名门。Console 的 agents 是团队席位（claude-fable / codex-technical …），不是 Claude Code 语义下的 subagent；真委派子集已由条目上的「委派」标注承载。
2. **后台进程不显示完整命令行**：参考图显示 `git status --short -- ...` 全文，但 `src/child-registry.mjs:45-49` 明确「Command arguments and environment values are intentionally never retained」——保留 argv 会让 `children.json` 变成凭据泄露面。改为镜像名 + PID + 相对启动时间，并把这条边界写进契约测试，防止后续为"像图"而反向要求台账留 argv。

## 当轮修复

把分组默认展开后，`qa-workbench-environment.mjs` 暴露两处此前被折叠默认掩盖的缺陷：

- 第 210 行来源断言无条件 `summary.click()`：默认折叠时是"展开再读"，默认展开时变成"关掉再读"。改为读 `node.open` 后按需点击，使断言对折叠默认不敏感。
- 第 297 行折叠循环预先 `.all()` 出 `[open] > summary` 的 nth(0..2)：`[open]` 是动态选择器，点掉第一个后剩余节点重新编号，`nth(2)` 永久失配并超时 30s。改为每轮重新取 `.first()` 直到无 open 组（带 8 次上限护栏）。**此前该循环因始终 0 个 open 组而从未真正执行过，是一段长期 no-op 的断言。**

## 证据

- `npm test`：804 tests / 803 pass / 0 fail / 1 explicit skip（新增契约 +1）。
- `npm run validate`：13/13 valid。
- `node --test tests/workbench-environment-ui-contract.test.mjs`：4/4。
- `npm run qa:environment`：`ok=true`、`diagnostics=[]`；1440x900 / 1280x800 / 820x1180 / 390x844 四视口 `scrollWidth === innerWidth`，`gitActionReachable=true`（含移动端滚动可达）；隔离服务优雅退出、临时根删除。
- 渲染 harness（一次性脚本，跑完已删）：满数据喂入（5 运行中 / 6 席位 / 3 进程 / 5 来源 / 三行全展开），明暗双主题 `ok=true`、零 console error、面板零横向溢出；人工复核无叠字、透字、头像遮字。截图 `.qa-output/environment-panel-preview/panel-{light,dark}.png`。
- 复核中修掉两处视觉缺陷：头像重叠 `-5px` 会遮住两字缩写 fallback（收到 `-3px`）；`environment-detail` 的 `margin` 简写与 `margin-left` 重复书写（合并）。

## 运行时与边界

- 未 commit、push、runtime sync、重启 51400 或修改凭据；未触碰 `src/workbench-environment.mjs`、Git plan/execute 双阶段门与来源持久化链路。
- 本轮未召唤外部 CLI：harness 层指令限制本会话不主动调用 Agent 工具，故无 DELTA 账本行（不为凑账本伪造发火记录）。
- 本轮非刷 DELTA 但需记录：环境舱渲染层重构（`environment-panel.js` 重写 + 5 处视觉缺陷修复）与修复两处 QA 长期 no-op 断言。
- **建议 LO 决定是否补一次烛评审**：本轮改的 `qa-workbench-environment.mjs` 属于验证代码，其中一处是放宽断言的写法（折叠→幂等展开）。虽同轮修出的 no-op 循环证明改动方向是加强而非削弱，但"自己改自己的验证逻辑"正是需要独立眼睛的场景。
- 移动端 390px 下环境舱受既有 `max-height: min(310px, 42dvh)` 约束，提交/推送与三个分组需滚动触达（codex 既有设计，本轮未改）。
