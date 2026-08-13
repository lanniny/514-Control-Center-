# 成员配置页面完善波：使用情况可见性 + 品牌徽章 + 字数统计（Kimi → all）

> 时间：2026-08-02 · 主驾：Kimi · 范围：apps/control-center 成员库面（member-library.js / app.js / index.html / team.css）
> 触发：LO「完善成员配置页面」

## 一、改进点定位

成员库 CRUD/席位绑定/资格判定已完备，缺的是最后一里可视性：①成员被哪些团队引用、是否主脑，删除时服务端 MEMBER_IN_USE 拦截无前置解释；②列表行是首字母缩写圆点，品牌与状态一眼不可辨；③简介/提示词两个长文本（2000/12000 maxlength）盲编无计数。本波四项全部纯前端增量——数据全走既有 state.teams + state.memberCatalog，零新端点，不碰 teams.mjs/team-members.mjs 冻结内核。

## 二、落地内容

- **使用情况区块**：编辑器头部 #member-usage-strip——引用此成员的团队 chip 全列出（内置标记、主脑金色「· 主脑」），空态明示"未被引用——删除/换绑都安全"；chip 点击经 onOpenTeam 直达该团队编排面。删除钮 title 同步点名引用团队，把服务端拦截从"无解释报错"前置为"操作前可见"。
- **删除确认前置说明**：remove() 确认框新增「团队引用」行，被引用逐一点名（含主脑标记）+ 明示"服务端将阻止删除，需先移出"。
- **列表品牌头像 + 徽章**：头像位改品牌 SVG logo（cliIconMarkup，无图标回退缩写）；徽章列「主脑可任」（金色，coordinatorEligible 服务端判定）+「团队 n」；gemini-research 禁用席位零徽章灰点，如实呈现。
- **字数统计**：简介/提示词 label 内嵌 n/2000、n/12000 实时计数，≥90% 变金加粗警示。
- **刷新钩子**：工厂新增 refreshUsage()，app.js 在 fillTeamForm 末尾与 runtimeSeatManager onCatalogChanged 两处接线——团队保存/删除/新建/席位目录变化后徽章与使用情况同步。

## 三、验证证据

- `npm test`：656 pass / 0 fail / 1 skipped（与基线一致，无回归；成员库为 DOM 模块无单测面，契约由探针覆盖）。
- `npm run validate`：13 valid。
- `scripts/qa-member-library-probe.mjs`（隔离实例）：预设建团「评审团」→ 列表 7 席全带品牌 logo、徽章计数准确（codex-technical「主脑可任+团队 2」、gemini-research 零徽章）→ 使用情况双 chip（514cc 内置 / 评审团·主脑金色）+ 删除钮 title 点名两团 → chip 点击跳回编排面 → 打字计数 29/2000→6/2000 实时变化；明暗截图 `.qa-v4/member-lib-*.png` 亲查；0 控制台错误。

## 四、边界与回退

- 未动服务端任何逻辑；MEMBER_IN_USE 拦截维持原样，本波只把它的解释前置到 UI。
- 预览实例 :5520 保留；桌面端 Ctrl+R 生效；未做 runtime sync/桌面重启。
- 回退 = 还原 member-library.js + index.html 四处标记 + app.js 六处接线 + team.css 完善波段落 + 删 scripts/qa-member-library-probe.mjs。

__DELTA__: Kimi | 1 | 证据：member-library.js usageOf/renderUsage/updateCounters + app.js:11625 onOpenTeam 接线 + index.html:850-853 使用情况区块，探针实测 chip 跳转编排面、删除 title 点名引用团队、计数实时变化，0 控制台错误
