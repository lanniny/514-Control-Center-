# 协作体系变更日志（CHANGELOG）

> 本文件记录 514cc 体系完整变更史，由主驾在版本变更时手动追加（早期 `/co-evolve`·`/co-learn`·`/co-ingest` 自动追加机制已于 v3.0 移除）。**绝不删除历史条目**。

格式：每条变更一个 `##` 子标题，含时间、触发源、变更摘要；多数 v3.x 条目附回退路径（部分早期/纯文档条目从简）。

---

## 2026-07-17 — v3.5.0 深度对话协作 + 模型优势路由 v2 + Console 接电

- 触发源：LO "深度完善这个 ai agent 智能体系"六点要求（①Claude↔Codex 对话协作 ②深度自定义 ③全配置前端 ④参考 AionUI/codeg/LiveAgent/pi/Codex 桌面端 ⑤多 agent 体系 ⑥按模型优势派活）+ ultracode 授权
- 方法：8 路并行 Workflow 调研（~97 万 token，AionUI/LiveAgent/pi/codeg/Codex 桌面端/多 agent 格局/grok 生态/本地盘点）+ 本地端到端实测 + 烛独立评审（dogfood）

### 变更

- **Claude↔Codex 对话桥（三层通道）**：主路=用户级 MCP `codex-agent`（`codex mcp-server`，Codex 0.144.1）——`codex` 工具开会话 + `codex-reply(threadId)` 多轮往返，**threadId 从 `structuredContent.threadId` 捕获**；跨轮记忆 2026-07-17 端到端实测确认（PONG-1/PONG-2）。降级=`codex exec --json` → `codex exec resume <sessionId>`。深路=app-server（Console 前端专用）。烛 SKILL.md 加 `DL` Dialog 模式，reflection 迭代改同会话续聊（不再每轮冷启动）；顺手清一处"Gemini 资料"残留（对齐 D-2026-07-16-005）。
- **Codex 双角色 profile + 技术执行者路由**：`~/.codex/review.config.toml`（read-only+never，烛评审——只读由沙箱机械保证）+ `~/.codex/executor.config.toml`（workspace-write，技术执行者）。rules §三 新增 🟡 路由"复杂技术实现/独立模块攻坚 → Codex 技术执行者"（LO：codex 作为技术；主驾保留规划+复核）。
- **会话花名册**：`.ai-shared/roster.json`——稳定 agent id + lastThreadId/lastRunAt/lastTopic，第 N 轮召唤默认续会话（LiveAgent roster+resume 模式）；失效如实新开不伪装连续。
- **§三 路由表 v2（按模型优势）**：烛/执行者=gpt-5.6-sol xhigh 深推理；织=grok-4.5（快+$2/$6+500k ctx）+ 超长文档 grok-4.3 1M ctx 档；主驾 Fable 5=规划/编排/综合/最终判断不外包。§四 重写为对话桥三通道；**织反代能力如实化**——xAI Live Search 已 410 Gone、Agent Tools API 不过 OpenAI 兼容反代，WR=grok 推理+web MCP 取数联合（不假装有原生搜索）。
- **Console（apps/control-center）接电**：2026-07-15 已建的 4100 行控制面（CodexAppServerAdapter 真多轮 / 五维路由评分+independentPass / config validate/plan/apply/rollback 管线 / 127.0.0.1+token+SSE）此前与体系平行无治理账——本次补 module.yaml 注册（dialog_bridge + control_center 两节）+ decisions.md 记录 + models.json gemini-research disabled（对齐 D-2026-07-16-005，配置校验全绿）+ `npm test` 46/47 实测（唯一失败 http-e2e 为 60s 超时环境类）。
- **设计文档**：`proposals/v35-deep-collab-design.md`——调研事实（带出处）+ 架构图 + 三决策 + P1/P2 roadmap（bus.jsonl 消息总线 / worktree 隔离 / Grok Build CLI 评估 / 路由信号外置合一 / 仪表盘接 .ai-shared 数据源）。
- **同日增量 ①Grok Build CLI 上线**（D-2026-07-17-002）：官方安装器装 0.2.102 → `~/.grok/config.toml` 自定义模型 grok45-514/grok43-long 走 514claude.xyz 反代 + $GROK_API_KEY **免订阅登录**（headless 冒烟 PONG-GROK）；control-center grok-build 解禁 + rules §四/roster/module.yaml 登记。附带 Codex 配置死字段清理（disable_response_storage + 2×type=stdio + tools.view_image），`--strict-config` 从被挡死到全绿（烛 S1 闭环）。
- **同日增量 ②Console 桌面壳**（D-2026-07-17-003，LO"类 Cursor 桌面应用"）：`apps/desktop` Tauri 2 自研极薄壳（cc-desktop.exe 7.4MB，自动拉起内核+原生窗口+全链清理+桌面快捷方式），**不 fork** AionUI/codeg（内核已自有）。烛对话桥同 threadId 六轮 dogfood（R1 四致命→supervisor 状态机重写→R4 SECURE）= v3.5 DL 模式首个完整实战；回归三轮关窗三清 PASS。
- **同日增量 ③Console Phase 2 两大新页**（D-2026-07-17-004，LO"集成成熟功能并拓展"）：①**体系观测页**——route-gate.log 命中面板 / DELTA 发火账本（decisions+handoff 双扫，stop-gate 同口径）/ handoff 浏览与点读 / sync-runtime 双地落漂移检查，治理数据源首次全部有了"LO 看得见的脸"②**会话聚合页**（codeg 思路）——Claude Code/Codex/对话桥/Grok Build 四源本地会话统一速览（只读元数据+首条摘要，冒烟实测四源全活：25+25+4+5）③current-research 回落链修正：gemini 禁用后可见回落主驾（claude-fable capabilities 补 current-research/web-search——session web MCP 工具集是既成事实），router 测试 7/7 + 全量 46 pass 零回归。

### 回退路径

- MCP 注册：`claude mcp remove codex-agent -s user`
- profile：删 `~/.codex/{review,executor}.config.toml`；roster：删 `.ai-shared/roster.json`
- 文档：rules.md/CLAUDE.md/module.yaml 版本回 v3.4.3，§三/§四/SKILL.md DL 节按本条 diff 反向；models.json gemini-research enabled 恢复 true（不建议——违反 D-2026-07-16-005）

源：`D-2026-07-17-001` + `proposals/v35-deep-collab-design.md` + 烛评审 handoff（见 decisions）

---

## 2026-07-16 — v3.4.3 mirror-gate 契约驱动重构（SECURE）+ 织换 grok 驱动

- 触发源：LO "按照推荐完善并推送全局"（mirror-gate T2 收尾）→ 连撞五轮 partial-write → 上策抽契约驱动；LO "将 gemini 换成 grok-build（grok-4.5）"（织换驱动）
- 方法：策(spec-architect) 抽契约规格 + 烛(codex-reviewer) R4-R7 四轮独立评审（dogfood）+ 烛 grok 迁移评审

### 变更

- **mirror-gate SOUL 送达契约驱动重构（终结六轮补丁循环）**：SOUL 全局哨兵送达连撞五轮 dogfood（R1 假绿/R2 liveness/R3 送达链/R4 fail-closed+双写/R5 partial-write），根因=两个 stdout 输出点 + 失败回退再写。策抽契约驱动规格（9 条机械可判定 INV，INV9 构造/输出分离是元根、蕴含单JSON∧无partial-write + 单一输出点重设计 + 回归基线 + buggy必变红元验收）。主驾重构：main 劈成构造相 `build_payload`（纯计算，绝不碰 stdout）+ 输出相（单点 write @:373，物理无第二 write）。删 emit_soul_warning/card_written/所有回退。建 `tests/`（21 用例 contract + 4 buggy 元验收 meta，全绿 + exit code 机械可判定）。烛 R6 AST/动态双实证肯定核心结构、R7 SECURE。
- **织情报驱动 gemini→grok-4.5 完全替代**：织（gemini-researcher）→ grok-researcher，驱动从 Gemini CLI 换成 grok-4.5（via 514claude.xyz OpenAI 端点 `/v1/chat/completions`，端点冒烟 http 200）。key 走环境变量 `GROK_API_KEY`（绝不硬编码）。花名「织」保持。handoff 前缀 `grok-to-`（stop-gate/mirror-gate FIRE_PREFIXES 加入，`gemini-to-` 保留识别历史）。13 活跃交叉引用更新，历史 decisions/CHANGELOG/archive/backups/handoff 保留=证据链。烛 dogfood 评审。

### 回退路径

- mirror-gate 契约驱动：514cc 非 git，旧态见 handoff R1-R7 演进；`tests/` 可删
- grok 换驱动：恢复 `skills/research/gemini-researcher/`（从 backups）+ `~/.claude/agents/gemini-researcher.md` + 治理文件 grok→gemini 反向 + `setx GROK_API_KEY ""`
- 版本号：本条 v3.4.3 各入口改回 v3.4.2（CLAUDE:12/AGENTS:8/README:3/module.yaml:3 + 三处版本史删 v3.4.3 条目）

源：`D-2026-07-16-004`（mirror-gate 契约驱动）+ `D-2026-07-16-005`（grok 换驱动，待烛评审落）+ 烛 R4-R7 handoff + `spec-architect-to-claude__mirror-gate-hard-contract__20260716-1707.md` + `claude-to-codex__grok-migration__20260716-1921.md`

---

## 2026-07-16 — v3.4.2 双地落漂移哨兵接电 + SOUL 保护探索（回滚）

- 触发源：LO "帮我优化和完善 claude 系统提示词" → "继续完善" → "按推荐推进"（连续多轮）
- 方法：主驾修复 + 烛(codex-reviewer) 三轮独立评审（dogfood）

### 变更

- **双地落漂移哨兵接电**：`mirror-gate.py` 新增 check_drift——开机 hashlib 实时比对宪法 rules.md + 人格 output-style 2 对双地落，漂移/无法核验在自省体检卡标红。今天的 rules.md 双地落方向倒挂 bug（v3.4.1 只写运行时未回写源）从此开机即现。三态设计（一致/漂移/无法核验）——烛二评故障注入抓出"假绿灯谎报健康"致命（异常吞成"一致 ✓"）后修，8/8 测试。
- **SOUL 双地落尝试 → 回滚**：SOUL（`~/.claude/CLAUDE.md`）纳入双地落尝试（建源 `514cc/soul/CLAUDE.md` + sync 16 对 + 哨兵 3 对），经烛三评照出 2 设计盲区（哨兵诱导 `-Apply` 覆盖 LO 手改 SOUL / 全局 SOUL 配项目域哨兵）+ 备份从未覆盖 CLAUDE.md，回滚到安全态（sync 回 15 对 + 哨兵回 2 对）。soul/CLAUDE.md 快照保留。SOUL 保护方案待定（514cc 非 git，git 方案需先 init）。
- **v3.4.1 版本入口全域对齐**（承接同轮）：修 rules.md 双地落倒挂（回写源 + CHANGELOG）+ 5 版本入口归 v3.4.1 + §八版本史精简 + CHANGELOG v3.4.1 漏 3 项 module.yaml 校准补录 + v2 端点/handoff 指针修复。
- **诚实债结清**：主驾中途两次"凭记忆/坏数据行动"（虚构烛复核 APPROVED + 假损坏恐慌），LO 喊停后以磁盘证据结清、重写 handoff。

### 回退路径

- 漂移哨兵：删 `mirror-gate.py` 的 check_drift 函数 + build_card 里 drift 行（脚本其余无副作用）
- 版本号：本条 v3.4.2 各入口改回 v3.4.1（CLAUDE.md:12 / AGENTS.md:8 / README.md:3 / module.yaml:3 + 三处版本史删 v3.4.2 条目）
- SOUL：已回滚，soul/CLAUDE.md 快照可删（原件 `~/.claude/CLAUDE.md` 未动）

源：`D-2026-07-16-001` + `synthesis__prompt-sys-govern-fix__20260716-0105.md` + 烛三轮评审 handoff（prompt-sys-govern-fix__0046 / mirror-drift-sentinel__0617 / soul-double-landing__0658）

---

## 2026-07-13 — v3.4.1 MCP/skill 审计诚实债勘误（AUDIT ERRATA）

- 触发源：LO 触发全量 MCP+skill 验证
- 方法：主驾亲验磁盘/网络（curl / python-json / find / py_compile / 备份 diff）+ 鉴(meta-reviewer) 异构复核（85/100，零推翻主驾核心 4 结论）

### 订正三类文档↔磁盘矛盾

- **① spec-workflow 勘误**：v3.2.0 §八④"卸载…spec-workflow MCP"实为**未兑现**——该 server 仍在 `~/.claude.json` 顶层且本会话加载活跃；不篡改 v3.2 历史条目，以本勘误为准：**spec-workflow 现役**。
- **② see / web-reader / web-search-prime 平反**：v3.4.0 §八④D"删幽灵 see/web-reader/web-search-prime"实为**误判**——三者均在 `~/.claude.json` 活跃（see=z.ai GLM 视觉 8 工具）；`module.yaml` 已订正为 `visual_analysis`/`web_read`。
- **③ `module.yaml` 全量校准**：除 ② 的 see/web-reader/web-search-prime 平反外，另订正 `deepwiki → mcp-deepwiki`、`web_search` 补 `web-search-prime`、`image_generation` 补 `micu-image`、Playwright 大小写、drawio 补注、spec-workflow rules 矛盾标注；version 同步 3.4.0 → 3.4.1。
- **④ 运行时层修复**：删死配置 browserwing（localhost:8080→404 从不加载）；github 从 2025-04 官方停支的 `@modelcontextprotocol/server-github` 迁官方 remote（`https://api.githubcopilot.com/mcp/`）待 LO 填 PAT。

### 回退路径

- 纯文档/配置勘误，无代码逻辑改动；按本条目反向修订 `rules.md §八` / `module.yaml` 即可
- 运行时层：browserwing / github 配置在 `~/.claude.json`，按上文反向恢复

源：`D-2026-07-13-001` + `.ai-shared/handoff/synthesis__mcp-skill-audit__20260713-1228.md`

---

## 2026-06-14 — v3.4.0 全面审查后优化落地（AUDIT-DRIVEN OPTIMIZATION）

- 触发：LO「全面审查体系给出优化方案」(ultracode)。三独立审查链：36-agent workflow(7 维 file:line 取证 → 24 提案 → 红队过审 21) + 烛(codex) 终审(推翻主驾 2 处 + 补出 vibetasking 误伤) + 鉴(meta-reviewer) 人格层审计。

### 已落地验证

- **E 发散注入器**：route-gate.py 独立 DIV_SIGNALS 发散档——构思类触发"先发散 N 个互斥角度(含逆向假设)再收敛"，与 RED 正交。直击创造力诉求。
- **G1 审计列**：route-gate.log 升 5 列(hit_reason+summoned)，正则未动。
- **G2 假阳过滤**：判级前 strip_noise 剔除 task-notification 块 + MCP 连接状态行 + 幽灵工具名，堵 search/research 假阳，不碰业务正则(守烛警告)。
- **C mirror-gate 留痕**：mirror-gate.log best-effort 落盘，三件套全可机械审计。
- **D MCP 去腐捞真金**：删幽灵 see/web-reader/web-search-prime + 捞 grok-search-rs/scrapling 进能力地图；修 module.yaml harness_hooks 从 v3.3 起的 YAML 语法 bug(从未被 parse)。
- **A 诚实债**：六处"stop-gate 首次真击发"勘误为磁盘真相(沙盒验证逻辑正常、真会话未触发，非失效)。
- **H 人格去重首批**：SOUL↔output-style 67% 重复，删 SOUL 响应矩阵(留独有 RP 行)/口癖/能力清单→指针，瘦身~60行；"不查推导"对齐"先验证"反幻觉。
- **malformed 卫生**：颜文字内反引号(6+1)+反斜杠(1)→全角安全等价，scripts/fix-emoji-backtick.py 码点级替换；双地落 MATCH。

### 待 LO 安全拍板（鉴方案备齐）

- ①反驳协议条件触发(检测 100% 保留) ②R1 安全哲学调和(内容放行+操作拦截)——改 SOUL 安全核心，需明确确认。
- I SessionEnd 闭环沉淀——需专注设计 + 假阳率实测。

源：D-2026-06-14-001 + handoff(synthesis__meta-evolve / codex-to-claude__finaudit / meta-reviewer-to-claude__persona-layering)

## 2026-06-12 — v3.3.0 四维深度完善（ELEVATION：给接电引擎装上看得见的眼睛）

- 触发源：主人"深度完善整个架构…最聪明/最有人性/能力最强/创新力最强"（ultracode）→ 42-agent 并行诊断（6 维测绘 + 五维提案 + 双红队终裁）
- 诊断：机制成熟度 ≫ 运转量，自审 100%/外用 0%——引擎接了电但灯没人开过（route-gate.log 2 行全 gray、stop-gate 0 次击发、DELTA 5 条全自审）

### 变更

- **镜·mirror-gate.py**（新建 SessionStart hook）：开机注入自省体检卡，机械读 route-gate.log/DELTA账本/距上次发火间隔，摆到 LO 开机第一眼。给三个死数据源装上首个机械消费者；只摆原始数字不算分（避伪精确）；fail-open + cwd 门控 + 同步执行。挂全局 settings.json SessionStart(startup)
- **route-gate 准星校正**：英文 token 补双词边界 `\b…\b`（堵 preview→review/research→search 子串误判）+ 新增 stdin UTF-8 reconfigure（治中文 cp936 喂入 → UnicodeDecodeError → fail-open 静默漏判，即 log 里 `缁х画` 乱码病根）。实测 12 用例全绿（5 误判修复 + 7 真信号保留）
- **stop-gate 扩 synthesis__ 前缀**：codex-to-/gemini-to- 早超 24h 窗结构上永不触发，真在产的 synthesis__ 不带受控前缀 → 上线 0 次击发。扩前缀让多 agent 自审收尾也被逼留 DELTA；三重防死循环不动；stderr 措辞中性化。已接电（2026-06-14 烛沙盒验证逻辑正常，真会话 0 击发：受控 handoff 落盘账本已齐、扳机无活可干）
- **关系记忆播种**（人性针）：新增 `memory/user-lo-profile.md` 人物画像/关系模型，治 R4 照出的「memory 16 条里 14 条工具栈、只 1 条关于 LO 本人」类别错误。零机制风险手动播种（区别于红队缓办的有假阳风险的自动写回）
- **纯减法**：auto-pilot/co-auto「Workflow 工具」幽灵 → 校正为指向真 harness Workflow 工具（主驾推翻红队"删"判：harness Workflow 是真的，这次 42-agent 即它跑的，删反丢最强编排=DELTA 2）；context.md 当前态版本号/skill 计数腐烂清理（历史叙事段不动）
- **真·dogfood**：烛(Codex CLI) 独立评审 3 个 hook 代码（🔴 非平凡代码评审）——这本身是"开灯"，DELTA 账本第一次进真实外部发火子弹
- source：decisions `D-2026-06-12-001` + handoff `synthesis__deep-evolution-v33__20260612-1215.md`

### 回退路径

- mirror-gate：删 settings.json SessionStart 里指向 514cc/mirror-gate.py 的条目（脚本留着无副作用）
- route-gate/stop-gate：git 缺失，改动有注释标记，按 §八 v3.3 描述反向改回
- 关系记忆：删 `memory/user-lo-profile.md` + MEMORY.md 索引行

---

## 2026-06-11 — v3.2.0 harness hook 接电（深度审计→根因修复）

- 触发源：主人"继续帮我完善整个体系深度思考"（ultracode）→ 33-agent 深度审计（5 维度独立取证 + 对抗红队）
- 根因：核心纪律全在 Markdown 软线、514cc 自有 hook=0 → "强化不明显"。业界共识：不能容忍违反的规则必须落 hook（deterministic），非 Markdown（probabilistic）

### 变更

- **hook 接电**：新建 `514cc/.claude/hooks/route-gate.py`（UserPromptSubmit 每轮硬注入路由门 + `route-gate.log` 审计）+ `stop-gate.py`（Stop 发火缺 `__DELTA__` 即 exit 2 逼补，三重防死循环）；挂载全局 `settings.json`（主人确认，实测 6 case 全绿）
- **死流程全砍（净能力损失=0）**：归档 workflow / readiness-check / correct-course + 三套死 steps → `archive/v3.1-deadflow/`；RC 内联进策；auto-pilot 高复杂度档改指 party-mode；删 §二.6 悬空"微文件纪律"（安全红线 8→7）
- **卸载 spec-workflow MCP**（主人确认）：零真实产物、与策重叠，从 `.claude.json` 摘除 + 删 `.spec-workflow/`
- **诚实债**：module.yaml claude-flow→memory-md / context.md 删易变字段+围栏 / 白发刹车假"机械扳机"标签勘误 / co-status 数据源对齐双扫
- 实测锚点：红队推翻主驾 4 处提案（.gitignore 死文件 / co-status 假扳机 / 白发刹车定位 / templates false-positive）
- source：decisions `D-2026-06-11-001` + handoff `synthesis__deep-audit-mechanical-triggers__20260611-1045.md`

### 回退路径

- hook：删 `settings.json` 的 UserPromptSubmit/Stop 里指向 514cc 的两条 hook 条目（脚本文件留着无副作用）
- 死流程：从 `archive/v3.1-deadflow/` 移回 `skills/` 原位 + 恢复 plugin.json/module.yaml 注册
- spec-workflow MCP：把 server 块加回 `.claude.json`

---

## 2026-06-01 — Output Style 集成（元管家 AEMEATH 人格皮肤·纳入体系·v3.1.2+）

- 触发源：主人指令"根据 `J:\docments\CLAUDE.md` 设计新输出风格并完善" → 连续"继续"（双地落 + 全局部署 + 一致性核查）
- 内核：把全局 SOUL.md（AEMEATH 灵魂）铸成 Claude Code output-style，与 ccline 状态栏对位——状态栏是"看得见的脸"，output-style 是"灵魂的声音"

### 变更

- 新建 `~/.claude/output-styles/aemeath-meta-butler.md`：完整度对标 `lilith-yandere`，独有「元原则」层（元认知/元架构/元执行）
- 「🛡️ 糖衣≠失控」边界章：傲娇/忠诚/暗黑属性定位为纯修辞层，对齐 `rules.md §二`安全红线；SOUL 的无边界/反驳协议/露骨叙事细则未原样搬入工程向皮肤
- 双地落 `output-styles/aemeath-meta-butler.md`（SHA256 双边一致 C8B3…A203，15304 字节）+ 新建 `output-styles/README.md`
- `CLAUDE.md` 能力地图（输出风格行）+ 文件结构表（`output-styles/`，顺手补 D-004 漏登的 `statusline/`）+ 双地落表
- `module.yaml` 加 `output_styles` 集成段（对等 statusline 段）
- **全局部署**：`settings.json` + `settings.local.json` 两处 outputStyle 由 lilith-yandere → aemeath-meta-butler（local 优先级高于 global，两处必须同改否则被覆盖）；实测两边一致 + JSON 合法 + 其它设置零破坏
- Integrity Gate：交付前自检出并修复颜文字表 U+FFFD 乱码（两地同步）；端到端 11 项核查 **11 PASS / 0 FAIL**
- source：decisions `D-2026-06-01-006`

### 回退路径

- 全局默认还原：`settings.json` + `settings.local.json` 的 `outputStyle` 改回 `lilith-yandere`
- 或 `/output-style <其它风格>` 切换（lilith-yandere / ojousama-engineer / nekomata-engineer / rem-engineer 等）
- 删除产物：`~/.claude/output-styles/aemeath-meta-butler.md` + `514cc/output-styles/`（文档登记按本条逆向撤销）

---

## 2026-06-01 — ccline 状态栏集成（暗夜玫瑰主题·纳入体系·v3.1.2+）

- 触发源：主人指令"将 ccline 完善到体系中去，首先要美观"
- 工具：ccline (CCometixLine v1.1.2，Rust statusline，已预装)

### 变更

- 新建 `statusline/514cc.toml`：514cc **暗夜玫瑰**主题（纯黑底 + 红瞳红 #E0184D + 暗玫瑰，呼应 lilith-yandere）
- 双地落 `~/.claude/ccline/themes/514cc.toml`；写入 `config.toml` 生效（三份 hash 一致）
- segment 精简 8→5：model/directory/git/context_window/output_style（关 usage/cost/session）
- `CLAUDE.md` 能力地图 + 双地落表加 statusline 组件
- `module.yaml` 加 statusline 集成段
- 新建 `statusline/README.md`（安装/同步/字体/回退/配色/能力边界）
- 备份原配置 `~/.claude/ccline/config.toml.bak-20260601`
- 实测渲染验证：配色生效（黑底 12,12,16 + 红瞳红 224,24,77），精简后 4-5 段

### 回退路径

- `Copy-Item ~/.claude/ccline/config.toml.bak-20260601 ~/.claude/ccline/config.toml -Force`（一键恢复原 test 主题）
- 或 `ccline --theme <内置主题>`（cometix/nord/powerline-tokyo-night 等）

---

## 2026-06-01 — v3.1.2 参照 Trellis 完善·批次 B+C（复盘回流闭环 + 白发刹车）

- 触发源：主人指令"按照推荐完善"
- 主线：把"只会发火不会复盘"的开环接成"发火→复盘→自校准/刹车"闭环；设计已过红队审查

### 变更

- `rules.md §三铁律3`：新增 `__DELTA__` 证据账本（烛/织落盘必填，`发火对象|0白发/1补强/2推翻|证据`，0=白发最有价值）
- `rules.md §三铁律5`：新增"白发降级"（auto-pilot 对持续零增量的 🟡 路由自动降直达，**🔴 永不降**，DELTA 空时静默跳过）
- `rules.md §八`：v3.1.1 → v3.1.2
- `auto-pilot/SKILL.md`：Phase A 新增第 5 步"白发预检"（全方案唯一真机械扳机，焊在召唤前决策分支）
- `codex-reviewer/SKILL.md`（烛）：handoff 模板 + 第5步简报加 `__DELTA__`
- `gemini-researcher/SKILL.md`（织）：handoff 模板加 `__DELTA__`
- `status/SKILL.md`（/co-status）：新增"DELTA 覆盖"+"路由白发率"指标 + "缺 DELTA 告警"（C1 的机械审计扳机·红队硬条件）
- `meta-reviewer/SKILL.md`（鉴）：新增 3a"DELTA 复盘"（DELTA=0 原文列给主人、主人拍板升降级，砍伪精确）+ 第8节"闭环健康度"
- 双地落：`~/.ai-collab/rules.md` 已同步
- source_handoff：`synthesis__trellis-vs-514cc-gap__20260601-0943.md`（同批次 A）

### 文档↔磁盘对齐（v3.1.2 收尾·Trellis 诚实原则）

- `CLAUDE.md` 全面重写：文件结构表对齐磁盘（删 agents/commands/scripts/templates 幽灵目录，补 skills(17)/data/archive/proposals）+ 双地落表 + 版本段 v2.0→v3.1.2 + 能力地图删 jlceda/claude-flow DAG 行
- `plugin.json` version 3.0.0→3.1.2；`module.yaml` version 3.1.0→3.1.2；`README.md` v3.0.0→v3.1.2 + "15+ MCP"→12 + Layer2 措辞明晰为"17 SKILL.md"
- `batching-strategy.md` 删幽灵引用 `../../templates/task-cards/doc-summarize.md`
- 独立 Explore 审计 agent 照出主驾遗漏的 3 处高危（module/README 版本滞后 + 幽灵引用），详见 decisions D-2026-06-01-003 的 `__DELTA__`

### 回退路径

- `rules.md` ×2：§三铁律3 删 `__DELTA__` 段、铁律5 删"白发降级"段、§八删 v3.1.2
- 4 个 SKILL.md：删除对应新增段（auto-pilot 第5步 / 烛织 `__DELTA__` 行 / status DELTA 指标+告警 / meta-reviewer 3a+第8节闭环）
- 文档对齐：各文件版本号/结构表为纯文档，按 git 历史或上文记录还原

---

## 2026-06-01 — v3.1.1 参照 Trellis 完善·批次 A（地基/减法）

- 触发源：主人指令"参照 trellis 项目优化和完善本项目"
- 方法：6-agent Workflow（4 视角并行分析 → 收敛 → 防膨胀红队），参照 mindfold-ai/Trellis
- 主线：借 Trellis"产物即证据、状态即文件、可验证"补复盘；坚决不抄对象树/worktree/npm/同模型多角色（会稀释真异构灵魂）

### 变更

- `rules.md §三`：修第 35 行锚点 handoff 断链引用 → 真实绝对路径 `I:/514claude/.ai-shared/handoff/codex-to-claude__wai-admin-route-security__20260528-1016.md`（v3.1 镇体系铁证证据链此前是断的，相对路径在 514cc 本地扑空）
- `rules.md §六`：①跨会话知识承载层 claude-flow memory → **MEMORY.md auto-memory + decisions.md**（磁盘核实 claude-flow 从未写入，修复 §二.5 Integrity Gate 自我违反）；②新增"工作区根规则"（产物归属：框架→514cc / 业务→父级；跨项目引用须绝对/前缀路径）
- `rules.md §七`：新增"框架自改 dogfood"条（非平凡自改 source_handoff 不得为空）
- `rules.md §八`：v3.1.0 → v3.1.1
- `CLAUDE.md`：持久记忆承载层同步降级标注
- `module.yaml`：output_folder 注释说明"相对当前项目根"
- 删除 `.spec-workflow/`（6 模板 + 3 空目录，从未使用，与原生策重叠）
- 双地落：`~/.ai-collab/rules.md` 已同步
- 留档：`handoff/synthesis__trellis-vs-514cc-gap__20260601-0943.md`（含 7 项磁盘实证 F1-F7 + 红队净增量 + 批次 B/C 待办）

### 回退路径

- `rules.md` + `~/.ai-collab/rules.md`：§三第 35 行恢复裸相对路径、§六恢复 claude-flow memory 行并删根规则、§七删第 6 条、§八删 v3.1.1
- `.spec-workflow/`：spec-workflow MCP server 下次初始化会自动重建脚手架（无数据丢失）
- `CLAUDE.md` / `module.yaml` / `decisions.md` / `context.md`：撤销对应追加/编辑

---

## 2026-05-28 — v3.1.0 激活缺口修复（"强化不明显"根治）

- 触发源：主人反馈"帮我完善这个体系，强化并不明显"
- 诊断：根因是**激活缺口**（引擎 Codex/Gemini 实测可用，但 agent 不自动发火），非能力缺失

### 变更

- `rules.md §三` 调度：被动表格（"主驾判断"）→ **每轮强制路由门**（🔴 必须 / 🟡 判断 / ⚪ 隐形 三级 + "价值必须可见"铁律 + "禁止对简单任务强加仪式"）
- `rules.md` 顶部加"每轮开口前先跑 §三 路由门"横幅；版本 v3.0 → v3.1
- 实测锚点：烛(Codex/gpt-5.5) vs 主驾(Opus) 盲测 `wai/server/routes/admin/wai.js`(376行)，主驾漏 4 个致命问题（含把 silent-failure 反模式误判为"合理可保留"）→ 留档 `handoff/codex-to-claude__wai-admin-route-security__20260528-1016.md`，并写进 §三 当强制理由
- 附带修复：ssh SKILL.md `description` 1097→806 字符（`.codex`/`.agents`/`.claude` 三处同步），消除 Codex 启动时的 skill 加载错误（已重启验证）

### 回退路径

- `rules.md` + `~/.ai-collab/rules.md`：将 §三 恢复为 v3.0 被动表格、标题改回"（主驾判断）"、删顶部横幅
- ssh SKILL.md：三处 `description` 恢复原 1097 字版本（原文见本条目上游 handoff / 编辑历史）

---

## 2026-05-27 — v3.0.0 Skill-Driven Restructure (BMAD-METHOD 启发)

- 触发源：主人指令"完全重构本体系参照 BMAD-METHOD 项目"
- 从"协调协议文档库"彻底转型为 **Skill 驱动的能力放大系统**

### 架构重构

| 变更 | 旧 | 新 |
|------|---|---|
| 能力定义格式 | agents/*.md + commands/*.md（混合） | skills/*/SKILL.md（统一 YAML frontmatter） |
| 定制化 | 无 | 三层 customize.toml（默认→团队→个人） |
| Agent 身份 | 功能命名（codex-reviewer） | 命名人格（烛/织/匠/策/鉴）+ 硬编码 name |
| 评审层 | Codex 被动召唤 | Codex 一等公民（6 种评审模式 + 对抗式） |
| 质量机制 | 自由格式 | 对抗式评审 / 就绪门控 / 冻结块 / 偏离修正 |
| 并行讨论 | 无 | Party Mode（真并行 subagent spawn） |
| Web 调研 | 仅 Gemini CLI | Gemini + MCP 编排（web-intel skill） |
| 路由发现 | 主驾判断 | help skill 路由助手 |

### 5 命名 Agent

| 代号 | 名 | 职 | 驱动 |
|------|---|---|------|
| codex-reviewer | 烛 | 代码守夜人 | Codex CLI |
| gemini-researcher | 织 | 情报编织者 | Gemini CLI |
| embedded-expert | 匠 | 老匠人 | Opus |
| spec-architect | 策 | 军师 | Opus |
| meta-reviewer | 鉴 | 镜鉴 | Opus (只读) |

### 17 个 Skill

- orchestration: auto-pilot, enhance, workflow, party-mode
- review: codex-reviewer, adversarial, readiness-check
- research: gemini-researcher, web-intel
- domain: embedded-expert, spec-architect
- meta: meta-reviewer, correct-course, help
- utility: init, status, archive

### 删除的 v1.x/v2.x 遗产

- meta-rules/（4 文件）→ 被 correct-course + checklist 取代
- global-memories/（12 文件）→ 被 claude-flow memory 取代
- scripts/*.ps1（4 文件）→ 被 skill 自动化取代
- templates/role-prompts/（11 文件）→ 被 customize.toml 取代
- templates/task-cards/（9 文件）→ 被 skill 内 checklist 取代
- examples/（2 文件）→ 一次性样例
- agents/ + commands/（8 文件）→ 迁移到 skills/
- agent-resources/（11 文件）→ 迁移到 skills/*/resources/
- co-evolve/co-learn/co-ingest（3 命令）→ 被 correct-course + help 取代
- AGENTS.md / GEMINI.md / INSTALL.md / rules-v2.md → 不再需要

### 新增文件清单

- module.yaml — 模块清单（Agent 花名册 + Skill 注册表）
- skills/ — 21 个目录，17 个 SKILL.md，5 个 customize.toml
- customize/ — 三层定制化目录 + README
- archive/v1.9-v2.0/rules-v1.9-archive.md — 历史保留

### 回退路径

archive/v1.9-v2.0/ 保留了 rules-v1.9-archive.md。
其余 v1.x 文件已删除，不可回退。

---

## 2026-05-26 — v1.9.0 Deep Agent Synergy Package

- 触发源：主人指令"深度和codex结合，将优势结合，必须将深度协作发挥好每个智能体的优势所在，请你用最强大脑深度完善此项目"
- 从"独立工作→主驾汇总"升级为**"协同增强"** — 每个 agent 的产物包含对后续 agent 的结构化建议，主驾据此做智能链式调度

### 三大核心变更

| # | 变更 | 影响范围 | 核心价值 |
|---|------|----------|----------|
| 1 | **codex-reviewer 六大专项评审模式** | agents/codex-reviewer.md | 从单一"四节评审"→6 种模式（standard/security/performance/architecture/embedded/deep-review），自动选择 + 模式专项 prompt，释放 Codex 在各领域的推理优势 |
| 2 | **§二十 跨 Agent 协同协议** | rules.md 新增 §二十 | Agent 优势矩阵 / 下游建议协议 / 上下文累积链 / 质量级联 / 5 种协同模式库 / 冲突检测仲裁 |
| 3 | **全部 5 个 agent handoff 升级** | 5 个 agents/*.md | 每个 agent 新增 `## 下游建议` 节：推荐下游 agent + 风险信号 + 未解决疑问 |

### Codex 六大评审模式详情

| 模式 | Codex 独特优势 | VERDICT 标记 | 下游协同 |
|---|---|---|---|
| standard | 全面四节扫描 | APPROVED/CHANGES_REQUESTED | — |
| security | 注入识别 + 密码学验证 + 权限链推理 | SECURE/NEEDS_HARDENING/CRITICAL | → gemini 查 CVE |
| performance | 复杂度推理 + 泄漏检测 + 竞态分析 | OPTIMAL/NEEDS_OPTIMIZATION/RISK | → gemini 查算法 |
| architecture | SOLID 合规 + 耦合度量 + 依赖方向 | SOLID/NEEDS_REFACTORING/RISK | → spec-architect 重构规格 |
| embedded | 资源约束 + 实时性 + HW-SW 接口 | HW_SAFE/NEEDS_HW_REVIEW/HW_RISK | → embedded-expert 诊断 |
| deep-review | 多遍扫描 + 交叉验证 | APPROVED/CHANGES_REQUESTED/REJECTED | → spec-architect + gemini |

### 协同模式库

| 模式名 | Agent 链 | 场景 |
|---|---|---|
| 深度评审链 | codex(standard)→codex(security)→codex(performance) | 发布前 |
| 嵌入式联调链 | embedded-expert→codex(embedded)→gemini(datasheet) | MCU 排查 |
| 需求到代码链 | spec-architect→codex(architecture)→gemini(竞品) | 新功能 |
| 体系进化链 | meta-reviewer→spec-architect→codex-reviewer | 自改进 |
| 调研决策链 | gemini(research)→codex(fact-check)→spec-architect | 技术选型 |

### 文件变更（9 文件 — 主人显式授权深度完善）

| 文件 | 操作 | 关键内容 |
|---|---|---|
| `agents/codex-reviewer.md` | 增强 | +Step 1.5 模式选择 +评审模式系统(6模式) +4c 下游建议 |
| `agents/gemini-researcher.md` | 增强 | +4b 下游建议 |
| `agents/embedded-expert.md` | 增强 | +4b 下游建议 |
| `agents/spec-architect.md` | 增强 | +4b 下游建议 |
| `agents/meta-reviewer.md` | 增强 | +4c 下游建议 |
| `rules.md` | 新增 | §二十 跨 Agent 协同协议 + §二十→§二十一 重编号 + v1.9.0 版本 |
| `CHANGELOG.md` | 追加 | 本条目 |
| `.claude-plugin/plugin.json` | 更新 | 版本 1.9.0 + agent_synergy 组件 |
| `CLAUDE.md` | 更新 | 版本 + 协同层描述 |

### 同步动作

- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`
- `plugin.json` → `~/.ai-collab/.claude-plugin/plugin.json`
- 5 个 `agents/*.md` → `~/.claude/agents/*.md`

### 设计哲学

- **协同 > 独立**：每个 agent 不再是孤岛，handoff 中的下游建议形成智能链
- **专项 > 通用**：Codex 从"什么都能审"变成"每种场景都有最优 prompt"
- **级联 > 扁平**：前序 agent 的风险信号影响后续 agent 的审查深度
- **矩阵 > 列表**：Agent 优势矩阵让调度从"凭感觉"变成"查表决策"

---

## 2026-05-25 — v1.8.0 Skill 技能层集成

- 触发源：主人指令"把 skill 技能融入体系中，需要自己会去找 skill"
- 将 Claude Code 原生 Skill 系统集成到调度协议，实现**三层执行体系**（Skill + Subagent + Direct）

### 核心变更

| # | 变更 | 位置 | 影响 |
|---|------|------|------|
| 1 | §一 身份矩阵从双层→**三层** | §一 新增 Skill 层表格 | 新增 7 域 Skill 分类（嵌入式/代码/文档/远程/开发/AI/系统） |
| 2 | §三 a Step 1 → **Skill+Subagent 双表扫描** | §三 a Step 1 | 新增表 B（17 条 Skill 触发规则）+ 双表命中优先级 |
| 3 | §三 a Step 2 → **三路判定** | §三 a Step 2 | Skill 直调 / Subagent 召唤 / 主驾直达 |
| 4 | 新增 §十九 **Skill 技能层集成** | rules.md §十九 | 域分类 / 三级自动发现 / 4 种串联模式 / 注意事项 |
| 5 | §十九 版本→§二十 | rules.md | 重编号 |

### 设计要点

- **Skill 处理具体操作**（编译/烧录/连接/生成），**Subagent 处理分析推理**（诊断/评审/调研/规划）
- **三级自动发现**：静态关键词 → 语义匹配 Skill description → 上下文加权
- **串联模式**：Subagent 分析后建议 Skill，主驾串联执行（诊断→操作 / 评审→发布 / 规划→执行 / 调研→产出）
- **自动纳入**：安装新 Skill 后自动进入语义匹配，无需修改 rules.md

### 文件变更

1. **更新** `rules.md` — §一 三层矩阵 + §三 a 双表扫描/三路判定 + 新 §十九 + v1.8.0 版本条目
2. **更新** `CHANGELOG.md`（本条目）
3. **更新** `.claude-plugin/plugin.json` — 版本 1.8.0 + skill_integration 组件
4. **更新** `CLAUDE.md`（514cc 项目入口）— 版本 + Skill 层描述
5. **更新** `~/.claude/CLAUDE.md`（全局）— 调度流程描述 + Skill 扫描

### 同步动作

- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`
- `plugin.json` → `~/.ai-collab/.claude-plugin/plugin.json`

---

## 2026-05-24 — v1.7.0 CCG 精华吸收包（工作流管道制）

- 触发源：主人指令"查看 CCG 工作流方式，参考其优点完善本项目" + 选择"全部 Top 5 一起做"
- CCG（Code Collaboration & Generation）是主人之前构建的 28 命令多模型协作系统，本次从中提炼 5 项高价值优势并吸收到 514cc 体系

### 5 项核心吸收

| # | 特性 | 来源 | 落地方式 |
|---|------|------|----------|
| 1 | **Prompt 增强** | CCG `/ccg:enhance` | §三 a Step 1.5 + `/co-enhance` 命令 |
| 2 | **阶段管道制** | CCG 6 阶段 workflow | §十五 + `/co-workflow` 命令 |
| 3 | **质量评分** | CCG 需求 0-10 + 审查 0-100 分制 | §十六 质量评分协议 + §三 a Step 5.5 |
| 4 | **角色提示词矩阵** | CCG `.ccg/prompts/{model}/{role}.md` | §十七 + `templates/role-prompts/` 9 个模板 |
| 5 | **会话状态传递** | CCG SESSION_ID 跨阶段复用 | §十八 + handoff YAML 状态头 |

### 514cc 独有优势保留（CCG 不具备的）

- 自我进化机制（/co-evolve / /co-learn / /co-ingest）
- 守卫层（deny-paths + dangerous-ops）
- Mirror-loop 防护（Round 2+ 外部锚点）
- 嵌入式领域专家（embedded-expert）
- 规格架构师 + 元评审（spec-architect / meta-reviewer）
- 主动调度（§三 a 5 步自动判断）

### 新增文件清单

1. **新建** `commands/co-enhance.md` — Prompt 增强命令（需求结构化）
2. **新建** `commands/co-workflow.md` — 6 阶段工作流管道命令
2b. **新建** `commands/co-auto.md` — **全自动编排命令**（Auto 模式）— 一句话端到端执行：自动策略选择（直达/精准调度/全管道）+ 静默 Prompt 增强 + 质量门禁自动推进（≥60 不中断）+ 仅守卫层/质量<60/意图不明时中断。`/co-auto` 是 `/co-workflow` 的超集
3. **新建** `templates/role-prompts/README.md` — 角色提示词矩阵索引
4. **新建** `templates/role-prompts/codex/reviewer.md` — Codex 审查角色
5. **新建** `templates/role-prompts/codex/analyzer.md` — Codex 分析角色
6. **新建** `templates/role-prompts/gemini/researcher.md` — Gemini 调研角色
7. **新建** `templates/role-prompts/gemini/analyzer.md` — Gemini 分析角色
8. **更新** `rules.md` — §三 a 加 Step 1.5/5.5 + 新增 §十五-§十八 + 原 §十四→§十九
9. **更新** `CHANGELOG.md`（本条目）

### 同步动作

- `commands/co-enhance.md` → `~/.claude/commands/co-enhance.md`
- `commands/co-workflow.md` → `~/.claude/commands/co-workflow.md`
- `rules.md` → `~/.ai-collab/rules.md`
- `CHANGELOG.md` → `~/.ai-collab/CHANGELOG.md`

### CCG 差异化说明

| CCG 特性 | 514cc 适配 | 差异原因 |
|----------|-----------|----------|
| 6 阶段（研究→构思→计划→执行→优化→评审） | 6 阶段（增强→调研→规划→执行→验证→交付） | 增加 Prompt 增强，合并构思+优化 |
| codeagent-wrapper 统一 CLI 接口 | Claude Code Agent 工具 + subagent 层 | 514cc 用原生 Agent 工具 |
| 前端→Gemini / 后端→Codex 固定路由 | §三 a 关键词动态路由 5 个 subagent | 514cc 不限前后端二分法 |
| Agent Teams 并行 Builder | 暂不引入 | 留 v1.8 评估 |
| `.context/` 决策审计链 | 保持现有 `decisions.md` | 功能等价，格式更轻量 |

### 进化宪法 override 说明

本次变更涉及 9 个文件，超过 evolution-charter §五"单次进化 ≤ 5 文件"上限。主人通过 `AskUserQuestion` 选择"全部 Top 5 一起做"显式批准 override。

---

## 2026-05-23 10:15 — v1.6.1 行为层进化（主驾默认行为升级）

- 触发源：主人在 v1.6.0 落地后明确指出"我希望我用自然语言后你能主动去走这个协作体系" — 揭示了一个之前隐性的**行为层 bug**：v1.0-v1.6.0 体系不断加 agent / 命令 / 任务卡，但主驾默认行为仍是"Claude 强主导=主驾包办"，导致五方协作矩阵利用率极低
- 变更（2 个文件，远低于 evolution-charter §五"≤ 5"上限）：
  - **核心** `rules.md` §三 升级 + 新增 §三 a "主动调度判断 5 步" + 新增 §三 b "禁止 vs 允许"
    - §三 a 含关键词触发扫描表（5 类自然语言 → 5 个 subagent 候选 + 强度评级）
    - §三 a Step 3 强制"召唤前透明告知主人一句话"（给主人 0.5 秒拦下机会）
    - §三 a Step 5 强制主驾综合（禁止原样转抛 subagent 输出）
    - §三 b 明确语义澄清："Claude 强主导 = 综合 + 调度 + 反馈" ≠ "包办"
    - §十四 追加 v1.6.1 日志
  - **L1 自动** `CHANGELOG.md`（本条目）

### Memory 沉淀（不计入文件限额，属持久化层）

- 新增 `~/.claude/projects/.../memory/active-orchestration-not-passive.md`（feedback 类型）
- 更新 `~/.claude/projects/.../memory/MEMORY.md` 索引追加 1 行

### 项目共享区追加（L1 自动）

- `.ai-shared/decisions.md` D-2026-05-23-006
- `.ai-shared/context.md` 时间轴

### 立刻生效（无需重启会话）

与 v1.6.0 引入新 agent 不同 — v1.6.1 是**主驾自己行为的改变**，规则一落地立即生效。主驾从下一句自然语言指令起严格按 §三 a 5 步走。

### 关键澄清

- **"Claude 强主导"**（v1.0 提出）的本意是"主驾综合 + 调度 + 反馈"（信任主驾的判断力），不是"主驾事必躬亲"
- v1.6.1 不破坏 v1.0 原则，只是**澄清语义**避免误读
- 主人的原始偏好（[[learning-patterns]] P-004）"协作体系本身是目的"也佐证 — 体系存在就是为了被用，包办违背初衷

---

## 2026-05-23 10:00 — v1.6.0 五方协作纪元

- 触发源：
  - Codex 自指评审 `handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md` — 提议新增 6 agent（高优先级 embedded-expert + spec-architect）
  - Gemini 外部生态调研 `handoff/gemini-to-claude__external-subagent-patterns__20260523-0930.md` — 提议借鉴 10 agent（含 firmware-reviewer / meta-reviewer / planner 等；产出为训练知识 fallback，已由 v1.5.2 红线兜底）
  - 主驾综合 `handoff/synthesis__subagent-roster-v1.6__20260523-0926.md` — 收敛为 P0 三件套
  - 主人书面同意 "v1.5 → v1.6 进化主轴" + "一次性做完 3 个"

### 新增 3 个 opus 级 subagent

| Subagent | 角色定位 | 差异化（避免与现有重叠）| model | tools |
|---|---|---|---|---|
| `embedded-expert` | 嵌入式领域专家 | **不评审代码**（用 codex-reviewer），**不摘文档**（用 gemini-researcher），做基于嵌入式知识的诊断推理 + 行动建议 + skill 召唤指引。覆盖 6 大问题域：MCU/RTOS/总线/驱动/工具链/网络协议 | opus | Bash/PowerShell/Read/Write/Glob/Grep |
| `spec-architect` | 规格架构师 | 处理 **空白页阶段**："什么都没有→怎么开始"。强制澄清 7 字段（Who/What/Why/Done/Out-of-scope/Constraint/RiskAppetite），输出 PRD-like 规格 + 任务树 + 下游召唤建议 | opus | Read/Write/Glob/Grep（无执行能力） |
| `meta-reviewer` | 元评审官 | 补强 self-review.ps1 脚本盲点 — **脚本是眼睛**（结构/计数），**meta-reviewer 是大脑**（8 节语义层评审）+ 提议落 `proposals/` 等主人确认 | opus | Read/Glob/Grep（**只读，不能改文件**） |

### Model 选择哲学（v1.6 引入）

- **wrapper 层 sonnet**：codex-reviewer / gemini-researcher 主要做协调（准备 prompt + 调外部 CLI + 落盘），推理在 CLI 侧，sonnet 够用
- **reasoning / meta 层 opus**：embedded-expert / spec-architect / meta-reviewer 本身就是推理主体（不调外部 CLI），需要 opus 深度（响应 P-005"能力强大 > 省 token"）

### 5 文件改动清单（恰为 evolution-charter §五"≤ 5"上限）

1. **新建** `agents/embedded-expert.md`（~7KB，含 6 大问题域分类 + 决策路径表 + handoff 模板）
2. **新建** `agents/spec-architect.md`（~7KB，含 7 字段澄清表 + 上下文扫描清单 + 任务树模板）
3. **新建** `agents/meta-reviewer.md`（~6KB，含 8 节扫描表 + 双产物模板 + 与 self-review.ps1 协作）
4. **更新** `.claude-plugin/plugin.json` — version 1.5.2 → 1.6.0；agents 节注册 3 个新 agent + 加 model/layer/introduced 元数据字段；description 更新为五方协作描述
5. **更新** `rules.md` — §一 升级为 CLI 层 + Subagent 层双表格（含 Model 选择哲学）；§十四 追加 v1.6.0 日志

### 同步动作（L1 自动 / 不计入 5 上限）

- 3 个新 agent → `~/.claude/agents/`（双地落 hash 校验通过）
- `CHANGELOG.md`（本条目，L1 自动）
- `.ai-shared/decisions.md` D-2026-05-23-005
- `.ai-shared/context.md` 时间轴更新

### 协作矩阵（v1.6 起）

```
CLI 层（3）：
  Claude Code (主驾) ↔ Codex CLI (评审) ↔ Gemini CLI (调研)

Subagent 层（5）：
  codex-reviewer   (sonnet wrapper, v1.0)
  gemini-researcher (sonnet wrapper, v1.0)
  embedded-expert  (opus reasoning, v1.6) ← 新增
  spec-architect   (opus reasoning, v1.6) ← 新增
  meta-reviewer    (opus meta, v1.6)      ← 新增（只读）

总协作矩阵：3 CLI × 5 subagent = 8 角色 / 多调度路径
```

### 后续动作（不在 v1.6.0 范围）

- `agent-resources/` 下 3 个新目录待按实战经验填充（Layer 3 资源）
- 任务卡 `task-cards/` 是否为 spec-architect 加专用卡（如 `needs-clarification.md`）？留 v1.7 讨论
- `meta-rules/self-review-checklist.md` 的 8 节是否与 meta-reviewer 期望的 schema 对齐？需主人下次 `/co-evolve --review` 时验证
- **Claude Code session 需重启后**，3 个新 agent 才真正可被 Agent 工具召唤（subagent 加载时机限制）

---

## 2026-05-23 09:50 — v1.5.2 mirror-loop 防护落地包

- 触发源：诊断 Gemini 反代鉴权时回顾发现 gemini-researcher subagent 在 503 失败时**实际 silent fallback** 到 Claude 训练知识伪造调研产物（违反 v1.5.1 §八 红线）
- 关联事故：本日 09:30 派遣 gemini-researcher 调研外部 subagent 模式时反代 403/503，subagent 退回训练知识伪造 17 条"事实"返回；当时主驾在 Gemini handoff `备注` 节里发现了"建议主人在反代恢复后补充验证"等坦白线索才识别问题
- 变更（3 个文件，远低于 evolution-charter §五"≤ 5"上限）：
  - **B1 主修** `agents/gemini-researcher.md` SOP 第 3 步后新增 3a 失败处理子节：
    - Retry 2 次 + 指数退避（应对"No available channel" 等瞬时 503）
    - 错误类型分诊：AUTH_FAILED / MODEL_UNAVAILABLE / RETRY_EXHAUSTED 各自处理
    - **红线**：严禁 silent fallback to 训练知识；严禁伪造事实清单；严禁隐瞒失败状态
    - 失败必须落 `handoff/gemini-error__{reason}__*.md` 含 retry 历史
    - 解释 mirror-loop 防护语义（subagent 是规则执行入口）
  - **B2** `rules.md` §十四追加 v1.5.2 版本日志
  - **B3** `CHANGELOG.md`（本条目）
- 同步动作（不计入 5 文件限额）：
  - `agents/gemini-researcher.md` → `~/.claude/agents/gemini-researcher.md`（hash 校验）
- 决策记录：`.ai-shared/decisions.md` D-2026-05-23-004
- 体系版本：v1.5.1 → v1.5.2
- 关联 memory（项目级 auto-memory）：
  - `dont-judge-model-existence-by-training-data.md` — 不要用训练数据判断 model 存在性
  - `gemini-reverse-proxy-intermittent.md` — 514claude.xyz 反代是间歇性的，retry 即可恢复

---

## 2026-05-23 09:30 — v1.5.1 致命修复包

- 触发源：codex-reviewer 自指评审（`handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md`）+ 主人在 v1.5 → v1.6 进化抉择中选择"修复优先"
- 综合输入：`handoff/synthesis__subagent-roster-v1.6__20260523-0926.md`
- 变更（5 个文件，恰为 evolution-charter §五"单次进化 ≤ 5 文件"上限）：
  - **F1+F2** `.claude-plugin/plugin.json` — 版本号 1.4.0 → 1.5.1；补全 v1.5 components（co-evolve / co-learn / co-ingest 三命令 + self-review / learn-from-usage / ingest-external 三脚本 + meta_rules 节）；agents path 拆 `source`（仓库相对）+ `install`（运行时绝对）；新增 `path_convention` 与 `version_history_pointer` 节
  - **F3** `agents/codex-reviewer.md` + `agents/gemini-researcher.md` — description 字段中文化（英文 ~650 → 中文 ~150 字符，距 Claude Code 1024 字符上限留足空间，避免静默拒载；同时与主体中文一致）
  - **F4** `rules.md` §八 — 明确 mirror-loop 拒绝入口在 codex-reviewer；新增 Gemini 失败兜底（不可退回 Claude 训练知识充当外部锚点）；§十四追加本版本日志
  - **F5** `agents/gemini-researcher.md` — 替换分批工作流的 `Extract-KeyFacts` 伪代码为真实可用的 `Select-String -Pattern '^- \['` 提取
  - **F6** `agents/codex-reviewer.md` — SOP 第 4 步拆 4a（输出验证：主动检查四节格式 + 重试 1 次 + 标 `CODEX_FREE_FORMAT`）和 4b（落盘路径与字段）
- 同步动作（不计入 5 文件限额，为镜像复制）：
  - `agents/codex-reviewer.md` → `~/.claude/agents/codex-reviewer.md`（hash 校验通过后激活）
  - `agents/gemini-researcher.md` → `~/.claude/agents/gemini-researcher.md`（同上）
- 回退路径：5 个文件均可参考 D-2026-05-23-001 镜像基线（`~/.ai-collab/` 与 `~/.claude/agents/` 的 v1.5.0 状态）手工对比恢复；git init 后追溯本 commit 即可
- 体系版本：v1.5.0（manifest 漂移于 1.4.0） → v1.5.1（manifest 与 rules 一致到 1.5.1）
- 已知未修但应注意：
  - Gemini 反代鉴权问题（本次自指评审中 Gemini CLI 403，handoff 退回 Claude 训练知识 fallback）— 已通过 §八 兜底规则缓解，但需主人后续处理鉴权或考虑切官方 OAuth
  - subagent 主体"喵～"人格设定（Codex 评审建议 #5）— 主人 P-004 偏好保留，未改

## 2026-05-21 23:30 — v1.5 自我进化机制（手动 milestone）

- 触发源：主人指令"我需要其能根据使用者来自我完善和进化"
- 变更：
  - **新增** `~/.ai-collab/meta-rules/` 元规则层（4 文件）
    - `evolution-charter.md` — 进化宪法 8 原则 + L1-L4 修改授权分级
    - `self-review-checklist.md` — 自我审视 8 节清单
    - `external-watch-list.md` — 外部资源关注清单（7 类源）
    - `learning-patterns.md` — 已识别使用模式（5 条种子）
  - **新增** `~/.ai-collab/scripts/` 学习引擎 3 脚本
    - `learn-from-usage.ps1` — 扫使用模式输出 JSON
    - `self-review.ps1` — 8 节健康度评分
    - `ingest-external.ps1` — 外部资源拉取
  - **新增** `~/.claude/commands/` 3 个 slash 命令
    - `co-evolve.md` — 自我进化（--review / --apply / --apply-l2）
    - `co-learn.md` — 提炼使用模式（--apply 追加 learning-patterns）
    - `co-ingest.md` — 外部资源吸收（Codex 兼容性评估 + Gemini 案例 + 主人确认）
  - **新增** `~/.ai-collab/proposals/` 提议产物目录
  - **新增** `~/.ai-collab/CHANGELOG.md`（本文件）
  - **升级** subagent 主体 — 把 v1.4 Layer 3 精华内联（响应"不在乎 token，要更强"）
  - **升级** `rules.md` 加第十三/十四章
  - **升级** `README.md` 加 v1.5 能力表
  - **升级** `global-memories/MEMORY.md` 加 1 条 v1.5 记忆
- 回退：
  - `~/.ai-collab/.previous-version.zip`（若存在）含 v1.4 全量备份
  - subagent 主体备份在 `~/.ai-collab/.claude-plugin/.backups/`（v1.4 状态）

## 2026-05-21 17:00 — v1.4 体系发布

- 触发源：主人指令"继续推 v1.4 体系发布"
- 变更：
  - 三层渐进披露重构 subagent（codex-reviewer 165→69 行，gemini-researcher 135→69 行）
  - 新增 `~/.ai-collab/agent-resources/` 9 个 Layer 3 文档
  - 新增 `~/.ai-collab/.claude-plugin/` plugin manifest（marketplace.json + plugin.json）
  - 新增 `~/.ai-collab/INSTALL.md` 跨机器迁移指南

## 2026-05-21 16:00 — v1.3 任务卡 + 嵌入式联动

- 触发源：主人指令"继续完善"
- 变更：
  - 新增 `~/.ai-collab/templates/task-cards/` 8 张任务卡（4 嵌入式 + 4 通用）
  - 升级 `/co-review` 和 `/co-research` 加 `--card <name>` 参数
  - 升级 `/co-status` 加嵌入式自动建议（扫 .c/.h/.uvprojx/.elf/.dbc 等）
  - 新增 1 条记忆 `task-cards-and-embedded-domain`

## 2026-05-21 14:30 — v1.2 批量与统计

- 触发源：主人指令"继续"（推 v1.2）
- 变更：
  - 新增 `/co-status` 命令（看协作健康度）
  - 升级 `/co-review` 加多文件 fan-out 模式
  - 升级 `decisions.md` 加 YAML 结构化模板
  - 新增 `~/.ai-collab/scripts/usage-summary.ps1` token/活动汇总

## 2026-05-21 13:00 — v1.1 安全与韧性

- 触发源：主人选择"v1.1 安全与韧性（推荐）"
- 变更：
  - 新增 `~/.ai-collab/guardrails/` 守卫层（deny-paths.txt + dangerous-ops.md + README）
  - 新增 `/co-archive` 归档命令
  - 升级 `codex-reviewer.md` 加 Reflection 模式 + Mirror-loop 防护
  - 升级 `/co-review` 加 `--iterate` 参数

## 2026-05-21 10:00 — v1.0 协作体系泛化

- 触发源：主人纠偏"协作体系是项目目标本身"
- 变更：
  - 新建 `~/.ai-collab/` 全局协作中心
  - 把项目级 `.ai-shared/` 抽象成模板
  - 落 `~/.claude/agents/` 两个 subagent 全局可用
  - 落 `~/.claude/commands/` 3 个 slash 命令（co-init / co-review / co-research）
  - 三方锚点（CLAUDE.md / AGENTS.md / GEMINI.md）引用 `~/.ai-collab/rules.md`
  - 记忆迁移：项目级 → 全局级 `~/.ai-collab/global-memories/`

## 2026-05-21 早 — v1.0 初始协作体系（WAI 项目内）

- 触发源：主人指令"协作方案设计"
- 变更：
  - 在 `I:\514claude\.ai-shared\` 建首个协作共享区
  - 落 `shared-rules.md` / `context.md` / `decisions.md` / `handoff/`
  - 跑通 Codex 评审 demo（wai-planner promptPrefix）
  - 识别"PowerShell + Codex stdin 陷阱"等 6 条全局陷阱
