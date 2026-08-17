<!-- 514cc-session-id: 122f11cb-a2b3-4792-b0e4-ec0a1abb256a -->
# handoff：协作台控制台形态收敛层·第五轮（活跃过程与步进可见性）

## 需求

LO 供图（Codex 桌面 App 实拍：流内「运行了命令」转圈行 +「第 1 / 4 步 · 2 个文件已更改
+150 −24」进度条 + pill 底栏 composer），指令"参考此图继续完善桌面端的协作台"。
前四轮（2026-08-16）已收敛骨架；本轮补时间线上辨识度最高、且数据面已齐备的两块：
进行态过程行与流内步进/变更进度条。纯前端波，零后端改动。

## 关键事实（后人省查）

- 数据面早已齐备：`src/adapters/codex-app-server.mjs:130-185` 的 `codexItemProgress` 对
  item/started 与 item/completed 都产出结构化 progress（command/file/note/reasoning），
  经 `notificationEvent`（:651）进 SSE。started 此前只喂 `trackCodexActivity`
  （app.js:15498 区）记账 + 呼吸行文案，`eventAffectsConversation` 明确不收 started 进历史。
- 重渲闸现成：started/completed 经 `activityChanged`/`conversationEvent` 触发
  `selectedRun` 重渲（pushEvent app.js:17300 区），本轮新增渲染不碰调度。
- 时长走字复用 `data-live-since` + `tickLiveElapsed`（1s interval，app.js:21299 区），
  新行挂同一属性即免费获得秒级走时。

## 落地清单

- `liveProcessRowsMarkup(run)`（app.js，codexActivityText 之后）：codexActivity 里 started
  未核销的 command/file 项逐条成行（转圈 +「正在执行/正在编辑」+ mono 目标 + 已运行时长）；
  completed 核销消失、完成态扁平单行自然落位，一行两态不另造完成形态。
  waiting_approval/recovery_required/pendingAsk 不挂转圈（等的是人，转圈=假活）。
- 呼吸行去重：`liveTurnMarkup` 只为 reasoning 保留「正在思考」，command/file 不再重复文案；
  `codexActivityText` 原样保留（codex-process-visibility 契约锚点）。
- `turnFileStats` + `trackTurnFileStats`：本次交互文件变更累加器（只收 completed file
  progress；数行复用 `diffLineStats`；user.message 重置；run.completed/failed/cancelled 清账）。
- `turnProgressMarkup(run)`：「◌ 第 X / Y 步 · N 个文件已更改 +A −D」，details 展开
  per-file 明细；开态靠 `data-stream-key="tail:progress"` 走既有 capture/restore 保留。
- tail 接线：renderSelectedRun tailMarkup 串入（`newerGate + liveProcessRowsMarkup +
  turnProgressMarkup + liveTurnMarkup + …`）；pushEvent 补 `trackTurnFileStats(event)`。
- 样式：`forge/console-form.css` 末尾第五轮区块。居中纪律：两个新类都是流直接子级，
  margin 只写 `margin-block`（第四轮 .gov-note 破口同款预防），契约测试带负向断言。
- 图标全用既有 sprite（loader-circle/chevron-right/file-pen-line/terminal），manifest 未动。

## 验证证据

- 契约：`tests/stream-live-progress-contract.test.mjs` 新增 6 项，与 stream-centering /
  codex-process-visibility / lucide-sprite-contract 同跑 **19/19 绿**。
- 实拍：vm 沙箱抽真函数（`liveProcessRowsMarkup`/`turnProgressMarkup`/`trackTurnFileStats`）
  生成静态预览（`.scratch/gen-preview-5.mjs` + `shot-wave5.mjs`），亮/暗 × 收起/展开四态
  截图 `.qa-ui-wave5/wave5-5-{light,dark}.png`、`wave5-5-open-{light,dark}.png`：
  进行态两行转圈走时、「第 1 / 4 步 · 2 个文件已更改 +246 −24」（150+96 聚合正确）、
  展开 per-file 明细（修改/新增 chip + mono 路径 + 行级统计），无 pageerror。
- 排障记录（后人勿踩）：预览页内联整份 sprite 时**必须剥注释**——sprite 头注释里的
  `#lucide-sprite-host[hidden]` 字样会被 lucide-sprite-contract 的 `#lucide-*` 扫描当成
  引用，吃进 public/ 下的预览 HTML 就误红（本轮实踩，已在 gen-preview-5.mjs 修掉）。
- `node --check`（拷 .mjs）过；全量 `npm test` 结果见 DESIGN-NOTES 第五轮条目末行。

## 诚实边界 / 遗留

- kimi/gemini/claude 等席位无 item 级信号：无进行态过程行与文件段（只显示步进或全隐），不造假活。
- 刷新页面后 turnFileStats 从空起步（只收 live SSE，不回放历史补齐）；新交互随 user.message 重置。
- 截图「已查看 N 张图像」是 agent 侧图像查看信号，codex app-server 无此 item 类型，不伪造；
  剪贴板图片内联缩略图（需新增 GET 端点）留作后续候选波。
- 源码改动需重启/刷新运行态 Control Center 后生效（本轮未动 LO 的运行实例）。

__DELTA__: Kimi(514cc-cli) | 1 | 证据：app.js liveProcessRowsMarkup/turnProgressMarkup/trackTurnFileStats 三件套、console-form.css 第五轮区块、契约 6/6 + 四态实拍无 pageerror
