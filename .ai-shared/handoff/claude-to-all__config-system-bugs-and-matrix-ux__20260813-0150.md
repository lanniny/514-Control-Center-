<!-- 514cc-session-id: 64adc88e-974f-4b70-aac5-e98599fea288 -->
# 配置设置系统：找 bug + 前端美化 + 拓展功能

## 任务与方法

LO：「1.找bug请你深度完善所有配置设置系统 2.美化前端 3.增设拓展功能」。

排序按杠杆点：**先 bug（有 bug 的界面美化了也是坏的）→ 再美化 → 再扩展**。方法上分三路，避免只靠读代码猜：

1. 静态审查（故障模式扫：XSS / fail-open / 无保护解析 / 竞态）
2. **行为探针**：起真服务器，用真实 HTTP 冲击 `/api/config` 全链路边界
3. **UI 走查**：起独立实例逐面截图 + 收 console/pageerror/横向溢出，用眼睛看真实界面

## 一、找 bug 的诚实结论

### 探针实测：配置 API 边界层是健康的

`/api/config` 全链路（起真服务器，临时 dataRoot）：

| 探针 | 实测 |
|---|---|
| 路径穿越 `..%2F..%2Fpackage.json` | 404 `SOURCE_NOT_FOUND`，**不回文件内容** |
| 未知 sourceId / 未知版本 | 404 `SOURCE_NOT_FOUND` / `VERSION_NOT_FOUND` |
| critical 源写入无确认 | 403 `CONFIRMATION_REQUIRED`（fail-closed） |
| 无 Bearer | 401 |
| 坏 JSON / 2MB / 并发写 | 无 5xx、无裸 SyntaxError 泄漏 |

`validate` 对坏 JSON 返回 HTTP 200 + `{valid:false, errors:[…]}` —— 结论在 payload 不在状态码，是**正确设计**，不是 bug。

同样经核实**不是 bug** 的怀疑项（写下来避免下次重复怀疑）：`config-manager.mjs:217` 的 `exposeContent !== false` 看似 fail-open，实则 runtime/secret 类源在 `:117` 硬编码 `false`，repo 内配置本就在 git 里——默认方向合理。

**这一层我没有找到可报的真缺陷，不虚构。** 真正的问题在 UI 层（16800 行 app.js），下面三条都是走查看见的。

### bug 1 · 门闸未授权被当成故障渲染

`renderConfigHostBar` 把服务端 501 的原始 message 直接铺在配置目标行：

> `主机台账不可用：SSH terminal is blocked: 凭据引用制 + known_hosts 指纹确认 + 权限作用域（v4.0 Wave G 已落地）`

它在**每一个配置面**常驻，390px 下占三行红字。而 501 的语义是「远程能力**还没授权**」，不是「坏了」。

修：`configTargetLoadIssue()` 按 `status===501 || code==="REMOTE_GATE_BLOCKED"` 分成 `gated` / `error` 两类——未授权走中性胶囊 `🔒 主机：远程能力尚未授权 [去授权]`（点击直达门闩清单并滚到位），真故障才用告警色；**原文不丢**，收进 `detail` 由 title 悬浮可见。

> 修的过程中我自己引入了一处破绽并当场修掉：`app.js:9439` 还有第三处赋值仍是裸字符串，会让目标栏渲染出 `undefined`。新增测试直接数「三处赋值必须都走 `configTargetLoadIssue`」，再漏即红。

### bug 2 · 测试断言腐烂（挡住全绿基线）

`tests/team-workspace-ui.test.mjs` 三条断言在盯 app.js 的**字面文本**（`!configIsDirty() && !teamFormDirty…`），而守卫已重构为单点收口 `hasUnsavedConfigChanges()`（还多覆盖了远程草稿与运行席位）。

先核实功能有没有退化——**三道闸都在**：切换 `confirmDiscardTeamDraft()`、激活 `activateEditingTeam` 内拦截、供应商应用 `applyTeamProviders` 内拦截。是断言腐烂，不是代码退化，所以**不是改代码去迁就测试，而是把断言从字面升级为语义**：断收口覆盖各脏源 + `beforeunload` 实际调用 + 三处守护点各自存在。这样它防的是「守护点丢失」，而不是「某行文本被改写」。

### bug 3 · Skill 矩阵不可用（21×6=126 格）

走查截图看到的实况：126 个高饱和红勾铺满屏幕、全部勾选（信息量为零）、无筛选、无批量、无行列定位。要改一个成员的一批 skill 只能手点。

## 二、美化 + 三、拓展功能（同一杠杆点）

矩阵是配置图谱里信息密度最高、可用性最差的地方，三件事在这里合流：

**拓展功能**
- 筛选框（按 skill 名/描述/路径），命中数与批量作用域实时显示
- 覆盖率徽标 `已声明 N/M`（**按全集统计，不随筛选失真**）
- 列头 `21/21` 按钮＝整列批量（该成员 × 当前列出的 skill）
- 行首 `6/6` 按钮＝整行批量（该 skill × 全部成员）
- 工具条 `全部声明` / `全部取消`（作用于筛选命中 × 全部成员）

**批量的安全语义**（这是我最在意的部分）
- 复用单条 `PUT /api/capabilities/agent-skill` 原子接口组合，**不新开批量写面**（测试里显式断言不存在 `capabilities/bulk` 之类端点）
- 只收集「当前状态 ≠ 目标状态」的格子 ⟹ 确认框上的条数就是真实变更数
- fail-closed 的成员与整体降级在**收集阶段**就排除，绝不批量写进坏配置
- 影响面二次确认（一次可能改上百条），受控并发 4，**部分失败逐条回报**，不伪装整批成功

**美化**
- 斑马纹 + 行 hover 高亮（126 格靠肉眼对位极易点错行）
- 满勾时压低勾选饱和度（`color-mix` 62%），hover/聚焦才回品牌色——不再糊成一片红
- 表头 sticky，长表滚动时列名不丢
- 行首布局用 flex 收口：名字占主可省略、两颗按钮不参与压缩（首版改造实测把 skill 名挤成了两行，已修）

**拓展工具**：走查脚本正式化为 `npm run qa:walkthrough` —— 起独立实例逐面截图 + 收 pageerror/溢出，有诊断即 exit 1。布局回归和空白控件从不让单测变红，这是「看得见的体检」。

## 验证（当轮实测）

- 新增 `tests/capability-matrix-bulk.test.mjs` 5 条：批量只收真实变更、fail-closed 成员豁免、筛选作用域（列/全量按命中项、整行按全部成员）、整体降级停手、app.js 接线（复用原子接口 + 二次确认 + 逐条回报 + 门闸分类三处赋值一致）。
- **元验收（防假绿）**：去掉 fail-closed 排除 → `fail 1`；还原 → `pass 5`，`node --check` 通过。
- 相关组 `capabilities` + `config-topology-{ui,state}` + `team-workspace-ui` + `lucide-sprite-contract` → **66/66 pass**（含此前腐烂的三条断言，现已语义化并全绿）。
- `npm run validate` → 13/13 valid。
- 全量 `npm test` → **1033 tests / 1032 pass / 0 fail / 1 skip，exit 0**（上一波收尾时为 1028/1025/**2 fail**；本波 +5 新测试并把那 2 条腐烂断言修回全绿）。
- `npm run qa:walkthrough` → 10 个面（桌面 8 + 390px 2）**全部零横向溢出、零 pageerror**，exit 0。
- 走查截图前后对比：门闸提示 3 行红字 → 一行胶囊；矩阵从满屏红勾 → 带统计/筛选/批量/斑马纹。

## 边界

- 未 commit、未 push、未同步运行时；走查用独立临时实例，**没有碰正在运行的桌面实例**。
- `.scratch/` 加入 `.gitignore`（原为未跟踪的临时区，另有其他 agent 的日志留存，未清理他人文件）。
- 批量是前端对原子接口的组合，21×6 全量取消＝126 次请求（并发 4）。当前规模够用；若成员/skill 再翻倍，应考虑服务端批量端点——**本波没做，也没在 UI 上伪称是原子操作**。
- 矩阵列 hover 的十字定位只做了行方向；列方向依赖既有 `is-member-focus`，未引入 `:has` 强依赖。
- **本波仍为主驾直达，无外部发火 DELTA**。route-gate 本轮提示了元任务档：改动含 UI 安全语义（批量写配置、门闸呈现）与我自己写的测试断言升级，按 §七 建议由烛（read-only）或鉴复核——重点核批量作用域是否可能改到用户没看见的行、以及断言语义化后是否仍能挡住守护点丢失。等 LO 授权。
