# 514cc — Skill 驱动的 AI 能力放大系统

v3.4.3 | 2026-07-16 | mirror-gate 契约驱动重构（SECURE）+ 织换 grok 驱动

## 是什么

514cc 是一个 **Skill 驱动的多 AI 协作能力放大系统**。它不是"协调协议文档库"，而是让 Claude Code 的每一分智力都投入到实际产出的工具箱。

## 核心特性

- **5 命名 Agent**：烛（评审）/ 织（情报）/ 匠（嵌入式）/ 策（架构）/ 鉴（审计）——真异构多模型（Codex/Gemini/Opus）
- **每轮强制路由门**：§三 调度每轮自动判级（🔴 必须 / 🟡 判断 / ⚪ 隐形），让能力自动发火而非被动等召唤
- **harness hook 硬扳机（v3.4 三件套）**：route-gate（UserPromptSubmit 每轮硬注入路由门 + 发散档 + 审计列）+ stop-gate（Stop 发火缺 DELTA 即 exit 2 逼补）+ mirror-gate（SessionStart 开机注入自省体检卡=被看见的眼睛 + 留痕）——把"每轮强制""被看见"从 Markdown 软纪律下沉到 harness 强制
- **复盘回流闭环**：DELTA 证据账本 + 白发刹车——"发火 → 复盘 → 自校准/刹车"
- **SKILL.md 统一格式**：YAML frontmatter + markdown 指令，BMAD-METHOD 启发
- **三层定制化**：默认 → 团队 → 个人，TOML override 不改核心文件
- **Codex CLI 一等公民**：评审层完全由 Codex 驱动，6 种评审模式
- **Codex Ultracode 等价模式**：Codex 项目默认 `xhigh`，`$ultracode` 承载 Claude ultracode 的动态 workflow/fan-out/对抗验证语义
- **BMAD 质量机制**：对抗式评审（≥10 问题）、冻结块、就绪自检（RC 内联进策）
- **MCP 深度集成**：12 个 MCP 服务器编排（serena/playwright/exa/see/context7/sequential-thinking 等）
- **Party Mode**：真并行 subagent spawn

## 快速开始

```bash
/co-init              # 初始化项目协作体系
/co-auto <任务>       # 全自动模式
/co-review <file>     # 召唤烛评审
/co-research <topic>  # 召唤织调研
/co-status            # 协作健康仪表盘（含 DELTA 覆盖 / 白发率）
```

## 架构

```
Layer 1: 核心智能（Claude Code Opus）
Layer 2: Skill 体系（skills/ — 14 SKILL.md：5 命名 Agent + 9 工具 skill）+ .claude/hooks/ harness 扳机
Layer 3: 独立验证（Codex CLI + grok-4.5）
Layer 4: 最小治理（rules.md v3.4 + guardrails/ + .claude/hooks/ 三件套）
```

## 版本历史

- **v3.4.3**（2026-07-16）— mirror-gate 契约驱动重构（终结六轮补丁循环，烛 R7 SECURE）+ 织换 grok 驱动（gemini→grok-4.5 完全替代，key 走环境变量）。源：D-2026-07-16-004 + D-2026-07-16-005
- **v3.4.2**（2026-07-16）— 双地落漂移哨兵接电：mirror-gate 加开机双地落漂移哨兵（宪法+人格 2 对三态防假绿灯），rules 倒挂类 bug 开机即现；SOUL 双地落尝试→烛照设计缺陷→回滚；v3.4.1 版本入口全域对齐。
- **v3.4.1**（2026-07-13）— MCP/skill 审计诚实债勘误：全量 MCP+skill 亲验（磁盘/网络）+ 鉴异构复核（85/100）。spec-workflow 平反（v3.2「卸载」未兑现，现役）+ see/web-reader/web-search-prime 平反 + 运行时层修复（删 browserwing + github 迁官方 remote 待填 PAT）。
- **v3.4.0**（2026-06-14）— 全面审查后优化落地：36-agent 审查 + 烛终审 + 鉴人格审，落 E 发散注入器、G1/G2 路由审计与假阳过滤、C mirror-gate 留痕、D MCP 去腐捞真金、A 诚实债勘误、H 人格去重首批。
- **v3.3.0**（2026-06-12）— 四维深度完善（ELEVATION）：42-agent 诊断"引擎接电但灯没人开过"→ 新增 mirror-gate 开机自省体检卡 + 校正 route-gate 准星 + stop-gate 扩 synthesis__（DELTA 扳机已接电，真会话未触发）+ 关系记忆播种 + 减法。真·dogfood：烛评审 hook 抓 2 致命主驾全修
- **v3.2.0**（2026-06-11）— harness hook 接电：route-gate/stop-gate 把路由门+DELTA 从 Markdown 软线下沉到 harness 硬扳机；砍死流程 + 卸 spec-workflow MCP（后经 v3.4.1 勘误：未兑现，现役）+ 诚实债
- **v3.1.2**（2026-06-01）— 参照 Trellis 完善：DELTA 复盘账本 + 白发刹车 + 工作区根规则 + claude-flow 诚实降级 + 文档↔磁盘对齐
- **v3.1.0**（2026-05-28）— 激活缺口修复：每轮强制路由门
- **v3.0.0**（2026-05-27）— Skill 驱动重构：BMAD 启发 / 5 命名 Agent / SKILL.md 统一格式 / 三层 customize / 对抗式评审
- v2.0.x（2026-05-26）— 能力放大重构
- v1.0-v1.9（2026-05-21~25）— 三方协作初版~深度协同

详见 `CHANGELOG.md`。
