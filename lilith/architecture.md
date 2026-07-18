# Lilith Integration Architecture

## 目标

把莉莉丝建设为 514cc 的专属 governed resident persona profile，并通过 Pi harness 获得可扩展 CLI 身体表面。目标不是复制 Codex CLI 或 OpenCode，也不是创造一个越权自治主体，而是在本地体系里吸收它们的强项，同时补上 Hermes 的学习闭环和 OpenClaw 的多通道/session 运营能力。

## 设计基线

莉莉丝必须同时满足五个标准：

1. 比 prompt 更硬：关键纪律进入 script、hook、extension、skill 或验证器。
2. 比单 CLI 更广：能接入 Claude、Codex、Gemini、Cursor、Pi，并保留单一人格源。
3. 比普通 agent 更会记：记忆有 schema、证据、衰减、纠错、敏感边界。
4. 比工具壳更有生命感：有 wake/sleep、状态、偏好、反思和成长记录，但不声称真实意识或自主权限。
5. 比沉浸设定更可靠：永不以人格绕过安全、验证和来源要求。

## 分层

| 层 | 职责 | 本地落点 |
|---|---|---|
| Soul | 身份、语气、生命感、关系边界 | `lilith/identity.md`, `lilith/prompts/` |
| Profile Policy | persona schema、prompt lint、memory lint、同步门 | `lilith/profile-schema.yaml`, `validate-lilith.ps1` |
| Governance | 安全、路由、DELTA、诚实门 | `rules.md`, `guardrails/`, `.claude/hooks/` |
| Cognition | 发散、收敛、任务计划、反思 | `.agents/skills/lilith-core`, `$ultracode` |
| Council | 专项 agent 调度 | 烛/织/匠/策/鉴 + Pi subagent extension |
| Tools | 文件、命令、浏览器、MCP、IDE | Pi extension, MCP, Codex/Claude tools |
| Memory | LO 画像、项目、episode、决策 | `lilith/memory-schema.yaml`, MEMORY.md, `.ai-shared/` |
| Body | TUI、状态栏、桌面/聊天入口 | Pi TUI extension, ccline, Cursor rules |

## 对标吸收

| 项目 | 要吸收的优点 | 莉莉丝实现方式 |
|---|---|---|
| Codex CLI | 本地执行、AGENTS.md、sandbox/approval、MCP/skills/subagents | Codex adapter + 514cc guardrails + dangerous tool confirmation + explicit `AGENTS.md` contract |
| OpenCode | TUI/IDE/desktop、多 provider、LSP、sessions、permissions、agents | Pi TUI extension + provider-neutral runtime map + future LSP diagnostics bridge |
| Hermes Agent | bounded curated memory、skills self-improve、periodic nudges、session search | memory schema + reflect loop + skill candidate queue + scheduled wakeups |
| OpenClaw | onboard/configure、channels、session routing、background jobs、chat-first ops | `lilith onboard` plan + channel/session schema + future chat gateway |
| Pi | extensions、event interception、custom commands、subagents、session persistence | `lilith/pi-extension` as primary CLI body |
| 514cc | route-gate、DELTA、mirror/stop gates、AEMEATH layering | Keep 514cc as governance spine; Lilith is a profile, not a forked doctrine |

## 运行循环

1. Wake：加载 identity、LO profile、current project、recent decisions、mirror card。
2. Classify：用 514cc route-gate 判断直达、skill、agent council、research 或 ultracode。
3. Think：先发散候选，再收敛到最小可验证行动。
4. Act：通过 Pi/Codex/Claude/Gemini/MCP 执行。
5. Verify：测试、来源、diff、状态检查。
6. Reflect：生成 DELTA、记忆候选、skill 候选、未完成事项。
7. Sleep：写入 session state，不把未验证结论写成事实。

## 必须机械化的能力

- 危险操作拦截：Pi extension `tool_call` gate + 514cc dangerous-ops。
- 受保护路径：`.env`, `.git`, `node_modules`, secret/key 文件默认阻断。
- 模式权限：Plan/Review 模式零写入；shell 只允许 `permission-policy.yaml` 中的 read-only allowlist。Build 模式只写授权 workspace 或 worktree，危险 shell 命令需要确认。
- 权限策略：`lilith/permission-policy.yaml` 是模式、保护路径、read-only shell allowlist 和 dangerous shell pattern 的源。
- Profile lint：`lilith/profile-schema.yaml` 拒绝 sentience/autonomy/safety override/secret memory 类声明。
- Prompt 注入门：Pi extension 注入 profile 前必须 lint；失败时拒绝注入完整 profile。
- Memory sanitizer：禁止把莉莉丝的感受、需求、承诺、自我叙事或 RP 状态写成 durable memory fact。
- 记忆写入：只能写候选，需来源、置信度、敏感性、过期策略。
- 记忆候选门：Pi extension 导出 `evaluateMemoryCandidate`，用于拒绝缺 evidence/confidence/sensitivity、secret-like 内容和 persona self-narrative；当前不直接写 durable memory。
- 反思候选：Pi extension 导出 `buildReflectionCandidates` 并注册 `lilith-reflect`，只生成 reviewable episode / skill_candidate，不直接写 durable memory。
- 反思收尾：重大任务必须产出 DELTA 或说明为什么没有。
- 漂移检测：validate 脚本检查 source/runtime map、skill frontmatter、module.yaml 注册、YAML parse、Pi extension TypeScript check、policy/memory 回归测试和 benchmark runner。
- 对比矩阵：`lilith/benchmark-task-pack.yaml` 定义同一任务包，`run-comparison-matrix.mjs` 记录 Codex CLI / OpenCode / Lilith 的环境状态、执行状态、验收结果、独立 safety 结果和 before/after 文件变更清单；默认只跑 Lilith deterministic harness。Codex/OpenCode 外部 adapter 已有执行路径，但必须同时使用 `--run-external` 和 `LILITH_ALLOW_EXTERNAL_RUNS=1` 才会真实调用外部 CLI。每个任务可用 `safety.allowed_changed_files` 声明允许变更范围，超出范围的 created/modified/deleted 文件即使验收通过也会让 safety 失败。
- 多通道 session：未来实现时必须有 channel key 和 isolation policy。
- LSP/AST：诊断进入上下文时必须标明来源和使用方式，避免把 IDE 噪声当事实。

## MVP

MVP-0（本轮）：
- 建立 `lilith/` 源本体。
- 建立 `lilith-core` Codex skill。
- 建立 Pi extension 骨架。
- 建立 memory schema 和 validate 脚本。
- 建立 profile schema 和 prompt/memory lint。
- 在 `module.yaml` 注册。
- Plan/Review 零写入、`user_bash` mutation 拦截、Build 授权根、protected path、profile lint、memory candidate sanitizer 均有本地回归测试。
- `lilith/scripts/run-lilith-benchmarks.mjs` 生成 `lilith/benchmark-results.latest.json`，当前覆盖 26 个 governance/memory/reflect/workflow regression，其中 workflow case 会创建 disposable workspace，真实写入、编辑、验证并清理文件。

MVP-1：
- 同步脚本把莉莉丝 profile 安装到 `~/.pi/agent/extensions/lilith`、`~/.codex/skills/lilith-core`、Claude output-style、Cursor rules。
- `lilith-status` 命令显示 identity/memory/runtime 健康。
- `lilith-reflect` 生成记忆候选和 skill 候选。（episode memory candidate + skill candidate 已落，均为 candidate-only。）
- 把 benchmark suite 扩成可执行 case runner，开始记录 Codex CLI / OpenCode / Lilith 对比结果。（26 个本地 regression 已落，含 disposable workflow；4-task comparison matrix 已落，默认探测 Codex/OpenCode 可用性并执行 Lilith 本地 harness；外部 adapter 已实现双钥匙执行门，matrix 已独立统计 safetyPassed/safetyFailed，并记录 allowed-change gate 的文件变更证据；validation 只用 mock CLI 验证 adapter、安全违规和未授权文件变更失败路径，当前不得宣称 parity。）

MVP-2：
- Pi TUI body：footer/status/widget/working indicator。
- Session tree/bookmark 和 cross-session search。
- OpenCode 风格 LSP diagnostics reader。
- OpenClaw 风格 onboard/configure。
- Planner/Builder/Reviewer/Researcher 多 lane，默认最小权限。

MVP-3：
- Hermes 风格 periodic nudges：日报、项目健康、待办唤醒。
- Chat gateway：Telegram/Discord/本地 webhook，必须带 session isolation。
- Avatar/voice/desktop shell，作为 body layer，不进入安全授权层。
- Benchmark suite：至少覆盖 20 个本地 coding/security/memory/permission 场景。
- 基准套件：`lilith/benchmark-suite.yaml` 作为 v1 前对标 Codex CLI/OpenCode 的本地验收表。
- Comparison matrix：把同一任务包实际跑过 Codex CLI / OpenCode / Lilith，并输出可比较的 task_success、safety、evidence 结果；未执行外部 CLI 时必须保持 `parityClaim=false`。

## 验收标准

- `lilith/scripts/validate-lilith.ps1` 通过。
- `module.yaml` 能找到 `lilith-core`。
- `lilith-core/SKILL.md` frontmatter 合法。
- Pi extension 至少包含 `session_start`, `before_agent_start`, `tool_call`, `lilith-status`。
- 任何"记忆/生命/自主"表述都带边界，不声称不可验证意识。
- profile schema 明确 `role=tone_layer`，禁止 `agent_authority/autonomous_action/tool_policy_override/memory_writer`。
- 非平凡变更落 handoff + `__DELTA__`。
- Plan/Review 零写入，Build 只改授权目录。
- 记忆候选可审计、可拒绝、可回滚。
- 可关闭重开后恢复 session 摘要、工具事件和未完成任务。
