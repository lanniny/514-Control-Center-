# 514cc Console — 视觉设计方向（暗夜玫瑰 · 仪表指挥台）

> 2026-07-17 重设计。目标：从"浅色通用后台模板"→"暗夜玫瑰仪表指挥台"，达到 LO 要求的"非常精美"。

## 主题（thesis）
Console 是 LO 的多 agent 体系的指挥甲板——洛琪希（水王魔术师）工坊的控制台。
参考主流设计语言：**Linear**（暗色精密 + 微妙渐变纵深 + 一流排版）、**Raycast**（命令面 + 玻璃质感）、
**Vercel/Geist**（发丝级分隔线 + mono 数据美学），但铸成独一无二的 **暗夜玫瑰** 身份——
不可与任何一个混淆。

## Token 系统
- **底**：深墨底带紫玫瑰暗调（非纯黑——纯黑是 AI 默认陷阱）。void→bg→surface 三级纵深。
- **玫瑰（签名色）**：#E0184D（呼应 statusline 红瞳红）+ 亮玫瑰 glow + 深玫瑰填充。
- **水（洛琪希元素，克制）**：#3FE0C4 只用于 online/生命信号——冷水对暖玫瑰，题材自洽非装饰。
- **琥珀**：#F0B429 只用于 warning，罕见。
- **字**：Segoe UI Variable（显示/正文）+ **Cascadia Code**（数据/mono 签名脸——终端母语=体系世界的原生话语）。

## 签名元素
- 指标卡→**仪表读数**：mono 巨号数值 + 顶部玫瑰光线 + 玫瑰 mono 标签。
- 组件健康→**舰队花名册**：agent 带状态光晕（aqua glow=online / 玫瑰脉冲=active / 暗=offline）。
- 玫瑰左光条 = 当前导航；玻璃暗顶栏；发丝玫瑰分隔线；实时事件脉冲。

## 落地
token 驱动（277 处 var）→ 重写 :root 自动流转全站 + 末尾精修层（refinement layer）提升关键组件质感 + 修事件表列碰撞 bug。

## 已交付（2026-07-17）
- **:root 翻转**：浅色通用模板 → 暗夜玫瑰三级纵深（void/bg/surface）+ 玫瑰签名 + 水色生命信号 + mono 数据脸 + body 双辐光氛围。
- **签名组件**：指标卡=仪表读数（mono 巨号 + 顶部玫瑰光线 + hover 玫瑰辉光上浮）；品牌标玫瑰渐变发光；导航玫瑰左光条 + 玫瑰图标；玻璃暗顶栏（backdrop-blur）。
- **状态语义**：online=水色辉光点（洛琪希元素）/ warning=琥珀 / error=玫瑰；DELTA 账本徽章 2(推翻)=玫瑰、1(补强)=琥珀——最高影响发签名色。
- **真 bug 修复**：①事件表 类型/主体 列碰撞（全列 overflow 裁剪，类型玫瑰/主体水色 mono）②配置中心代码编辑器刺眼纯白 → 深墨终端面 ③全部表单控件（textarea/select/search）深色 + 玫瑰聚焦环 ④浅色徽章边框（amber/red/violet 粉彩）→ 暗色语义 rgba。
- **验证**：跨 4 页实拍（总览/配置/体系观测/协作台）一致；CSS 大括号平衡 401/401；token 驱动保证路由/安全页同步。
- **参考语言**：Linear 精密暗色 + Raycast 命令面玻璃 + Vercel 发丝数据美学，铸成独一无二暗夜玫瑰身份（不与三种 AI 默认审美混淆）。

## IA 重构（2026-07-17 · 对话优先三区制）
> LO 反馈"界面不合理、对用户不友好"→ 调研 Cursor/Claude Desktop/Codex 真实前端（三路一致：**无一用仪表盘做落地页**，全是对话优先三区制）。这一轮改的是信息架构，不是配色。

**核心错配（旧）**：7 个扁平顶层 tab 平权竞争，落地页是"系统总览"仪表盘（4 指标卡+健康+事件表，首屏无 composer）。用户打开第一个动作是"读数"而非"发起工作"——反成熟范式。

**IA 反转（新，对标 Cursor Agents Window / Claude Code 桌面版 orchestrator seat）**：
- **落地页 overview→workbench**：打开即对话工作区（任务列表 | 会话流+composer | 上下文栏），首屏可见 composer（"描述要规划/实现/审查/调研的目标"）。
- **7 扁平 tab → 三级层级**：协作台=一等工作面（玫瑰发光主卡，视觉高于其余）；**观测**组（系统总览/体系观测/会话聚合）+ **配置**组（配置中心/模型路由/安全诊断）降为带分组标签的次级导航。
- **保留不删**（Cursor 3 激进转 agent-first 曾激怒老用户的教训）：配置/观测降级但仍可达，非删除。
- **移动端**：mobile-nav 协作置首 + 补回观测/会话（旧版移动端丢失这两项）。

**为什么是重新挂载而非重写**：协作台内部早已是成熟对话三栏（run-rail/conversation-pane/context-rail），render 函数解耦——改的是默认视图 + 导航分组，零渲染逻辑重写。改动点：index.html 导航重组+3 处 is-active 翻转、app.js state.view+start() 默认 workbench、styles.css nav-group-label/nav-primary。7 视图 Playwright 实测全可切、composer 首屏可见、无 JS 错误。

**后续可深做（未做，留 roadmap）**：命令面板（Cmd+K 万能入口）、审批内联进会话流（对标 Keep/Undo）、DELTA/handoff 走 Artifact 式"对话出卡→右侧展开"、sessions 并入 run-rail 统一脊柱、composer 内路由档 picker（对标 Shift+Tab 模式切换）。依据：调研 takeaways（Cursor/Claude Desktop）。

## 双主题与体检修复（2026-07-18）
> 全面体检（Playwright 7 视图 × 桌面/移动/平板实拍 + 代码审计）后的综合优化轮。

- **暗色「暖墨」主题回归**：v1 暗夜玫瑰 → v2 暖纸单色之后，改为**双主题令牌架构**——`[data-theme="dark"]` 只翻 :root 令牌（约 40 个 var），零组件规则改动。关键手法：白字填充与文字色解耦，新增 `--rose-fill/--rose-fill-bright/--red-fill` 固定浅色填充令牌（暗色里 `--rose` 提亮为文字色 #d97a52，填充不跟动）；主题切换不闪屏——`theme.js` 为 `<head>` 同步引导脚本（CSP script-src 'self' 禁内联，故独立文件），app.js `initializeTheme()` 管持久化（localStorage `514cc-control-theme`）与系统偏好跟随。
- **焦点框修复**：切页焦点迁移到 h1（屏幕阅读器宣读锚点，tabindex=-1 不进 Tab 序）曾被全局 `:focus-visible` 画出紫色矩形框——`.view h1:focus { outline: none }` 压制，真实交互元素的焦点环不受影响。
- **配置源徽标**：`format.slice(0,4)` 截出 MARK/PYTH 残词 → 可读缩写表（MD/PY/JSON/JSONL/YAML/TOML…）+ 徽标自适应宽度。
- **状态栏豆腐块**：rail-statusline 的 nerd-font 私用区图标（U+F024B 等）在无该字体环境渲染为 □ → 换通用字形（◆/📁/∑/◈）。
- **加载/失败态**：会话聚合首次进入白屏数秒（fetch 完成前不渲染）→ 先画加载态；失败后曾永远停在"正在扫描" → 显式失败文案 + 指向「重新扫描」；体系观测三表初始空表头 → "正在读取…" 占位行，加载失败 → 行内失败文案。
- **QA harness 修复**：qa-ui.mjs 的 `[data-view]:visible` 选择器命中屏外抽屉按钮（三套导航并存后）导致桌面用例恒超时 → 改 DOM 可见性过滤的 clickView()。
- **验证**：qa:ui 全套（layout + workbench 状态机）0 错误；node --test 90/90；暗色桌面/移动/平板实拍无横向溢出、无 JS 错误。
