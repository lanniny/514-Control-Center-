# 会话流布局对照波：回到底部浮钮 + 用户消息折叠 + 行复制钮 + MC tab 徽标（Kimi → all）

> 时间：2026-08-02 · 主驾：Kimi · 范围：apps/control-center 协作台会话流 + Mission Control + 全局壳
> 触发：LO「请你继续优化前端布局对照参照工程」+「继续」

## 一、参照工程再取证（DNA 清单来源）

两探索代理对 `.scratch/codeg-current` 与 `.scratch/LiveAgent-current` 各出 15 条布局模式清单（剔除前几波已移植：终端 dock / 右栏折叠 / rail 分组 / 720 居中栏 / 顶栏单界面）。本波落地五条（第一半片 ①②③，第二半片 ④⑤）；侧栏行内删除确认卡与 FloorNavRail 楼层轨评估后放弃（理由见二续末）。

关键取证行号：
- 回到底部：LiveAgent `chat/transcript/ChatTranscript.tsx:284-295`（following===false 才浮出）；codeg `ai-elements/message-thread.tsx:80-107`（离底圆形钮）。
- 用户消息折叠：codeg `message/collapsible-user-message.tsx:19-86`（真实溢出才显 fade + Show more）。
- kbd-hint 重叠：styles.css:10059 `position:fixed; bottom:12px; right:12px` 正压在 styles.css:7149-7150 状态栏右段（本机控制面/版本号）上，截图裁切亲证。

## 二、处置三刀

| # | 项 | 处置 | 落点 |
|---|----|------|------|
| ① | 回到底部浮钮 | `bootStreamChrome()`：sticky 哨兵挂 `.conversation-stream` 内容末尾（height:0 不撑排版），脱底 >160px 揭 hidden，点击平滑回底（reduced-motion 瞬时）；渲染器 innerHTML 全量替换后 MutationObserver 自动挂回哨兵；app.js capture/restore 滚动保持零改动 | workbench-chrome.js ⑤节 + forge/workbench.css 2026-08-02 波段 |
| ② | 超长用户消息折叠 | 气泡正文 >240px 一次性判定（`data-clamp-checked` 标记）→ is-clamped 钳高 + color-mix 渐隐遮罩（与气泡同 `--muted` 变量，明暗不穿帮）+ 展开全文/收起钮（stream 事件委托，aria-expanded）；短消息零侵入 | 同上 |
| ③ | kbd-hint 浮丸退役 | `display:none` 去重——Ctrl+K 发现性顶栏搜索框已承担；DOM 保留零 JS 引用风险；移动端 820px 下本就隐藏 | forge/shell.css 2026-08-02 波段 |

## 二续、第二半片（LO「继续」）

| # | 项 | 处置 | 落点 |
|---|----|------|------|
| ④ | 消息行 hover 复制钮 | 行右上角浮动复制钮，`position:absolute` 脱 grid 不入行布局；hover/focus-within 显现（键盘可达）；复制渲染后正文（clipboard API + execCommand 降级），成功换 check 1.2s；`data-actions-checked` 标记与折叠共用 MutationObserver | workbench-chrome.js ⑤c + workbench.css ③ |
| ⑤ | MC dock tab 状态徽标 | `renderTabBadges(value)` 挂 render/loading/empty/error 四出口：任务=运行绿点/关注琥珀点（failed/waiting_approval/recovery_required/cancelled/auditDegraded）、产物=登记计数、证据=降级或待审批关注点、连接=在线 n/N；无快照如实清空 | mission-control.js + workbench.css ④ |

- 取证行号：行复制 codeg `ai-elements/message.tsx:40-81`（hover 浮出复制）/ LiveAgent `chat/transcript/RowActions.tsx:43-165`；tab 徽标 LiveAgent `components/project-tools/RightDockTabStrip.tsx:110-129`（running 状态点 + hover 关闭）。
- 走查抓到一个真漏配：默认选中 run 状态 `recovery_required` 不在首版 attention 名单 → tab 无点；补 recovery_required/cancelled 后实测 `registry-tab-dot is-attention` 命中。
- 评估后放弃两项：侧栏行内删除确认卡（现有 confirmAction 富对话框已含路径行/警示/磁盘删除勾选，信息密度高于 LiveAgent 行内卡，零边际价值）；FloorNavRail 楼层轨（会话流 160 条上限，jump-to-bottom + 轮分隔线已覆盖导航，价值/成本最差）。

## 三、截图走查顺带查清的既判事项

- 团队页「当前运行态/运行席位」空白卡 = `collab-flow.js renderSkeletons` 的加载骨架（cf-skeleton 4+3 块），QA 900ms 窗口抓到中间态，非渲染 bug；冒烟实例 5s 后落定（本实例 `/api/teams` 不可用，如实降级成"团队数据不可用 + 重试"错误卡，不假死）。
- 团队页右栏"成员目录加载中"同理为加载态文案。

## 四、验证

- `npm test` 646 tests / 645 pass / 0 fail / 1 skipped；`npm run validate` valid。
- 探针 `scripts/qa-layout-wave6-probe.mjs`（合成消息流走渲染器同款 innerHTML 路径）实测：脱底 1741px 浮钮显 → 点击回底 0px 浮钮收 → 翻顶复显；长气泡钳 238px、展开 455px、钮文案/aria 同步；仅超长那条出折叠钮（短消息零侵入）；kbd-hint display:none。明暗渐隐遮罩截图亲查（probe-jump-visible / probe-dark-clamp）。
- 探针 `scripts/qa-layout-wave6b-probe.mjs` 实测：6 合成行全注入复制钮 opacity 0 → hover 1 → 点击换 check 图标；MC 徽标 ready 态 产物 4 / 连接 6/6；默认 recovery_required run 任务 tab 琥珀点（补漏后复测命中）；暗态截图亲查。
- 21 站全量截图回归 0 控制台错误；右下角状态栏不再被浮丸叠字；MC tab 条 loading 态徽标清空无残留。
- 冒烟实例 :5520 已回收；桌面端静态资产免重启 Ctrl+R 生效。
- 回退 = 删 workbench-chrome.js ⑤节 + forge/workbench.css、forge/shell.css 的 2026-08-02 波段 + mission-control.js renderTabBadges（CHANGELOG v4.0 未发布节已录）。

__DELTA__: Kimi | 1 | 证据：workbench-chrome.js bootStreamChrome + mission-control.js renderTabBadges + qa-layout-wave6(b)-probe 实测（浮钮 1741↔0 / 气泡 238↔455 / 复制 0→1→check / 徽标 4·6/6·琥珀点），21 站 0 控制台错误
