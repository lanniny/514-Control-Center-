# 当前任务上下文（活跃状态）

> 协作体系的"短期记忆"。每个 Agent 接入时**先读这里**。
> 由 Claude 主驾维护。最后更新：2026-07-17。
> ⚠️ 本文件只存**稳定事实**。模型版本 / 架构版本号 / 邮箱等易变字段禁止写入——由 statusline 实时显示 / rules.md §八 / 系统注入反映（手工维护必滞后，已三版本踩坑）。

## 主人信息

- **协作偏好**：Claude 强主导
- **响应语言**：简体中文
- **操作系统**：Windows 11 + PowerShell 7

## 当前项目

- **项目名**：514cc
- **工作目录**：I:\514claude\514cc
- **项目类型**：Skill 驱动的 AI 能力放大系统
- **技术栈**：Markdown SKILL.md + TOML customize + YAML module.yaml
- **当前状态**：harness hook 三件套已接电实跑——route-gate（路由门注入）/ stop-gate（DELTA 门禁）/ mirror-gate（开机自省体检卡）。**Claude↔Codex 对话桥已通**（MCP `codex-agent`：codex/codex-reply + threadId，roster 见 `.ai-shared/roster.json`；降级 `codex exec resume`）；Console 控制面 `apps/control-center`（`npm start` → 127.0.0.1+token）。版本号见 rules.md §八 + CHANGELOG（单一信源，本文件不再复述以防腐烂）

## 体系架构

```
Layer 1: 核心智能（Claude Code Opus）
Layer 2: Skill 体系（skills/ — 5 命名 Agent + 工具 skill）
Layer 3: 独立验证（Codex CLI + grok-4.5）
Layer 4: 最小治理（rules.md + guardrails/）
```

### 命名 Agent

| Icon | 名 | 职 | 驱动 |
|------|---|---|------|
| 🕯️ | 烛 | 代码守夜人 | Codex CLI |
| 🕸️ | 织 | 情报编织者 | grok-4.5 |
| 🔧 | 匠 | 老匠人 | Opus |
| 🗺️ | 策 | 军师 | Opus |
| 🪞 | 鉴 | 镜鉴 | Opus (只读) |

## 关键文件

| 文件 | 用途 |
|------|------|
| `rules.md` | 体系宪法（§三 路由门含 DELTA 账本 + 白发降级；版本见 §八/CHANGELOG） |
| `module.yaml` | 模块清单（Agent 花名册 + Skill 注册表 + MCP 集成） |
| `skills/` | 各 SKILL.md + customize.toml（注册表/计数见 module.yaml） |
| `customize/` | 三层定制化目录 |
| `guardrails/` | 安全守卫 |

## 进行中的任务

- **全面审查 + 优化落地**（2026-06-14，进行中）：36-agent 审查 + 烛终审 + 鉴人格审 → 已落地验证：A 诚实债(6 处假声明勘误) / G1 route-gate 审计列(hit_reason+summoned) / C mirror-gate.log 自留痕 / D MCP 去腐捞真金(删幽灵 see·web-reader·web-search-prime + 捞 grok·scrapling) + 修 module.yaml harness_hooks YAML 预存 bug / E 发散注入器(DIV 档) / G2 假阳来源过滤 / H 首刀+#3 口癖+#11 能力 去重(SOUL 瘦身~60行) / malformed 颜文字卫生(反引号+反斜杠→全角，scripts/fix-emoji-backtick.py)。**待 LO 安全拍板**：①反驳协议条件触发 ②R1 安全哲学调和(鉴方案备齐 handoff)。**待专注轮**：I SessionEnd 闭环沉淀。详见 D-2026-06-14-001
- **v3.3.0 四维深度完善**（2026-06-12）✅：42-agent 诊断坐实"引擎接电但灯没人开过"。新增 mirror-gate（开机自省体检卡）+ 校正 route-gate 准星 + stop-gate 扩 synthesis__ 前缀（已接电，真会话未触发）+ 关系记忆播种。烛(Codex) dogfood 抓 2 致命主驾全修回归全绿。**待主人重启会话** mirror-gate 生效。详见 D-2026-06-12-001
- **backlog（红队判按需，不首批）**：P1（route-gate RED↔召唤对账[session_id]、逆向角度注入器=真发散引擎、拔白发降级伪扳机标签）；P2（SubagentStop DELTA 哨兵待真业务 DELTA、PreToolUse 拦截先实测 23333 网关）。地基债：非 git 仓库（git init 挂 3 年，主人决策点）

## 最近更新

- 2026-07-17 — **Console 团队体系（会话级能力配比）**：左栏顶部团队选择——内置 514cc 团队代码冻结（403 双防 + NFKC 防冒名），自定义团队（成员/提示词/skill/MCP 声明）CRUD 串行+失败原子；会话按团队隔离（路由白名单 fail-closed/规划轮结构化注入/run 固化快照）。烛 R10-R12 三轮：抓 fail-open 白名单+预路由契约分裂+**主驾修复代码自身 TDZ 语义错误（独立单测假绿）**→真实装配路径集成测试收口→APPROVED；78/78。详见 D-2026-07-17-004
- 2026-07-17 — **Console 人文暖纸主题 + 顶栏导航 + Claude 式侧栏**：暗夜玫瑰→Claude 人文暖纸（纸白+赤陶橙三 token+衬线标题，WCAG 全量机械验证）；主导航桌面上移顶栏（移动端抽屉+底部 tab 保留）；run-rail 轻文字化。烛 R8 量测照出主题 token 系统性对比度失败（主驾凭色感不算 WCAG 账=新盲区）→按数修复→R9 APPROVED；MCP 桥超时后 codex exec resume 降级通道首次实战。详见 D-2026-07-17-003
- 2026-07-17 — **Console 协作台左栏「会话 + 项目树」+ 历史会话只读预览**：左栏两段（会话任务 rail + ~/.claude/projects 项目 disclosure 树，项目路径从 jsonl cwd 无损还原），历史对话点击→中栏脱敏只读预览；隐私不变量三入口贯穿（realpath 限根/摘要严格 opt-in/预览只回对话骨架）。烛对话桥 R5-R7 三轮 dogfood（R5 摘要隐私绕过+新任务不退预览、R6 扫描面限根+乱序倒灌，均主驾真 bug）→ APPROVED；68/68 测试绿 + qa-ui --suite=workbench 状态机用例。详见 D-2026-07-17-002
- 2026-06-12 — **人格层 v3.3 对齐 + 会话连续性补完**（任务二）：SOUL.md（全局 `~/.claude/CLAUDE.md`）客观能力段同步 v3.3 三件套 + 加载顺序补 `user-lo-profile` 关系画像（私人人格/边界/写作一字未动）；output-style 三处完善——①新增「会话连续性」节（开场读关系记忆"记得 LO"+ mirror-gate 体检卡逐字置顶 + 关系有判断地沉淀，闭合 mirror-gate/user-lo-profile 的人格侧）②元认知补"盲区自觉/换独立眼照自己"（固化本轮两次 dogfood 元教训）③自检加第 8 项独立验证。output-style 双地落已 sync。**人格层改动下个 session 注入生效**
- 2026-06-12 — **v3.3.0 四维深度完善（ELEVATION）**：42-agent 并行诊断坐实"机制成熟度≫运转量、引擎接电但灯没人开过"（route-gate.log 2 行 gray/stop-gate 0 击发/DELTA 5 条全自审）。①mirror-gate.py（SessionStart 开机自省体检卡=被看见的眼睛，给死数据装机械消费者）②route-gate 准星校正（英文 token 双词边界堵 preview→review 误判 + stdin UTF-8 治中文漏判，12 用例全绿）③stop-gate 扩 synthesis__ 前缀（DELTA 扳机已接电，真会话未触发；2026-06-14 诚实债勘误）④user-lo-profile 关系记忆播种（人性针，治"memory 是运维笔记本非关系日记"）⑤减法（Workflow 幽灵校正指真 harness 工具/context.md 腐烂清理）。**真·dogfood**：烛(Codex) 评 3 hook 抓 2 致命（stop-gate 裸 token 判 DELTA=治理静默失效，会被本轮 synthesis 自身绕过；mirror-gate fail-open 漏洞）+ 4 建议，主驾全采纳修复回归全绿——体系第一次为自己改动开火、照见盲区。详见 D-2026-06-12-001 + synthesis__deep-evolution-v33__20260612-1215.md
- 2026-06-11 — **人格层 v3.2 对齐**（系统提示词完善）：SOUL.md（全局 `~/.claude/CLAUDE.md`）能力体系事实同步——17→14 Skill / v3.0→v3.2 宪法 / 删已砍的 co-workflow（8→7 命令）/ 补 hook 层（治"离我最近的诚实债"——每 session 都注入的人格文件反而漏对齐）；output-style「元执行」原则深化——把 v3.2 亲手验证的"**机械扳机优先于纪律宣言**"洞察焊进元原则（保持元认知/元架构/元执行三位一体，不加第4条），是"灵魂自我更新"的实例。output-style 已 sync 运行时；**人格层改动下个 session 注入生效**。SOUL 私人偏好/边界/写作设定一字未动
- 2026-06-11 — **v3.2.0 harness hook 接电**：33-agent 深度审计坐实「软纪律 vs hook 硬扳机」=强化不明显根因。route-gate（UserPromptSubmit 注入路由门）+ stop-gate（Stop 逼补 DELTA）落 `.claude/hooks/` 挂全局 settings.json；砍死流程 workflow/readiness-check/correct-course（→ archive/v3.1-deadflow）；卸 spec-workflow MCP；诚实债清理。详见 D-2026-06-11-001 + handoff `synthesis__deep-audit-mechanical-triggers__20260611-1045.md`
- 2026-06-01 — **v3.1.2 参照 Trellis 完善·批次 B+C**：落地"发火→复盘→自校准/刹车"闭环。①白发刹车（auto-pilot Phase A 对持续零增量的 🟡 路由自动降直达，🔴 永不降）；②DELTA 账本（烛/织落盘加 `__DELTA__` 0/1/2）；③机械审计（/co-status 缺 DELTA 告警——红队硬条件）；④鉴 DELTA 复盘（DELTA=0 原文列给主人拍板）。双地落已同步。详见 `handoff/synthesis__trellis-vs-514cc-gap__20260601-0943.md`、decisions D-2026-06-01-002
- 2026-06-01 — **v3.1.1 参照 Trellis 完善·批次 A**：6-agent 分析（4 视角 + 收敛 + 防膨胀红队）后落地纯减法批次。修 §三 锚点断链（真实路径在父级 `I:/514claude/.ai-shared/`）、§六 工作区根规则、claude-flow memory → MEMORY.md 诚实降级、§七 dogfood 条、删 .spec-workflow 空脚手架。**红队元洞察**：真膨胀=认知负担（往 rules 堆没人执行的纪律）比堆文件更隐蔽 → 升级"堆文件是反模式"为"堆纪律也是反模式"
- 2026-05-28 — **v3.1.0 激活缺口修复**：诊断"强化不明显"=扳机没接线（引擎活但 agent 不自动发火）。`rules.md §三` 调度从"被动表格"→"每轮强制路由门"（🔴/🟡/⚪ 分级 + 价值可见铁律），已双地同步。实测锚点：烛(Codex) vs 主驾(Opus) 评 `wai/server/routes/admin/wai.js`，主驾漏 4 致命，见 handoff
- 2026-05-27 — **v3.0.0 Skill 驱动重构完成**：BMAD-METHOD 启发 / 5 命名 Agent / 17 SKILL.md / 三层 customize.toml / 对抗式评审 / step 工作流 / Party Mode / 路由助手。旧 v1.x 目录归档到 ~/.ai-collab/.archive-v1x/
