<!-- 514cc-session-id: e98050f3-cf3c-41f3-97f6-c3b23ae52050 -->

# 配置图谱 v42：回退闭环 · 本机/远程一致 · 去重 · 紧凑布局（主驾自评）

- **日期**：2026-08-12
- **驱动**：LO 五点要求（用户友好/本机与远程一致/查明并删重复/大厂风格/供应商管理不全面「回退无法更改」）
- **范围**：`apps/control-center`（providers.mjs / server.mjs / app.js / index.html / styles.css / forge/data.css / modules/ccswitch-panel.js / state.js / api.js + 测试）
- **调度**：主驾直达（⚪ 隐形档）。未召唤外部 agent，故无 `__DELTA__` 账本行。

## 一、先查明再动手（磁盘证据）

| 结论 | 证据 |
|---|---|
| 「可回滚」是空头承诺 | `switchTo` 确认框写「备份在 backups/providers/」，但 `ProviderStore` 只有私有 `#backup()`，**无 list/read/restore 任何方法或端点**；`public/api.js` 无对应常量；UI 无入口 |
| 远程侧早有完整闭环 | `src/ssh/remote-graph.mjs` 有 `readBackup`/`restoreBackup`，路由 `POST :id/graph/backup/restore`，前端有备份时间线 |
| 破坏性操作用原生 confirm | `public/modules/ccswitch-panel.js` 13 处 `window.confirm`（含「完整备份恢复」），与全站页内 `confirmAction` 不一致；DESIGN-NOTES 第七波已记录桌面壳原生对话框「点确认自动闪退」先例 |
| 环境冲突检查两份实现 | 页头 `provider-envcheck-button` 只发 toast；工作台同步面可勾选删除+备份。同名不同能力 |
| 版面被三层横条吃掉 | 实测正文 `top≈300px`；`config-topology` band 高 72px；流程箭头暗示不存在的向导顺序 |
| 4 栏栅格挤压 app 条 | `.provider-columns: repeat(4, minmax(230px,1fr))`，其余子块靠 `grid-column:1/-1` 兜底，唯独 app 条没声明 |

## 二、落地

1. **本机备份台账 + 一键回退**：`liveConfigTargets()` 登记表 + 备份 sidecar 清单 + 四方法
   （list/read/restore/remove）+ 四端点；恢复只认登记表路径、CAS `expectedDigest` 409、
   恢复前再备份（回退可再回退）、凭据载体只回退不预览。
2. **对话框可回退**：「重置」回到打开时状态；预设再点即取消 + 「不使用预设」（只解绑附加 meta，保留已填内容）。
3. **去重**：环境冲突弱化副本删除并指向唯一实现；13 处 window.confirm 页内化；5 处外部品牌名换自有命名；
   `providerAppTabsMarkup` / `providerRowIdentityMarkup` 两侧共用。
4. **布局**：56px sticky `.config-toolbar`（segmented control + 配置目标），正文 top 300→233px；
   6 个无标签图标 → 带文字溢出菜单（复用既有菜单组件）；排序模式补显式出口；修 4 栏栅格挤压。

## 三、验证（全部实跑，非推断）

- 契约：新增 `tests/provider-backups.test.mjs` 8/8；全量 **1041 测试 1040 pass / 0 fail / 1 skipped**。
- 实机：`verify-provider-backups` 14/14（切换→对比→回退→磁盘回到原文，含脱敏断言）、
  `verify-provider-dialog-undo` 19/19、`verify-provider-tools-menu` 20/20（含 56px/233px 几何断言）。
- 面级：`qa:remote-config` ok:true；`qa:walkthrough` 10 面零横向溢出零 pageerror。
- 机械扳机实证：`lucide-sprite-contract` 抓到我引用了 sprite 中不存在的 `chevron-up`（会渲染空白），当场修正。

## 四、诚实边界

- 「回退无法更改」的**根因未经 LO 确认**：我按磁盘证据覆盖了全部合理解读（live 配置无回退入口 /
  对话框与预设无退出路径 / 原生 confirm 在桌面壳被吞）。若 LO 说的是别的具体现象，请补充复现步骤。
- 本机与远程仍有未对齐处：远程有真源编辑器与健康仪表盘，本机 live 文件在 `sources.json` 是
  `deploy-only + exposeContent:false`（既有安全设计）。本波只对齐了**回退**这一条，其余不假装已对齐。
- `tests/observability-sessions.test.mjs` 一条扫描合流计时断言在全量并行下偶发红，隔离重跑 3/3 绿，
  非本波引入，未修。
- 建议独立复核点（自写治理/安全面代码，同一个脑子有同一套盲区）：备份恢复的路径围栏与
  credential 分类是否覆盖全部 live 目标；页内化后的 13 处确认文案是否与实际影响面一致。
