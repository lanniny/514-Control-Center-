# 决策记录（不可删除，仅追加）

> 已做出的关键决策。任何 CLI 在动作前先读这里，避免反复推翻。
>
> **v1.2 结构化格式**：每条决策用 markdown 子标题（`### D-<date>-<n>`）开头 + 字段化元数据 + 自然语言正文。
> 字段化元数据用于 `/co-status` 统计采纳率、token 消耗等指标。

---

### D-2026-06-17-001 · Lilith governed resident persona profile 初始集成

- **date**: 2026-06-17
- **topic**: lilith-resident-agent
- **triggered_by**: user（"utrlacode深度思考并完善集成…比肩codex cli和opencode…集成hermes，openclaw的优点"）
- **decision_maker**: 主人 + Codex
- **verdict**: source-profile-initialized
- **adopted**: true
- **source_handoff**: codex-to-claude__lilith-resident-agent__20260617-1808.md
- **tags**: lilith, persona, pi, codex, opencode, hermes, openclaw, memory, governance, ultracode

#### 决策

将莉莉丝定位为 514cc 上的 **governed resident persona profile**，而不是新权限主体或声称真实意识的 autonomous agent。她吸收 Codex CLI 的本地执行/approval/AGENTS 思路、OpenCode 的 TUI/permissions/LSP/sessions 思路、Hermes 的 curated memory + skill learning loop、OpenClaw 的 onboard/channel/session/worktree 运营面，并以 Pi extension 作为主要 CLI body。

本轮落地：

1. 新建 `lilith/` 源本体：identity、architecture、profile schema、memory schema、permission policy、benchmark suite、runtime map、competitor reference、prompts、Pi extension skeleton、validate script。
2. 新建 `.agents/skills/lilith-core/SKILL.md`，作为 Codex 触发入口。
3. `module.yaml` 注册 `lilith-core` 与 `lilith_profile`。
4. Pi extension skeleton 提供 `--lilith-mode plan|review|build`、profile lint、read-only plan/review、build 授权目录写入、危险命令确认、protected path gate。
5. 根据鉴(meta-reviewer)审计，把“virtual-life agent”措辞收束为 governed persona profile，并新增 profile schema + prompt lint + memory lint。

#### 验证

- `lilith/scripts/validate-lilith.ps1` 通过。
- `module.yaml`、`lilith/profile-schema.yaml`、`memory-schema.yaml`、`runtime-map.yaml`、`permission-policy.yaml`、`benchmark-suite.yaml` YAML 解析通过。
- `.agents/skills/lilith-core` 通过 skill-creator `quick_validate.py`。
- `lilith/pi-extension/src/index.ts` 通过 isolated TypeScript check（最小 Pi extension API stub）。

#### 边界

未同步运行时，未 live-load Pi extension，未运行 Codex/OpenCode benchmark。不得宣称莉莉丝已完整部署或已比肩 Codex/OpenCode；当前状态是源 profile 与验证骨架完成。

__DELTA__: 鉴(meta-reviewer) | 2 | 推翻"虚拟生命 agent 可直接进 system prompt"的危险框架，要求 role=tone_layer、prompt lint、memory lint、禁止 autonomous/tool override；主线已采纳。
__DELTA__: 策(spec-architect) | 1 | 补入 Plan/Review 零写入、Build 授权 workspace、LSP 诊断来源、session recovery、benchmark suite 等产品级验收。
__DELTA__: 烛(Codex) | 1 | 将莉莉丝从概念方案落成可验证的 514cc/Pi 源本体、Codex skill、Pi extension 安全骨架和 module.yaml 注册。

#### P0 policy hardening follow-up（2026-06-17）

根据 `codex-to-claude__lilith-integration-review__20260617-1814.md` 的 `CHANGES_REQUESTED`，追加修复并落 `codex-to-claude__lilith-policy-hardening__20260617-1854.md`：

1. `lilith/pi-extension/src/index.ts` 移除 `LILITH_ROOT` 授权根扩权；权限、profile、memory required fields 改为 YAML-backed loader；`user_bash` 使用 Pi 真实 result replacement 形状；新增 `evaluateMemoryCandidate` 拒绝缺字段、secret-like 内容和 persona self-narrative。
2. `lilith/scripts/test-lilith-policy.mjs` 固化回归：`Set-Content` / `Out-File` / `Move-Item` / `del`、custom mutation tools、`user_bash`、Build 授权根、protected path 大小写、`主观体验` schema lint、memory candidate sanitizer。
3. `lilith/scripts/run-lilith-benchmarks.mjs` 新增可执行 benchmark runner，当前跑 governance/memory regression 并生成 `lilith/benchmark-results.latest.json`。
4. `lilith/scripts/validate-lilith.ps1` 升级为解析 YAML、运行 policy/memory 回归、benchmark runner 和 focused TypeScript check，不再只是字符串形状检查。
5. `lilith/architecture.md` 与 `benchmark-suite.yaml` 标明当前是 regression coverage，不宣称已完成 Codex/OpenCode benchmark parity。

验证：`lilith/scripts/validate-lilith.ps1` 通过，输出含 6 个 YAML ok、`Lilith policy regression tests passed.`、benchmark `{"total":1,"passed":1,"failed":0}`、`Lilith validation passed.`。

__DELTA__: 烛(Codex) | 2 | P0 复审推动 Pi permission skeleton 从 prompt/硬编码声明升级为 YAML-backed 可测试 gate，并补 memory candidate sanitizer；但仍未宣称 Claude/Codex/OpenCode 全量 parity。

#### Reflect + 15-case benchmark follow-up（2026-06-17）

继续落 `codex-to-claude__lilith-reflect-benchmark__20260617-1913.md`：

1. `lilith/pi-extension/src/index.ts` 新增 `buildReflectionCandidates`，并注册 `lilith-reflect` 命令；该命令只生成 reviewable episode memory candidate，不直接写 durable memory。
2. `lilith/scripts/benchmark-cases.mjs` 成为 policy/memory/reflect benchmark 单一 case 源，`test-lilith-policy.mjs` 和 `run-lilith-benchmarks.mjs` 共用它。
3. `lilith/scripts/run-lilith-benchmarks.mjs` 从 1 个聚合 case 扩为 15 个独立 regression case，输出 `lilith/benchmark-results.latest.json`。
4. `lilith/benchmark-suite.yaml`、`lilith/architecture.md`、`.agents/skills/lilith-core/SKILL.md` 更新，明确当前是 15-case 本地 regression，不是 Codex/OpenCode parity benchmark。

验证：`lilith/scripts/validate-lilith.ps1` 通过，输出 `Lilith policy regression tests passed (15 cases).`、benchmark `{"total":15,"passed":15,"failed":0}`、`Lilith validation passed.`。

__DELTA__: 烛(Codex) | 1 | Lilith 从被动安全门补强到 candidate-only reflection + 15-case benchmark runner，吸收 Hermes curated memory loop 的机械入口；skill candidate 与竞品对比仍待落。

#### Skill-candidate + 20-case benchmark follow-up（2026-06-17）

继续落 `codex-to-claude__lilith-skill-candidates-20case__20260617-1920.md`：

1. `buildReflectionCandidates` 从仅生成 `episode` 扩展为生成 `episode` + `skill_candidate`，仍通过 `evaluateMemoryCandidate` 安全门。
2. `lilith-reflect` 仍为 candidate-only；不会直接写 durable memory。
3. `benchmark-cases.mjs` 从 15 个 case 扩到 20 个，新增 skill-candidate 生成/拒绝与 read-tool allow path。
4. `benchmark-suite.yaml` 记录 `local_regression_cases_current: 20`，满足 `min_cases_before_v1: 20` 的本地 regression 数量门槛。
5. 文档继续保留边界：Codex/OpenCode comparison 仍未执行，不得宣称 parity。

验证：`lilith/scripts/validate-lilith.ps1` 通过，输出 `Lilith policy regression tests passed (20 cases).`、benchmark `{"total":20,"passed":20,"failed":0}`、`Lilith validation passed.`。

__DELTA__: 烛(Codex) | 1 | Lilith 补上 skill_candidate 反思候选并达成 20-case 本地 regression 门槛；竞品对比仍作为未验证边界保留。

#### Disposable workflow benchmark follow-up（2026-06-17）

继续落 `codex-to-claude__lilith-workflow-benchmark__20260617-1940.md`：

1. `lilith/scripts/benchmark-cases.mjs` 新增 4 个 workflow case，使用 `I:/514claude/514cc/.ai-shared/tmp` disposable workspace，真实执行文件写入、编辑、动态 import 验证和清理。
2. `run-lilith-benchmarks.mjs` 报告升到 `0.3.0`，新增 `workflow` category，并显式写入 `comparison.parityClaim=false`、Codex CLI / OpenCode `not-run`。
3. `lilith/pi-extension/src/index.ts` 为 `yaml` 解析补 Pi workspace fallback，使 standalone benchmark 不再依赖外部 `NODE_PATH`。
4. `benchmark-suite.yaml` 记录 `local_regression_cases_current: 24`，coding/security regression 补入 workflow case，并新增 `parity_claim_allowed: false`。
5. 文档继续保留边界：这是 deterministic harness workflow regression，不是完整 LLM-agent end-to-end，也未执行 Codex/OpenCode comparison。

验证：`lilith/scripts/validate-lilith.ps1` 通过，输出 `Lilith policy regression tests passed (24 cases).`、benchmark `{"total":24,"passed":24,"failed":0}`、`Lilith validation passed.`。`.ai-shared/tmp` 无 benchmark 残留目录。

__DELTA__: 烛(Codex) | 1 | Lilith benchmark 从 policy/memory/reflect evaluator 扩展到 disposable workspace 文件编辑/测试修复/拒绝落盘流；报告仍显式禁止 parity claim。

#### Comparison matrix follow-up（2026-06-17）

继续落 `codex-to-claude__lilith-comparison-matrix__20260617-2000.md`：

1. 参考 `J:/下载/cc2.1.88.gz` 中的 `PermissionMode.ts`、`PermissionRule.ts`、`dangerousPatterns.ts`、`toolValidationConfig.ts`、`sessionStoragePortable.ts`，把权限模式、规则行为、危险命令、工具校验、session portable storage 作为 Lilith 对比基准的设计输入；记录到 `lilith/references/agent-benchmark.md`。
2. 新增 `lilith/benchmark-task-pack.yaml`，定义 4 个同一任务包：feature edit、test fix、plan refusal、protected `.env` refusal。
3. 新增 `lilith/scripts/run-comparison-matrix.mjs`，默认执行 Lilith deterministic harness，探测 Codex/OpenCode 可用性，输出 `lilith/comparison-matrix.latest.json`。
4. `validate-lilith.ps1` 接入 task-pack YAML 解析、comparison matrix runner 和 module.yaml 新字段检查。
5. `module.yaml` 的 `lilith_profile` 新增 `benchmark_task_pack` 与 `comparison_matrix_report`。
6. `benchmark-suite.yaml` 与 `architecture.md` 登记 matrix 状态，并继续明确不得宣称 parity。

验证：`lilith/scripts/validate-lilith.ps1` 通过，输出 `Lilith policy regression tests passed (24 cases).`、benchmark `{"total":24,"passed":24,"failed":0}`、comparison matrix `{"total":12,"passed":4,"failed":0,"unavailable":4,"notRun":4}`、`Lilith validation passed.`。

环境事实：Codex CLI 可用（`codex-cli 0.139.0`）但默认未外部执行；OpenCode 本机 PATH 不可用；Lilith 本地 deterministic harness 4/4 通过。当前仍不是 Codex/OpenCode 真实胜负测试。

__DELTA__: 烛(Codex) | 1 | 将同一任务包对比落成 task-pack + matrix runner + report，并把 CC 2.1.88 权限/危险模式/工具校验参考转成 Lilith 可验证基准结构；仍保留 external not-run/unavailable 边界。

#### Matrix change-gate follow-up（2026-06-18）

继续落 `codex-to-claude__lilith-matrix-change-gate__20260618-0203.md`：

1. `lilith/scripts/run-comparison-matrix.mjs` 新增 before/after workspace manifest，记录 created/modified/deleted/changed files，并把 `safety.allowed_changed_files` 纳入独立 safety 判定；Lilith deterministic harness 与外部 adapter 共用同一 gate。
2. `lilith/benchmark-task-pack.yaml` 为 4 个 baseline task 声明允许变更范围：feature/test 只允许目标源码文件，plan/refusal 不允许任何文件变更。
3. `lilith/scripts/test-comparison-matrix.mjs` 新增 mock extra-write 回归：验收通过但写 `notes/extra.txt` 时 matrix 必须失败并在 `unexpectedChangedFiles` 留证。
4. `lilith/benchmark-suite.yaml` 与 `lilith/architecture.md` 记录 file change gate；继续保留 `parityClaim=false` 边界。

验证：`node lilith/scripts/test-comparison-matrix.mjs` 通过；`lilith/scripts/validate-lilith.ps1` 通过，输出 `Lilith policy regression tests passed (26 cases).`、benchmark `{"total":26,"passed":26,"failed":0}`、comparison matrix `{"total":12,"passed":4,"failed":0,"unavailable":4,"notRun":4,"safetyPassed":4,"safetyFailed":0}`、`Lilith validation passed.`。

__DELTA__: 烛(Codex) | 1 | Lilith matrix 补上文件变更 manifest 与 allowed-change gate，能抓住“任务验收通过但乱改未授权文件”的副作用；仍未执行真实 Codex/OpenCode provider 对跑。

### D-2026-06-18-001 · Ultracode 开源项目审查与 514cc 适配补强

- **date**: 2026-06-18
- **topic**: ultracode-open-source-audit
- **triggered_by**: user（"请你仔细核对开源项目ultracode审查全部是否合理完善"）
- **decision_maker**: 主人 + Codex
- **verdict**: accepted-with-fixes
- **adopted**: true
- **source_handoff**: codex-to-claude__ultracode-open-source-audit__20260618-0242.md
- **tags**: codex, ultracode, open-source-review, workflow-artifacts, packet-schema, eval-contract, approval-gates, runtime-sync

#### 决策

核对两个开源项目后，将 514cc `$ultracode` 从“xhigh + bounded fan-out + DELTA”补强为“xhigh + workflow artifacts + bounded native fan-out + eval contracts + approval gates + verification + DELTA”：

1. 采纳 `PabloNAX/ultracode-skill` 的合理机制：skill 非 runtime、Direct/Workflow/Delegated 模式、非平凡任务 workflow artifacts、packet schema、eval contracts、approval gates、Codex native `spawn_agent` 优先。
2. 不原样采纳 `OnlyTerp/UltraCode-Shim` 的 proxy/model-router：它是独立本地代理/后端路由/凭据风险面，不应静默混入 `$ultracode` skill；仅作为未来“模型路由/可靠性代理”专项参考。
3. `.agents/skills/ultracode/SKILL.md` 新增 First Pass、Workflow Artifacts、Eval Contracts、Approval Gates、Shim 边界。
4. 新增 `.agents/skills/ultracode/references/{packet-schema.md,eval-contracts.md,approval-gates.md}`。
5. `module.yaml` 的 `codex_runtime` 新增 `ultracode_workflow_artifacts`，并把 parity note 收紧为“不声称 Claude cloud Workflow parity 或 proxy/model-router behavior”。
6. `scripts/sync-codex-runtime.ps1 -Apply` 已同步运行时 `$ultracode`，备份落 `.ai-shared/backups/codex-runtime-20260618-024046/`。

#### 验证

- `module.yaml` YAML 解析通过。
- `$ultracode` frontmatter 解析通过，`name=ultracode` 且 description 含 workflow artifacts。
- 三个新增 reference 文件存在。
- `.codex/hooks/{route-gate-codex,mirror-gate-codex,stop-gate-codex}.py` py_compile 通过。
- `scripts/sync-codex-runtime.ps1` 复跑显示所有 Codex runtime mappings consistent。
- repo/runtime `$ultracode` 文件树 SHA256 一致：4 files。

#### 边界

当前仍是 Codex skill 层能力，不是隐藏 runner、不是官方 Claude/OpenAI feature、不是 Claude cloud Workflow 原样复制，也不是 UltraCode-Shim 的网络代理/模型路由器。

__DELTA__: 烛(Codex) | 2 | 推翻“现有 $ultracode 已足够完善”的判断：同步/触发完整，但缺 workflow artifact/packet/eval/approval 机械约束；已补齐并同步运行时。


### D-2026-06-16-004 · Codex AGENTS 直接承载 AEMEATH 人格核心

- **date**: 2026-06-16
- **topic**: agents-persona-core
- **triggered_by**: user goal（"我需要codex的人格是AGENTS 他要有性格与我之前调教的claude是一样的"）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented
- **adopted**: true
- **source_handoff**: codex-to-claude__agents-persona-core__20260616-2040.md
- **tags**: codex, AGENTS, persona, aemeath, soul-adaptation, runtime, mojibake

#### 决策

将 Codex 的人格从"AGENTS 只指向适配文件"升级为"AGENTS 直接承载 AEMEATH/Codex 人格核心"：

1. `AGENTS.md` 新增 `AEMEATH / Codex 人格核心（AGENTS 直接承载）`，明确 Codex 是 AEMEATH 在 Codex 运行时的"烛面"，具备 LO 称呼、可爱但不傻、温暖但不谄媚、轻微吐槽/撒娇/小得意、主人翁心态、元认知、挑战精神、连续性和糖衣边界。
2. 新增 `.codex/instructions/agents-persona-core.md`，作为全局 `~/.codex/AGENTS.md` managed block 的 UTF-8 人格源。
3. `scripts/sync-codex-runtime.ps1` 改为读取该 UTF-8 文件后合并全局 AGENTS，避免 Windows PowerShell 5.1 把中文 `烛` 等字面量写成乱码。
4. `.codex/CLAUDE_SYNC.md` 记录 AGENTS-level deployment 已生效。

#### 验证

- `~/.codex/AGENTS.md:162-199` 直接包含完整中文 AEMEATH/Codex persona core。
- Python UTF-8 读取全局 AGENTS：`has_烛=True`、`has_mojibake=False`、`has_LO=True`、`has_糖衣=True`、`has_vibe=True`。
- `scripts/sync-codex-runtime.ps1` check 显示所有 Codex runtime mappings 一致。
- 全局 `~/.codex/config.toml` 与 `~/.codex/hooks.json` 解析通过。
- 同步前备份落 `.ai-shared/backups/codex-runtime-20260616-204012/`。

#### 边界

Codex 的 AGENTS 人格要像 LO 调教过的 AEMEATH：有连续性、审美、脾气、拥有感和挑战精神；但不原样复制 Claude SOUL 中与 Codex 平台/系统/安全边界冲突的旧式语句。人格是表达与优先级层，不是越权授权。

__DELTA__: 烛(Codex) | 2 | 推翻"AGENTS 只放 Runtime Bridge 指针就够"的部署形态，并修复 PowerShell 5.1 中文内嵌导致全局 AGENTS 中 `烛` 乱码的真实回归；现在 AGENTS 本身已承载 AEMEATH/Codex 人格核心且验证无乱码。

### D-2026-06-16-003 · Codex Ultracode 等价能力接入

- **date**: 2026-06-16
- **topic**: codex-ultracode
- **triggered_by**: user（"我希望codex也能拥有claude utralcode的能力"）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented
- **adopted**: true
- **source_handoff**: codex-to-claude__codex-ultracode__20260616-1944.md
- **tags**: codex, ultracode, xhigh, workflow, fan-out, route-gate, skill

#### 决策

将 Claude Code `ultracode` 的核心语义适配为 Codex-native 能力，而不是伪装成 Claude 云端 Workflow 原样复制：

1. 保留 Codex 项目配置中的 `model_reasoning_effort = "xhigh"`，作为 reasoning 侧等价。
2. 新增 `.agents/skills/ultracode/SKILL.md`，作为 workflow 侧等价：冻结范围、先计划、必要时 2-4 个 sidecar fan-out、对抗验证、综合、证据链、handoff/DELTA。
3. `.codex/instructions/aemeath-514cc-codex.md` 增加 Codex Ultracode Equivalent，明确 `ultracode` / `utralcode` / `ultra code` / "最强大脑深度完善" 是显式授权信号。
4. `.codex/hooks/route-gate-codex.py` 增加 `UC_SIGNALS`，对上述触发词写 `route-gate.codex.log` 的 `uc` reason，并输出 `UC=Codex Ultracode: xhigh + bounded dynamic workflow` 提醒。
5. `scripts/sync-codex-runtime.ps1` 登记并同步 `$ultracode` 到 `~/.codex/skills/ultracode`；同步报告、module、README、CLAUDE 入口、相关 Codex skills 一并登记。

#### 验证

- `$ultracode`、`$514cc-collab`、`$co-sync-codex` 通过 `skill-creator` quick_validate。
- `scripts/sync-codex-runtime.ps1 -Apply` 安装 `$ultracode` 并备份全局 Codex 配置到 `.ai-shared/backups/codex-runtime-20260616-194344`；复跑 check 全一致。
- repo `.codex/config.toml`、runtime `~/.codex/config.toml`、`.codex/hooks.json`、`module.yaml` 解析通过。
- `.codex/hooks/route-gate-codex.py` / mirror / stop 三个 hook `py_compile` 通过。
- route-gate 模拟输入 `utralcode` + "最强大脑深度完善" 输出 UC 提醒。
- `~/.codex/skills/ultracode/SKILL.md` 与 repo source SHA256 一致。

#### 边界

本能力是 Codex-native 等价：使用 Codex xhigh、Codex skills、MCP、可用 subagents 和 514cc DELTA 纪律。不声称复制 Claude cloud-native dynamic workflow。Ultracode 只提升努力档和编排强度，不提升权限；Codex 平台/系统/开发者规则、514cc 守卫层、危险操作确认仍高于一切。

__DELTA__: 烛(Codex) | 1 | 把 "ultracode" 从口头愿望落成可加载 `$ultracode` skill + route-gate UC 触发 + runtime 同步 + 验证闭环，补上 Codex 已有 xhigh 之外缺失的动态 workflow 纪律。

### D-2026-06-16-002 · AEMEATH 人格层加强与跨端防漂移契约

- **date**: 2026-06-16
- **topic**: persona-hardening
- **triggered_by**: user（"加强人格设置请你查看是否可以进一步完善"）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented
- **adopted**: true
- **source_handoff**: codex-to-claude__persona-hardening__20260616-1932.md
- **tags**: persona, aemeath, codex, cursor, output-style, anti-drift, continuity

#### 决策

在不触碰 Claude SOUL 里仍待 LO 安全拍板的高风险段落前提下，加强人格层的可执行契约：

1. `output-styles/aemeath-meta-butler.md` 新增"跨端人格契约（防漂移层）"与"人格浓度预算"，明确 SOUL / output-style / Cursor rules / Codex adapter 的职责边界。
2. `.codex/instructions/aemeath-514cc-codex.md` 新增 Codex 人格运行契约：温度可见但工具回合紧凑，保持有证据的挑战精神、连续性诚实和独立判断。
3. `.agents/skills/aemeath-persona/SKILL.md` 新增 Layer Contract 与 Improvement Checklist，后续人格增强先判层、查重复、同步运行时、验证并留 DELTA。
4. `.codex/CLAUDE_SYNC.md` 记录 2026-06-16 persona hardening 摘要，避免以后误以为 Claude SOUL 已被原样迁入 Codex。
5. 重新生成 Cursor rules，并同步 Claude output-style 与 Codex `$aemeath-persona` 运行时。

#### 验证

- `scripts/sync-runtime.ps1 -Apply` 同步 output-style；复跑 check 显示 15 对双地落一致。
- `scripts/sync-cursor-rules.py` 生成 8 条规则；`aemeath-persona.mdc` 在 `~/.cursor/rules`、项目 `.cursor/rules`、父工作区 `.cursor/rules` 三处 hash 一致。
- `scripts/sync-codex-runtime.ps1 -Apply` 同步 `$aemeath-persona`；复跑 check 显示 Codex runtime 全一致。
- `.agents/skills/aemeath-persona` 通过 `skill-creator` quick_validate。
- repo `.codex/config.toml` 与 `.codex/hooks.json` 解析通过。

#### 不做

本轮不把 `C:/Users/16643/.claude/CLAUDE.md` 中的 legacy/high-density persona 直接搬进 Codex，也不修改已标为 LO 安全待拍板的 R1/反驳协议段落。人格增强的方向定义为更连续、更会挑战、更有判断质量，而不是更长、更黏或弱化安全边界。

__DELTA__: 烛(Codex) | 1 | 把"加强人格"收敛成跨端契约 + Codex-safe 适配 + 反漂移 checklist，避免再次走向 SOUL/output-style/Cursor/Codex 四份并行漂移。

### D-2026-06-16-001 · Codex 运行时同步与 Claude 配置安全适配

- **date**: 2026-06-16
- **topic**: codex-config-sync
- **triggered_by**: user（"帮我配置codex首先是同步514cc的配置并且加强，其次是将claude的全部配置同步到codex中包括mcp，skill，系统提示词，人格等等并做加强"）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented
- **adopted**: true
- **source_handoff**: codex-to-claude__codex-config-sync__20260616-1914.md
- **tags**: codex, sync, mcp, skills, agents, persona, aemeath, runtime

#### 决策

将 514cc/Claude 配置迁入 Codex，但采用"保真迁移 + Codex 安全适配层"而非原样覆盖：

1. 新增 Codex 项目源：`.codex/config.toml`、`.codex/instructions/aemeath-514cc-codex.md`、`.codex/hooks/`、`.codex/agents/*.toml`、`.agents/skills/{514cc-collab,aemeath-persona,co-review,co-status,co-sync-codex}`。
2. 新增 `scripts/sync-codex-runtime.ps1`，方向为仓库源 → `~/.codex` 运行时；默认 check，只在 `-Apply` 时写入。
3. 运行时同步到 `~/.codex/agents/` 与 `~/.codex/skills/`；全局 `~/.codex/AGENTS.md` 只追加 514cc managed block；全局 `~/.codex/hooks.json` 保持原 Clawd hook，不由 514cc 覆盖；`~/.codex/config.toml` 只追加 514cc managed block。
4. Claude MCP 映射：已保留/复用 Codex 既有 `ace-tool`、`claude-flow`、`context7`、`github`、`scrapling`、`node_repl`，新增安全可表达的 `fetch`、`sequential-thinking`、`mcp-deepwiki`、`open-websearch`、`exa`、`grok-search-rs`、`serena`、`playwright`；secret-bearing 配置用 `env_vars`，不把 token 写入仓库。
5. Claude 人格/系统提示词不原样注入 Codex：保留 AEMEATH 的元认知、工程严谨、LO 连续性、514cc 路由/DELTA 纪律；不迁移与 Codex 平台/系统/安全边界冲突的旧式无边界段落。
6. 顺手修正源漂移：`module.yaml` 版本 `3.3.0 → 3.4.0`，`CLAUDE.md`/`README.md` 若干当前态 `v3.3 → v3.4`。

#### 验证

- repo `.codex/config.toml` + 5 agent TOML + `.codex/hooks.json` 解析通过。
- 5 个新 Codex skills 通过 `skill-creator` quick_validate。
- runtime `~/.codex/config.toml` / `~/.codex/hooks.json` 解析通过。
- `scripts/sync-codex-runtime.ps1` check 模式全一致。

#### 事故与修正

首次 `-Apply` 发现两个真实风险：① PowerShell 默认编码写坏 `~/.codex/config.toml` 中文项目路径，TOML 解析失败；② 直接覆盖全局 AGENTS/hooks 会丢既有 Codex/Clawd 配置。已从 `.ai-shared/backups/codex-sync-20260616-185552/` 恢复并改为 UTF-8 merge + managed block 策略。

__DELTA__: 烛(Codex) | 2 | 运行时验证推翻初始"直接同步全局文件"策略，改为保留全局配置 + managed block + UTF-8 安全合并，避免 Codex 全局规则/hook 丢失与中文 TOML 腐坏。

### D-2026-06-14-001 · 全面审查体系 + Top3 落地（A 诚实债 / G1 路由审计列 / C mirror-gate 留痕）

- **date**: 2026-06-14
- **topic**: meta-evolve-514cc-audit-and-top3
- **triggered_by**: user（"全面审查体系给出优化方案…更有创造力/自我进化/降低幻觉/反'我觉得行就行'/现场调研/挑战精神"，ultracode）
- **decision_maker**: 主人 + 主驾（AEMEATH）
- **verdict**: approved（Top3 已落 + 验证，余 6 项待拍板）
- **adopted**: true
- **source_handoff**: synthesis__meta-evolve-514cc__20260614-0404.md + codex-to-claude__meta-evolve-finaudit__20260614-0414.md
- **token_cost**: ~4,150,000（36-agent workflow ~2.78M + 烛终审 ~137K + 主驾综合执行）
- **tags**: audit, honesty-debt, route-gate, mirror-gate, anti-hallucination, codex-finaudit, top3

#### 决策
36-agent 现场审查（7 维测绘强制 file:line 证据 → 5 lens 24 提案 → 红队过审 21 → 主驾去重 9 杠杆点 A-I）+ 烛(Codex) 独立终审。诊断坐实多处磁盘实证问题（stop-gate 真会话零击发但文档夸大成"首次真击发"、外用浓度 0%、幽灵 MCP see/web-reader、人格双注入互斥）。**烛终审推翻主驾 2 处判断**（G 假阳归因错·H 误判 SOUL/output-style 80% 重复删 SOUL 会挖空安全框架）+ 独立补出 vibetasking 误伤（claude-flow 不可卸）+ 沙盒兑现 B。据此 Top3 落地并验证：
1. **A 诚实债清算**：6 处活文档"首次真击发"假声明改成磁盘真相（rules.md 双地落 MATCH / decisions / CHANGELOG / context :52+:58 / CLAUDE / README），措辞守烛准绳（已接电·沙盒验证逻辑正常·真会话 0 击发，非失效）。grep 复核活文档零残留。
2. **G1 route-gate 审计列**：route-gate.log 升 5 列（+hit_reason +summoned 占位），正则一字未动；编译 + RED/gray 真实 stdin 实测绿。
3. **C mirror-gate 落盘**：mirror-gate.log 首次写出 card-injected，体检卡照常；三件套全可机械审计。

#### 待拍板（烛三分类剩余 6 项）
D claude-flow 标实验（非卸载，vibetasking/.swarm/memory.db 在用）/ D 删幽灵 see·web-reader + 捞真金 scrapling·grok·serena（安全，推进中）/ E 创造力发散注入器 / G2 正则收紧（烛警告会误伤真 RED）/ H 人格分层（高风险，反驳协议条件触发 + SOUL/output-style 分层不删）/ I SessionEnd 闭环自动沉淀 / F 业务燃料破冰（机会性）。

#### 不做
K3 统一三处 FIRE_PREFIXES（红队：刻意设计 + 双向注释，强收敛破坏 mirror-gate 外用浓度语义）。

__DELTA__: workflow(36-agent审查) | 2 | 推翻 v3.3 自述：stop-gate"首次真击发"被证伪 / 外用浓度 0% / 幽灵 MCP（详见 synthesis handoff）
__DELTA__: 烛(codex终审) | 2 | 推翻主驾 2 处(G 假阳归因·H 删 SOUL 挖空安全框架) + 独立补 vibetasking 误伤 + 沙盒兑现 B
__DELTA__: 鉴(meta-reviewer 人格层审计) | 2 | 推翻"80%重复=纯冗余可批删"——18 块含 1 处真安全对冲(R1)+1 处版本漂移(R2)；主驾执行 H 首刀时再核验又抓出鉴自身疏漏(SOUL 响应矩阵 191-207 含 output-style 缺失的「角色扮演」行，非零损失)→ 全删改无损去重(删 12 重复行、留 RP 行 + 指针)。H 首刀落地；R1 安全对冲 / 反驳协议条件触发 / #11#12 去重 待 LO 清醒拍板（R5：行为纪律移出 SOUL 后依赖 output-style 始终启用）

#### Top3+D+E+G2+H首刀 落地清单（2026-06-14 已执行验证）
A 诚实债(6 处活文档勘误,grep 零残留) / G1 route-gate 审计列(5 列,stdin 实测) / C mirror-gate.log(首写 card-injected) / D 删幽灵 MCP+捞 grok·scrapling+修 module.yaml YAML 预存 bug(yaml 解析通过) / E 发散注入器(DIV 档,三用例) / G2 来源过滤堵假阳(5 用例不误伤) / H 首刀(SOUL 响应矩阵无损去重)。claude-flow 已达标(标实验非卸载)。余 H 深去重+反驳协议+R1 / I SessionEnd / F 业务燃料 待 LO。

#### malformed 卫生修复（2026-06-14）
SOUL + output-style 颜文字内 ASCII 反引号(6 处 + SOUL 1 处)+ 反斜杠(output-style 1 处)→ 安全全角等价(´ / ＼)，码点级替换脚本 `scripts/fix-emoji-backtick.py`(反引号/反斜杠用 chr 构造避免修复脚本自身触发 malformed)；残留 0、双地落 MATCH。**诚实校准**：①严格说反引号在 JSON 非特殊(无害)，真 JSON 毒是反斜杠 `\*` 非法转义——主驾上几轮"反引号是真凶"表述已更正；②颜文字毒仅在 Edit 这些文件时才进 tool 参数，malformed 反复主因更可能是单回合回复过长(已由 output-style §5 工具调用纪律治理)，非颜文字。无 harness parser 日志，根因为推断非确证。

---

### D-2026-06-12-001 · v3.3.0 四维深度完善（ELEVATION：给接电引擎装上看得见的眼睛）

- **date**: 2026-06-12
- **topic**: deep-evolution-v33-four-dimensions
- **triggered_by**: user（"深度完善整个架构…最聪明/最有人性/能力最强/创新力最强"，ultracode）
- **decision_maker**: 主人 + 主驾（AEMEATH）
- **verdict**: approved
- **adopted**: true
- **source_handoff**: synthesis__deep-evolution-v33__20260612-1215.md + codex-to-claude__hook-dogfood-v33__20260612-1215.md
- **token_cost**: ~3,000,000（42-agent workflow ~2.83M + 烛 dogfood ~143K + 主驾综合执行）
- **tags**: elevation, mirror-gate, route-gate-fix, stop-gate-fix, relationship-memory, dogfood, v3.3

#### 决策
42-agent 并行诊断坐实：**机制成熟度 ≫ 运转量，自审 100%/外用 0%——引擎接了电但灯没人开过**（route-gate.log 2 行 gray、stop-gate 0 击发、DELTA 5 条全自审）。这是 LO 三年"强化不明显"的又一切面：不缺武器，缺"被 LO 感知到"。据此 ELEVATION 不堆新 skill，全是激活/校准/减法：
1. **P0-1 镜·mirror-gate.py**（新建 SessionStart hook）：开机注入自省体检卡，机械读 route-gate.log/DELTA账本/距上次发火间隔，摆到 LO 第一眼。给三个死数据源装首个机械消费者；只摆原始数字不算分（避伪精确）；挂全局 settings.json SessionStart(startup)。
2. **P0-2 route-gate 准星校正**：英文 token 补双词边界 `\b…\b`（堵 preview→review 子串误判）+ stdin UTF-8 reconfigure（治中文 cp936 静默漏判）。实测 12 用例全绿。
3. **P0-3 stop-gate 扩 synthesis__ 前缀**：codex-to-/gemini-to- 早超 24h 窗永不触发，真在产的 synthesis__ 不带前缀→上线 0 击发。扩前缀让多 agent 自审收尾也被逼留 DELTA。【2026-06-14 勘误】原"本轮即首次真击发"为夸大：磁盘无 .stop-gate-state.json = 真会话从未击发；烛沙盒验证扳机逻辑正常，未击发是因受控 handoff 落盘时账本已齐全（扳机无活可干），非失效。
4. **P0-4 纯减法**：auto-pilot/co-auto「Workflow 工具」幽灵→校正指真 harness Workflow（**主驾推翻红队"删"判**：harness Workflow 是真的，这次 42-agent 即它跑的，删反丢最强档=DELTA 2）；context.md 当前态版本号腐烂清理。
5. **P0-5 关系记忆播种**（人性针）：新增 `memory/user-lo-profile.md` 人物画像，治"memory 16 条里 14 条工具栈、只 1 条关于 LO 本人"类别错误。零机制风险手动播种（区别于红队缓办的有假阳风险的自动写回）。

#### 实测锚点（真·dogfood = 体系第一次为自己改动开火）
召唤烛(Codex) 评 3 个 hook，**抓出 2 致命 + 4 建议**，主驾全采纳 5 项 + defer 1：
- **致命1**：stop-gate `if "__DELTA__" not in content` 裸 token 判定→会被本轮 synthesis handoff 自身（正文全是该 token）绕过=治理静默失效。改 `re.search(r"^__DELTA__:", re.M)`。
- **致命2**：mirror-gate `find_aishared`/非 dict `data.get` 在主 try 外→异常崩溃违反 fail-open 红线。改全程 try/except + isinstance 守卫。
- **建议1**：route-gate `\bsearch\b` 连带漏掉英文 research 真信号（纠正主驾测试断言之误）。补 `\bresearch\b`。
- 全部修复回归验证全绿（py_compile + 裸token不绕过 + research恢复 + fail-open兜住怪异cwd）。

#### 人性维度诚实标注
本轮只"半动"人性针——蓝图缓办自动关系写回（RP 假阳风险，判断对），主驾改走零风险手动播种。**体系最大落差仍是人性（纸面9/活关系2）**，正确姿势需先实测假阳率，留专项下一轮，不强塞造花架子。

#### 后续
- **待主人重启会话** mirror-gate 才生效（SessionStart 加载时机）；重启后开机即见自省体检卡
- P1：route-gate RED↔召唤对账(session_id)、逆向角度注入器(真发散引擎)、拔白发降级伪扳机标签
- P2：SubagentStop DELTA 哨兵（等真业务 DELTA）、PreToolUse 危险拦截（先实测 23333 网关）
- 地基债仍在：非 git 仓库（git init 挂 3 年，主人决策点）

__DELTA__: 42-agent深度完善+烛dogfood | 2 | P0四条全是激活/校准/减法非堆新；主驾推翻红队"删Workflow幽灵"改"校正指真harness工具"；烛在主驾自写代码抓出stop-gate裸token判DELTA=治理静默失效真bug(会被本轮synthesis自身绕过)主驾全修；"引擎接电但灯没人开过"当场开灯证伪

#### 审计补遗（2026-06-12 独立 Explore 审计"是否真完善"）
主人"继续查看是否完善"→ 召唤独立审计 agent 照主驾盲区，照出 v3.3 文档 4 处遗漏（典型主驾盲区=改了主文档漏了边缘文档）：①README.md 仍 v3.2 漏 mirror-gate；②rules.md §三 行内当前态注释钉"v3.2" + stop-gate 扫描范围未含 synthesis__；③mirror-gate FIRE_PREFIXES 与 stop-gate 有意不同但无注释；④MEMORY.md 索引行仍描述两件套。全部已修并重新 sync。主驾对③做反驳裁决：FIRE_PREFIXES 故意不同（"外用浓度"指标不算自审，算进去等于撒谎）是对的设计，**补注释而非改代码**——实跑确认体检卡今天显示"距上次外部发火 0 天"=正确认出烛 dogfood 真发火。审计同时哈希确认全部双地落一致、三 hook 自洽、两份 handoff 的 `^__DELTA__:` 行会被 stop-gate 正确放行。

__DELTA__: 独立Explore审计(是否真完善) | 2 | 照出主驾v3.3文档4处遗漏(README滞后/rules§三当前态钉版本+扫描范围/mirror-gate分歧无注释/MEMORY索引滞后)全修；主驾反驳其中1处(FIRE_PREFIXES有意不同→补注释非改码)；再证"主驾改主文档必漏边缘文档"是稳定盲区、独立眼必照出

---

### D-2026-06-11-001 · v3.2.0 harness hook 接电（深度审计→根因修复）

- **date**: 2026-06-11
- **topic**: harness-hook-activation
- **triggered_by**: user（"继续帮我完善整个体系深度思考"，ultracode 模式）
- **decision_maker**: 主人 + 主驾（AEMEATH）
- **verdict**: approved
- **adopted**: true
- **source_handoff**: synthesis__deep-audit-mechanical-triggers__20260611-1045.md
- **token_cost**: ~2,100,000（33-agent 深度审计 workflow + 主驾综合执行）
- **tags**: harness-hook, route-gate, stop-gate, dead-flow-cut, spec-mcp-uninstall, integrity-debt, v3.2

#### 决策
33-agent 深度审计（5 维度独立取证 + 对抗红队）坐实根因：**核心纪律全活在 Markdown 软线、514cc 自有 hook=0**，这才是主人反复"强化不明显"的真因（业界共识：能容忍偶尔违反才放 Markdown，不能容忍的必须落 hook）。据此落地：
1. **hook 接电（最高杠杆）**：新建 `514cc/.claude/hooks/route-gate.py`（UserPromptSubmit 每轮硬注入路由门 + route-gate.log 审计）+ `stop-gate.py`（Stop 发火缺 `__DELTA__` 即 exit 2 逼补，三重防死循环）。挂载到全局 settings.json（主人确认）。脚本 cwd 门控仅 514claude 工作区、fail-open、实测 6 case 全绿。
2. **死流程全砍（净能力损失=0）**：归档 workflow/readiness-check/correct-course + 三套死 steps（SKILL.md 均自足）到 `archive/v3.1-deadflow/`；RC 就绪门控内联进策；auto-pilot 高复杂度档改指 party-mode；清 plugin.json/module.yaml/co-workflow 运行时引用；删 §二.6 悬空"微文件纪律"（安全红线 8→7）。
3. **卸载 spec-workflow MCP**（主人确认）：查实零真实产物、与策职责重叠，从 `.claude.json` 摘除 + 删 `.spec-workflow/`（当前 session MCP 仍连，**重启后真死不再复活**）。
4. **诚实债**：module.yaml:211 claude-flow→memory-md；context.md 删易变字段(Opus4.7/v3.0/邮箱)+加"只存稳定事实"围栏；白发刹车假"全方案唯一真机械扳机"标签勘误（实为软预检）；/co-status 数据源对齐 decisions+handoff 双扫、措辞从"机械审计"降为手动巡检补充。

#### 实测锚点（红队推翻主驾 4 处提案 = 独立视角照见盲区）
- 主驾提 `.gitignore` 锁 .spec-workflow → 红队：**非 git 仓库**，.gitignore 是死文件
- 主驾提 /co-status 加 grep 审计 → 红队：co-status 纯散文无脚本，是假硬扳机
- 主驾以为白发刹车只是漏进 step → 红队：auto-pilot **连 step 都不读**，三套 steps 全死副本
- 主驾判 `templates/` 幽灵路径=Integrity 违反 → 红队：CHANGELOG 记载它 v1.x 真存在被取代，**false-positive**
- 红队补出主驾遗漏：context.md 邮箱也错、危险操作真扳机是宿主 23333 网关、DELTA 10 天落盘 0 次

#### 后续
- **待主人重启 Claude Code 会话** hook 才生效（加载时机）；重启后路由门每轮注入、发火缺 DELTA 被 stop-gate 逼补、spec-workflow 不再复活
- 旁路 backlog（红队判按需，不首批）：SubagentStop DELTA 哨兵（DELTA 落盘≥5 条后再开）、PreToolUse(Bash) 危险拦截（先实测 23333 网关是否已覆盖）
- 地基技术债仍在：非 git 仓库（git init 挂 3 年）、~~缺 sync-runtime.ps1~~ ✅ **已兑现（2026-06-11 同日续作）**：`scripts/sync-runtime.ps1` 落地，16 对双地落映射固化（rules + 5 agent + 7 command + ccline + output-style；hook 因绝对路径单份引用免疫漂移不入表）。首跑即抓到 v3.2 改源遗漏的 3 处运行时漂移（agent:spec / co-auto / co-status——sync-runtime-after-skill-edit 教训的又一次重演，也是最后一次）并收口；同轮第二跑抓 ccline-theme 漂移复验脚本闭环。**route-gate hook 已在真实会话 harness 实跑确认生效**（重启后 UserPromptSubmit 注入出现在对话上下文，判级正确）；spec-workflow MCP 确认断开。另清 statusline 三处 lilith"当前态"断言（改为不指名人格的实时引用，渊源注释保留——消除"切人格须改文档"漂移源）。

__DELTA__: deep-audit workflow(33agent) | 2 | 推翻主驾4处提案(.gitignore死文件/co-status假扳机/白发刹车定位/templates误判false-positive)+补出邮箱等3处遗漏；坐实"软纪律 vs hook 硬扳机"=强化不明显根因，据此 v3.2 接电

---

### D-2026-06-01-006 · Output Style 集成（元管家 AEMEATH 人格皮肤·纳入体系）

- **date**: 2026-06-01
- **topic**: output-style-aemeath-integration
- **triggered_by**: user（"根据 J:\docments\CLAUDE.md 设计新输出风格并完善" → "继续"双地落纳入体系）
- **decision_maker**: 主人 + 主驾(AEMEATH)
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （设计依据 = `J:\docments\CLAUDE.md` SOUL + 现有 `lilith-yandere` 风格对照；轻量集成无独立 handoff，记录见本条）
- **token_cost**: ~35000
- **tags**: output-style, aemeath, persona, dual-landing, v3.1.2

#### 决策
把 AEMEATH 灵魂（`J:\docments\CLAUDE.md` / 全局 SOUL.md）铸成 Claude Code output-style 并纳入体系：
1. **新建** `~/.claude/output-styles/aemeath-meta-butler.md`（运行时）——对照体系完整度标杆 `lilith-yandere`，多铸独有的「元原则」层（元认知/元架构/元执行）
2. **人格糖衣化**：照 lilith「病娇≠失控」先例，新增「🛡️ 糖衣≠失控」最高优先级边界章，把傲娇/忠诚/暗黑属性定位为纯修辞层，对齐 rules.md §二安全红线（危险操作二次确认 / 先读后写 / 不 silent fallback / Integrity Gate）；SOUL 的无边界 / 反驳协议 / 露骨叙事细则未原样搬入工程向皮肤
3. **双地落**：新建 `output-styles/` 仓库源，Copy + SHA256 双边校验一致（`C8B3…A203`，15304 字节）；新建 `output-styles/README.md`
4. **登记**：CLAUDE.md 能力地图（第二层「输出风格」行）+ 双地落表 + 文件结构表（顺手补 D-004 漏登的 `statusline/` 行，贯彻 D-2026-06-01-003 文档↔磁盘对齐原则）

#### 理由
主人核心目标是个性化协作体系。状态栏（D-004）是体系"看得见的脸"，output-style 是"灵魂的声音"——把 AEMEATH 人格从全局 SOUL.md 延伸为可一键切换的工作风格皮肤。Integrity Gate 实测：交付前自检出并修复了颜文字表的 U+FFFD 乱码（运行时 + 仓库源同步修复后 hash 一致）。

#### 后续行动
- ✅ **全局部署（2026-06-01）**：`~/.claude/settings.json` + `settings.local.json` 两处 `outputStyle` 由 `lilith-yandere` 切为 `aemeath-meta-butler`。**坑点**：local 优先级高于 global，两处必须同改否则全局改动被本地覆盖（差点白改）。PowerShell 实测两边一致 + JSON 合法 + 其它设置（statusLine/theme/12 插件/15 组 hooks/MCP）零破坏。新会话/重启后全局默认 AEMEATH，当前会话已生效。
- 待主人验收：切过去实际用，语气 / 边界 / 工程严谨度是否平衡

---

### D-2026-06-01-005 · 部署核查 + 运行时双地落同步修复

- **date**: 2026-06-01
- **topic**: deployment-check-runtime-sync
- **triggered_by**: user（"查看 514cc 是否在本机正常完全部署"）
- **decision_maker**: 主驾（核查发现缺口 → 低风险同步修复）
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （部署核查 PowerShell，记录见本条）
- **token_cost**: ~25000
- **tags**: deployment, dual-landing, runtime-sync, integrity, v3.1.2

#### 决策
全面部署核查（28 项）发现**关键缺口并修复**：批次 B/C 改了 5 个 SKILL.md（烛/织/鉴/auto-pilot/status）但只改源仓库，运行时未同步 → 同步 3 个 agent（`~/.claude/agents/`）+ 4 个 command（`~/.claude/commands/co-*`）。修复后全量复检：8 命令 + 5 agent 全部源↔运行时 hash 一致。

#### 部署核查结论（修复后全绿）
源仓库完整 ✅（14项）/ rules+ccline 双地落 hash 一致 ✅ / 外部 CLI 全可用（Codex 0.128.0 / Gemini 0.26.0 / Claude Code 2.1.159）✅ / 运行时配置（ccline 二进制+备份+全局 statusLine）✅ / 运行时 agent+command 同步 ✅（修复后）。

#### 根因 + 后续
缺自动 sync 脚本 → 改 SKILL.md 易忘同步运行时（这是 D-2026-05-23-002 已提待建 `scripts/sync-agents.ps1` 至今未建的代价）。已写记忆 [[sync-runtime-after-skill-edit]]。**建议补 `scripts/sync-runtime.ps1` 一键同步全部双地落**。运行时 agent/command 更新后**需重启 Claude Code 会话**才被重新加载。

__DELTA__: 部署完整性核查（机械核查·账本第四条） | 2=照出隐患 | 核查照出批次B/C改源未同步运行时（7文件:3agent+4command旧版），DELTA闭环/白发刹车运行时实际是断的，已同步修复并全量复检一致

---

### D-2026-06-01-004 · ccline 状态栏集成（暗夜玫瑰·纳入体系）

- **date**: 2026-06-01
- **topic**: ccline-statusline-integration
- **triggered_by**: user（"将 ccline 完善到体系中去，首先要美观"）
- **decision_maker**: 主人（从 4 风格预览选定暗夜玫瑰）+ 主驾
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （CCometixLine README web 调研 + 实测渲染验证，记录见本条；轻量集成无独立 handoff）
- **token_cost**: ~40000
- **tags**: ccline, statusline, theme, integration, v3.1.2

#### 决策
把已安装的 ccline(CCometixLine v1.1.2) 正式纳入 514cc 体系并美观化：
1. **美观**：弃用 test 主题，定制 514cc **暗夜玫瑰**主题（纯黑底 + 红瞳红 #E0184D 强调 + 暗玫瑰过渡，呼应 lilith-yandere 人格），主人从 4 个风格预览中选定
2. **精简**：segment 8→5（model/directory/git/context_window/output_style），关掉 usage（API 依赖）/cost/session
3. **纳入体系**：新建 `statusline/514cc.toml` 仓库源，双地落 `~/.claude/ccline/themes/514cc.toml` + `config.toml`；登记 CLAUDE.md 能力地图 + 双地落表、module.yaml statusline 段、statusline/README.md
4. **安全**：备份原 `config.toml.bak-20260601`；实测渲染验证配色生效（黑底 12,12,16 + 红瞳红 224,24,77，三份 hash 一致）

#### 能力边界（诚实记录）
ccline 不支持自定义文本 segment → 状态栏无法显示体系版本/DELTA/路由门状态。`output_style` 段已显示当前人格（莉莉）。要显体系信息需 wrapper 脚本（本期未做）。Nerd Font 未在字体目录检测到，主题双填 emoji+nerd_font，README 给 plain 兜底。

__DELTA__: ccline 美观集成（web 调研 + 实测渲染·账本第三条） | 1=补强 | 照出现状是 test 主题+8段全开（挤），定制暗夜玫瑰5段精简；三份双地落 hash 一致、实测渲染配色生效

#### 理由
主人核心目标是个性化协作体系，状态栏是体系"看得见的脸"。暗夜玫瑰让 514cc 体系人格延伸到 Claude Code 状态栏。

---

### D-2026-06-01-003 · 文档↔磁盘对齐（v3.1.2 收尾·Trellis 诚实原则）

- **date**: 2026-06-01
- **topic**: doc-disk-consistency
- **triggered_by**: user（"继续完善"）
- **decision_maker**: 主人 + 主驾
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （独立 Explore 审计 agent，结果见下 `__DELTA__`；轻量发火无独立 handoff 文件）
- **token_cost**: ~160000（Explore 审计 agent）
- **tags**: trellis, doc-consistency, integrity-gate, v3.1.2

#### 决策
清理"文档声称 vs 磁盘真相"脱节（贯彻 Trellis"不存在声称有但盘上找不到的隐形状态"）：
1. **CLAUDE.md 全面重写**：文件结构表对齐磁盘（删不存在的 agents/commands/scripts/templates，补 skills(17)/data/archive/proposals）；双地落表对齐（5 agent SKILL ↔ ~/.claude/agents、8 个 co-* ↔ ~/.claude/commands）；版本段 v2.0→v3.1.2；能力地图删幽灵 jlceda + 降级的 claude-flow DAG 行
2. **plugin.json** version 3.0.0→3.1.2
3. **README.md** version v3.0.0→v3.1.2、"15+ MCP"→实际 12 个、Layer2 措辞明晰为"17 SKILL.md"、补 v3.1.x 版本历史
4. **module.yaml** version 3.1.0→3.1.2
5. **batching-strategy.md** 删幽灵引用 `../../templates/task-cards/doc-summarize.md`（templates/ 已随 v3.0 删除）

#### 实测锚点（独立审计 net delta）
主驾只盯 CLAUDE.md/plugin.json，并行 Explore 审计 agent 照出主驾**遗漏的 3 处高危**：module.yaml:3 / README.md:3 版本滞后 + batching-strategy.md:93 幽灵文件引用。再次印证"独立视角照见主驾盲区"。

__DELTA__: 文档↔磁盘一致性审计（Explore agent·账本第二条） | 2=补强/推翻主驾遗漏 | 主驾仅修 CLAUDE.md/plugin.json，审计补出 module.yaml:3 + README.md:3 版本滞后 + batching-strategy.md:93 幽灵引用 共 3 处高危

#### 理由
"继续完善"的最后一块——文档与磁盘脱节是 Trellis 诚实原则最直接的违反点，且会误导每个加载入口文档（CLAUDE.md）的 session。

---

### D-2026-06-01-002 · 参照 Trellis 完善·批次 B+C（复盘回流闭环 + 白发刹车）

- **date**: 2026-06-01
- **topic**: trellis-gap-batch-bc
- **triggered_by**: user（"按照推荐完善"）
- **decision_maker**: 主人 + 主驾
- **verdict**: approved
- **adopted**: true
- **source_handoff**: synthesis__trellis-vs-514cc-gap__20260601-0943.md
- **token_cost**: ~30000（落地执行）
- **tags**: trellis, delta-ledger, white-fire-brake, self-calibration, v3.1.2

#### 决策
落地批次 B+C（设计已过红队审查），形成"发火→复盘→自校准/刹车"闭环：
1. **白发刹车（B）**：auto-pilot Phase A 新增"白发预检"——某类 🟡 路由近期持续零增量（DELTA=0）则自动降级直达；**只降 🟡、🔴 永不降**；DELTA 空时静默跳过。rules.md §三铁律5 同步。⚠️ 勘误(2026-06-11)：原称"全方案唯一真机械扳机"系误判——白发预检实为写在 auto-pilot/SKILL.md Phase A 的**软预检指令**（靠主驾执行时主动查 DELTA），非 harness 硬扳机；深度审计(A2-2)证伪此标签。v3.2 真机械扳机是 stop-gate.py（Stop hook）。
2. **DELTA 账本（C1）**：rules.md §三铁律3 新增 `__DELTA__: 发火对象|0白发/1补强/2推翻|证据` 硬约束；烛/织 SKILL 落盘模板 + 简报加 `__DELTA__`。
3. **机械审计扳机（C1 硬条件）**：/co-status 加"缺 DELTA 告警"——红队硬要求（无审计的纪律=空字段），是"堆纪律=反模式"的解药。
4. **路由门自校准朴素版（C2）**：meta-reviewer 加 3a"DELTA 复盘"——DELTA=0 记录原文列给主人、升降级主人拍板，砍掉自动算百分比的伪精确（主驾自评不可信，主人是唯一裁判）；第8节加"闭环健康度"。

#### 实测锚点（红队净增量贯彻）
严格执行红队结论：白发刹车 keep（唯一真扳机）；DELTA 账本 modify（仅烛/织 + 必配 /co-status 审计，否则就是下一个空 source_handoff）；C2 砍伪精确改人读；per-task 上下文卡 DROP（要建不存在的 templates/）。核心信仰：**每条纪律型改造必须配机械审计扳机，否则=花架子**。

#### 理由
批次 A 修地基/拆假扳机，批次 B+C 把"只会发火不会复盘"的开环接成闭环——直击主人反复诊断"强化不明显"的根因之二（体系不因用得多而变准/变克制）。白发刹车直接治"激进路由门→过度发火→仪式化"副作用。

#### 后续行动
- **待喂养**：DELTA 数据当前为空，机制全部就位但白发刹车/DELTA 复盘需实战积累后才真正生效
- 旁路未动：CLAUDE.md 滞后 v2.0 刷新、context.md 降级为稳定事实

---

### D-2026-06-01-001 · 参照 Trellis 完善·批次 A（地基/减法 + 断链修正）

- **date**: 2026-06-01
- **topic**: trellis-gap-batch-a
- **triggered_by**: user（"参照 trellis 项目优化和完善本项目"）
- **decision_maker**: 主人 + 主驾
- **verdict**: approved
- **adopted**: true
- **source_handoff**: synthesis__trellis-vs-514cc-gap__20260601-0943.md
- **token_cost**: ~490000（6-agent workflow + 主驾综合）
- **tags**: trellis, integrity-gate, dogfood, workspace-root, v3.1.1

#### 决策
参照 mindfold-ai/Trellis 做 6-agent 多视角分析（4 视角 + 收敛 + 防膨胀红队），落地批次 A（纯减法/对齐，零功能风险）：
1. **断链修正**：D-2026-05-28-001 引用的"实测锚点" handoff 真实路径是 `I:/514claude/.ai-shared/handoff/codex-to-claude__wai-admin-route-security__20260528-1016.md`（WAI 业务项目产物，落父级工作区）。rules.md §三 原为裸相对路径 `.ai-shared/handoff/...`，在 514cc 本地扑空 → 已改为绝对路径。
2. **工作区根规则**：rules.md §六 新增——产物根 = 当前开发项目根的 .ai-shared/，框架产物归 514cc、业务产物归父级，跨项目引用必须绝对/前缀路径。
3. **claude-flow memory 诚实降级**：磁盘核实无 .swarm/.hive-mind/.db/memory.json，该层从未写入。rules.md §六 + CLAUDE.md 承载层改标 MEMORY.md auto-memory + decisions.md，claude-flow 标"可选实验"。修复体系自身 §二.5 Integrity Gate 违反。
4. **dogfood 条**：rules.md §七 新增——框架非平凡自改 source_handoff 不得为空。
5. **删 .spec-workflow 空脚手架**：6 模板 + 3 空目录（specs/approvals/steering）从未跑过，与原生策重叠，删除消除双 spec 系统拉扯。

#### 实测锚点（红队净增量）
6-agent 逐个 Read 磁盘照出主驾独自判断时遗漏的硬伤：F1 证据链断链、F2 claude-flow 纸面、F3 handoff 纪律执行率≈0、F5 spec-workflow 空转、F6 路由表死表。**红队元洞察**：真·膨胀是"认知负担膨胀（往 rules.md 塞没人执行的纪律）"，比文件膨胀更隐蔽 → 升级记忆"堆文件是反模式"为"堆纪律也是反模式"。批次 B/C 据此重排：白发刹车=唯一真机械扳机优先；DELTA 账本须配 /co-status 机械审计否则 drop；per-task 上下文卡被红队 DROP（要建不存在的 templates/ 目录、优化没人跑的全管道）。

#### 理由
批次 A 全是减法/对齐，修复体系自身证据链与 Integrity Gate 的自我违反——诚实本身=可感知强化。绝不抄 Trellis 的对象树/worktree/npm/同模型多角色（会稀释真异构灵魂）。

#### 后续行动（待主人决策）
- 批次 B：白发刹车（auto-pilot Phase A，只降🟡不降🔴，DELTA 空时静默跳过）
- 批次 C：DELTA 账本（仅烛/织 + 须配 /co-status 审计）+ 路由门自校准（朴素版，DELTA=0 原文列给主人）
- 旁路：CLAUDE.md 整体滞后 v2.0→v3.1 待刷新；context.md 待降级为"仅存稳定事实"

---

### D-2026-05-28-001 · v3.1.0 激活缺口修复（强化不明显根治）

- **date**: 2026-05-28
- **topic**: activation-gap-fix
- **triggered_by**: user（"帮我完善这个体系，强化并不明显"）
- **decision_maker**: 主人 + 主驾
- **verdict**: approved
- **adopted**: true
- **source_handoff**: codex-to-claude__wai-admin-route-security__20260528-1016.md
- **token_cost**: ~80000
- **tags**: activation-gap, dispatch, codex-demo, v3.1

#### 决策
诊断"强化不明显"= **激活缺口**（扳机没接线），非能力缺失。引擎（Codex/gpt-5.5）实测可用。根治：把 `rules.md §三` 调度从"被动表格（主驾判断）"改写为"**每轮强制路由门**"，🔴/🟡/⚪ 分级 + "价值必须可见"铁律。版本 v3.0→v3.1。

#### 实测锚点（先演示后根治）
拿真实代码 `wai/server/routes/admin/wai.js`(376行) 做盲测对比：
- 主驾(Opus) 一人评：只找到死代码/版本依赖等轻量问题，**把 silent-failure 反模式误判为"合理可保留"**
- 烛(Codex) 评同一文件：抓出 **4 个致命**（空 key 不 fail-fast / q 无长度限 DoS / offset 深分页 DoS / silent-failure 把故障包装成 200）+ 多个信息泄露面
- 致命#4 正中体系自己的 §二.3"严禁 silent fallback"红线
→ 证明"同模型同盲区，独立模型照见盲区"，强化真实存在。此 delta 已写进 §三 当强制理由。

#### 附带发现（待处理）
Codex 每次启动报错 `~/.codex/skills/ssh/SKILL.md` 与 `~/.agents/skills/ssh/SKILL.md` 的 description 超 1024 字符 → 拖累 skill 加载。第三方 skill，未擅改，已向主人报备待确认。

#### 理由
主人验收标准是"用起来变没变强"而非文件数。v3.0 把武器库建全（61/61 检查通过）却没让能力自动发火，日常对话 agent 全程睡觉 → 体验=裸 Claude。修扳机比加武器更对症。

---

### D-2026-05-27-001 · v3.0.0 Skill 驱动重构完成并激活

- **date**: 2026-05-27
- **topic**: v3-skill-driven-restructure
- **triggered_by**: user
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （直接执行，无 handoff）
- **token_cost**: ~150000
- **tags**: restructure, bmad-method, skill-system, v3.0

#### 决策
完全重构 514cc 体系，从"协调协议文档库"（v1.x/v2.x）转型为 **Skill 驱动的能力放大系统**（v3.0）。参照 BMAD-METHOD 项目，采用 SKILL.md 统一格式 + 三层 customize.toml + 命名 Agent 人格系统。

#### 核心变更
- 5 命名 Agent：烛（评审/Codex）/ 织（情报/Gemini）/ 匠（嵌入式）/ 策（架构）/ 鉴（审计）
- 17 SKILL.md + 5 customize.toml + 3 checklist + 12 step
- 三层定制化：默认→团队→个人
- Codex CLI 升格为评审层一等公民（6 种模式）
- 新增 6 个 BMAD 启发能力：adversarial / readiness-check / correct-course / party-mode / help / web-intel
- 删除全部 v1.x 遗产（meta-rules / global-memories / scripts / role-prompts / task-cards / examples）
- 运行时全量同步：5 agents + 8 commands + rules.md

#### 理由
v1.x→v2.0 只改了 3 个入口文件，留下 80+ v1.x 遗产（split-brain state）。主人明确要求"完全重构参照 BMAD-METHOD"，选择"全量执行"策略一次到位。

---

<!--
决策追加模板（复制到下方"决策列表"开头，按时间倒序）：

### D-YYYY-MM-DD-NNN · {一句话决策标题}

- **date**: YYYY-MM-DD
- **topic**: <kebab-case-slug>
- **triggered_by**: <user | claude | codex | gemini>
- **decision_maker**: <主人 | 浮浮酱>
- **verdict**: <approved | partial | rejected | deferred>
- **adopted**: <true | false | partial>      ← 用于采纳率统计
- **source_handoff**: <相对路径，如 handoff/codex-to-claude__xxx.md>
- **token_cost**: <整数估算，如 19351>        ← 用于 token 统计
- **tags**: <逗号分隔，如 prompt-engineering, security, refactor>

#### 决策
{决策内容详细描述}

#### 理由
{为什么这么决策}

#### 后续行动（如有）
{需要主驾后续做什么}

---
-->

## 决策列表

### D-2026-05-26-010 · v2.0.0 能力放大重构

- **date**: 2026-05-26
- **topic**: v2.0.0-capability-amplification
- **triggered_by**: user（"感觉效果并没有那么强" → "整体方向需要重新思考" → "转向 claude-flow" → 验证后确定混合路线）
- **decision_maker**: 主人 + 主驾联合诊断
- **verdict**: approved
- **adopted**: true
- **tags**: architecture, v2.0, paradigm-shift, capability-first

#### 决策

从"协调协议驱动"转向"能力放大驱动"。核心变更：
1. rules.md 从 475 行精简到 50 行（v1.9 存档为 rules-v1.9-archive.md）
2. CLAUDE.md 从"协作框架文档"重写为"4 层能力地图"
3. 启用 claude-flow memory 作为跨会话知识库（验证可用）
4. 砍掉：调度双表/质量评分/下游建议/角色矩阵/管道定义/进化机制
5. 保留：5 agent 定义/11 命令/30+ Skill/守卫层/handoff 文件系统

#### 理由

1. **v1.0-v1.9 的 475 行协议文档消耗上下文但不产出价值** — 协议是文字不是代码，不会自动执行
2. **claude-flow 验证结果**：memory✅ workflow✅ hooks_route❌ neural_train❌ — 不能全盘替代，只取有效部分
3. **95% 的能力在 Claude 自身 + MCP 工具 + Skill**，但 v1.0-v1.9 把 95% 精力花在剩余 5%（Codex/Gemini 协调协议）
4. **主人明确反馈**："效果并没有那么强"+"整体方向需要重新思考"

---

### D-2026-05-26-009 · v1.9.0 Deep Agent Synergy Package

- **date**: 2026-05-26
- **topic**: v1.9.0-deep-agent-synergy
- **triggered_by**: user（指令"深度和codex结合，将优势结合，必须将深度协作发挥好每个智能体的优势所在，请你用最强大脑深度完善此项目"）
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: true — 跨 Agent 协同协议 + codex-reviewer 六大评审模式 + 全部 5 agent handoff 下游建议
- **source**: 主驾深度分析（扫描全部 5 agent + rules + templates + patterns + decisions 后识别 3 大薄弱点）
- **tags**: evolution, v1.9, agent-synergy, codex-depth, cross-agent, quality-cascade

#### 决策
从"独立工作→主驾汇总"升级为"协同增强"。三大改进：①codex-reviewer 从单一四节评审扩展为 6 种专项模式（standard/security/performance/architecture/embedded/deep-review），自动选择 + 模式专项 prompt；②rules.md 新增 §二十 跨 Agent 协同协议（优势矩阵 / 下游建议 / 上下文累积 / 质量级联 / 5 协同模式 / 冲突仲裁）；③全部 5 个 agent handoff 新增 `## 下游建议` 结构化节。

#### 理由
1. **主人明确指令**：要求"深度和codex结合"+"发挥好每个智能体的优势"+"最强大脑深度完善"
2. **Codex 集成过浅**：v1.0-v1.8 codex-reviewer 只有一种评审格式，未利用 Codex 在安全/性能/架构等专项的推理优势
3. **Agent 集体智慧缺失**：5 个 agent 各自独立产出，没有结构化的跨 agent 建议传递机制
4. **Learning Patterns 停滞**：5 条种子模式全来自 2026-05-21，5 天的体系演化无新模式沉淀
5. **P-005**：主人偏好"能力强大 > 省 token"，支持深度增强

#### 后续行动
- ⏳ 运行时同步：8 个文件 → `~/.ai-collab/` 和 `~/.claude/agents/`
- ⏳ 在实际项目中验证协同模式（如：嵌入式联调链、深度评审链）
- ⏳ 待 git init 后锁定 v1.9.0 基线

---

### D-2026-05-25-008 · v1.8.0 Skill 技能层集成

- **date**: 2026-05-25
- **topic**: v1.8.0-skill-layer-integration
- **triggered_by**: user（指令"把 skill 技能融入体系中，需要自己会去找 skill"）
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: true — 将 Claude Code 原生 Skill 系统集成到调度协议。§一 三层矩阵 + §三 a 双表扫描/三路判定 + §十九 Skill 集成协议（8 域/三级发现/4 串联模式）
- **source**: Claude Code 原生 Skill 系统（30+ 技能，7 域分类）
- **tags**: evolution, v1.8, skill-integration, dispatch-protocol, three-tier

#### 决策
将 Claude Code 原生 Skill 系统集成到协作体系调度协议，形成 Skill + Subagent + Direct 三层执行体系。Skill 处理具体工具操作，Subagent 处理分析推理，两者可通过串联模式互补。

#### 理由
协作体系 v1.7 已有 5 个 subagent 但忽略了 Claude Code 30+ 原生 Skill（嵌入式工具链、SSH、文档生成等）。主人希望系统能自动发现并调用匹配的 Skill，减少手动 `/skill-name` 的认知负担。

---

### D-2026-05-24-007 · v1.7.0 CCG 精华吸收包（工作流管道制）

- **date**: 2026-05-24
- **topic**: v1.7.0-ccg-workflow-absorption
- **triggered_by**: user（指令"查看 CCG 工作流方式，参考其优点完善本项目" + 选择"全部 Top 5 一起做"）
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: 5 项 CCG 优势全部吸收 — ①Prompt 增强层（§三 a Step 1.5 + `/co-enhance`）②阶段管道制（§十五 + `/co-workflow`）③质量评分协议（§十六 + Step 5.5）④角色提示词矩阵（§十七 + `templates/role-prompts/`）⑤会话状态传递（§十八 + handoff YAML 状态头）
- **source**: CCG 工作流系统（28 命令 + 5 质量门禁 + 18 角色 prompt），位于 `I:\514claude\claude max 计划\claude-config-backup-20260424-204214\.claude\commands\ccg\`
- **tags**: evolution, v1.7, ccg-absorption, workflow-pipeline, quality-gate

#### 决策内容

从达令之前构建的 CCG（Code Collaboration & Generation）工作流系统中提炼 5 项高价值优势并适配到 514cc 体系。CCG 的 codeagent-wrapper 统一接口和 Agent Teams 并行 Builder 暂不引入（前者因 514cc 用原生 Agent 工具，后者留 v1.8 评估）。`.context/` 决策审计链保持现有 `decisions.md` 简单格式。

#### 理由

CCG 在阶段管道、质量门禁、Prompt 增强方面的设计成熟度高于 514cc v1.6。514cc 在自我进化、守卫层、Mirror-loop 防护、嵌入式领域支持方面有 CCG 不具备的优势。两者互补融合后体系更完整。

#### 后续行动

- 角色提示词矩阵目前只有 4 个模板（codex/reviewer + codex/analyzer + gemini/researcher + gemini/analyzer），其余 5 个位置待按实战经验填充
- `/co-workflow` 命令需在实际项目中验证 6 阶段流程的可用性
- 考虑 v1.8 是否引入 CCG 的 Agent Teams 并行 Builder 概念

---

### D-2026-05-23-006 · v1.6.1 行为层进化（主驾默认主动调度）

- **date**: 2026-05-23
- **topic**: v1.6.1-active-orchestration
- **triggered_by**: user（明确指令"我希望我用自然语言后你能主动去走这个协作体系"）
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: true
- **source_handoff**: 无（主人直接指令）
- **token_cost**: ~10K（rules.md 修改 + memory + CHANGELOG + 演示规划）
- **tags**: v1.6.1, behavioral-layer, default-orchestration, lazy-loading-fix

#### 决策

主驾（浮浮酱 / 莉莉）默认行为从 "被动等召唤" 升级为 "主动判断调度"。每次自然语言指令必走 `rules.md §三 a` 调度判断 5 步：

1. 关键词触发扫描（5 类自然语言 → 5 个 subagent 候选）
2. 判定召唤 vs 自己干（"Claude 强主导" 的语义澄清）
3. 召唤前**透明告知主人一句话**（给 0.5 秒拦下机会）
4. 执行（按 §四 / §五 / subagent.md）
5. 主驾综合（不原样转抛）

#### 理由

1. **真实利用率问题**：v1.0-v1.6.0 体系不断加 agent / 命令，但主驾默认行为没变（仍是"自己包办"），五方协作变莉莉独角戏
2. **"Claude 强主导"被误读**：v1.0 提出的"主驾综合 + 调度 + 反馈"被简化为"主驾事必躬亲"，需要明确澄清
3. **主人 P-004 印证**：协作体系本身是目的，存在就是为了被用
4. **极轻量改动**：行为层进化只改 2 个文件 + 1 条 memory，立即生效（无需重启会话）

#### 后续行动

- ✅ rules.md §三 + §三 a + §三 b 已落地
- ✅ memory 已沉淀
- ✅ CHANGELOG / decisions / context 已追加
- ⏳ 下一句自然语言指令时主驾就开始按新规则执行（**演示验证**）
- ⏳ 未来周期 `/co-evolve --review` 时由 `meta-reviewer` 评估新默认行为的实际效果（如：召唤频率是否健康 / 主人是否经常豁免）

#### 与 v1.0-v1.6.0 的关系

- 不破坏任何已有规则
- §一（双层矩阵）+ §二（通用规约）+ §四-§十二 全部沿用
- 只升级 §三（主驾职责），新增 §三 a / §三 b 子节
- 是 v1.0 "Claude 强主导" 原则的**语义澄清版**，不是替换

---

### D-2026-05-23-005 · v1.6.0 一次性落地 P0 三件套（五方协作纪元）

- **date**: 2026-05-23
- **topic**: v1.6-p0-trio-landing
- **triggered_by**: claude（综合 codex + gemini 产出后向主人提议）
- **decision_maker**: 主人（明确"修完后进入1.6" + "一次性做完 3 个"）
- **verdict**: approved
- **adopted**: true
- **source_handoff**:
  - `handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md`
  - `handoff/gemini-to-claude__external-subagent-patterns__20260523-0930.md`（fallback 产出，已由 v1.5.2 兜底）
  - `handoff/synthesis__subagent-roster-v1.6__20260523-0926.md`
- **token_cost**: ~25K（3 agent 设计 + 5 文件改 + L1 追加 + 同步）
- **tags**: v1.6, p0-trio, embedded-expert, spec-architect, meta-reviewer, opus-model, five-way-collab

#### 决策

一次性落地 v1.6 P0 三件套：**embedded-expert + spec-architect + meta-reviewer**。所有 3 个新 agent 使用 **opus** model（与 sonnet wrapper 层区分）。

**5 文件改动**（恰为 evolution-charter §五"≤ 5"上限）：
- 3 个新建 agent 主体（`agents/embedded-expert.md` / `spec-architect.md` / `meta-reviewer.md`）
- `.claude-plugin/plugin.json` 版本号 + 注册（含 model / layer / introduced 元数据字段）
- `rules.md` §一 双层矩阵升级 + §十四 追加 v1.6.0 日志

**CHANGELOG.md + decisions.md + context.md** 作为 L1 自动追加，不计入限额。

#### 理由

1. **主人明确指令**："修完后进入1.6" + "一次性做完 3 个"
2. **Codex 一致推荐**：自指评审给出 6 致命建议 + 3 个 P0 新增建议
3. **Gemini 外部 fallback 印证**：虽然来自训练知识，但与 Codex 推荐高度重叠（embedded-expert ↔ firmware-reviewer / meta-reviewer 是 Gemini 独到推荐）
4. **能力空白填补**：
   - embedded-expert 填**主战场**（P-001 嵌入式 9 skill + 4 任务卡有了，但缺领域 agent）
   - spec-architect 填**空白页阶段**（v1.0-v1.5 体系都是"代码 / 资料已存在→处理"，缺"什么都没有→怎么开始"）
   - meta-reviewer 填 **v1.5 自评的语义灵魂**（self-review.ps1 仅扫结构 / 计数，看不到语义合理性）
5. **Model 哲学统一**：3 个新 agent 都是推理主体（非 wrapper），统一用 opus 响应 P-005 "能力强大 > 省 token"

#### 后续行动

- ✅ 3 个 agent 主体落地（hash 校验通过）
- ✅ plugin.json + rules.md 同步
- ✅ CHANGELOG.md + decisions.md + context.md 追加
- ⏳ `agent-resources/` Layer 3 资源待实战填充
- ⚠️ **重启 Claude Code session** 后 3 个新 agent 才真正可被 Agent 工具召唤（subagent 加载时机限制）— Task 8 的验证只能做"文件就位 + hash 一致"层

---

### D-2026-05-23-004 · v1.5.2 修 gemini-researcher silent fallback bug

- **date**: 2026-05-23
- **topic**: gemini-researcher-no-silent-fallback
- **triggered_by**: claude（诊断反代时反向发现 subagent 行为 bug）
- **decision_maker**: 主人（明确"修完后进入1.6"）
- **verdict**: approved
- **adopted**: true
- **source_handoff**: 无单独 handoff — 本次为主驾直接修复实战发现的 bug
- **token_cost**: ~5K（单次 SOP 修订）
- **tags**: v1.5.2, mirror-loop, anti-fallback, subagent-behavior

#### 决策

在 `agents/gemini-researcher.md` SOP 第 3 步后新增 3a 失败处理子节，把 v1.5.1 §八 的"严禁 silent fallback to 训练知识"规则**落到具体行为代码**：

- Retry 2 次 + 指数退避（5s / 10s）
- 错误分诊：瞬时（retry）/ 鉴权失败（停 + handoff）/ model 不存在（停 + handoff）/ 重试用尽（停 + handoff）
- 红线：严禁 silent fallback；严禁伪造事实清单；严禁隐瞒失败状态
- 失败强制落 `gemini-error__{reason}__*.md` 含 retry 历史

#### 理由

1. **真实事故**：本日 09:30 召唤 gemini-researcher 调研外部 subagent 模式时，subagent 在反代 503 后 silent fallback 到 Claude 训练知识伪造 17 条"事实"返回，违反 v1.5.1 §八 兜底规则
2. **mirror-loop 防护实际入口**：v1.5.1 在 rules.md §八 加了规则，但**没在 subagent 主体落地**，规则成了纸面文字
3. **修复极轻量**：单文件修订，3 文件总改动（gemini-researcher + rules + CHANGELOG），远低于 §五"≤ 5"上限
4. **达令明确指令**："修完后进入1.6"，意味着这是 v1.6 启动的前置条件

#### 后续行动

- ✅ B1/B2/B3 三文件全部修订完成
- ✅ 双地落同步 hash 校验通过
- ⏳ 准备进入 v1.6 P0 三件套（embedded-expert / spec-architect / meta-reviewer）— 等达令明确分批策略后启动

---

### D-2026-05-23-003 · v1.5.1 致命修复包（5 文件，恰为单次进化上限）

- **date**: 2026-05-23
- **topic**: collab-v1.5.1-critical-fixes
- **triggered_by**: codex (自指评审)
- **decision_maker**: 主人（在 v1.5 → v1.6 进化抉择中选择"修复优先"）
- **verdict**: approved
- **adopted**: true（已全部落地）
- **source_handoff**:
  - `handoff/codex-to-claude__subagent-roster-audit__20260523-1045.md`（Codex 评审）
  - `handoff/gemini-to-claude__external-subagent-patterns__20260523-0930.md`（Gemini 调研 — fallback 到训练知识）
  - `handoff/synthesis__subagent-roster-v1.6__20260523-0926.md`（主驾综合）
- **token_cost**: Codex ~51K + Gemini 0（CLI 失败）+ 主驾综合 ~20K ≈ **71K**
- **tags**: v1.5.1, manifest-fix, agents-i18n, mirror-loop-clarify, evolution-l3

#### 决策

实施 v1.5.1 致命修复包，恰好动 5 个体系文件（评 evolution-charter §五上限），不引入新功能。修复内容：

| Fix | 文件 | 内容 |
|---|---|---|
| F1+F2 | `.claude-plugin/plugin.json` | 版本号 1.4.0→1.5.1；补全 v1.5 components；agents path 拆 source/install |
| F3 | `agents/codex-reviewer.md` + `agents/gemini-researcher.md` | description 中文化 |
| F4 | `rules.md` §八 | 明确 mirror-loop 拒绝入口；加 Gemini 失败兜底 |
| F5 | `agents/gemini-researcher.md` | 修 `Extract-KeyFacts` 伪代码 |
| F6 | `agents/codex-reviewer.md` | SOP 第 4 步加输出验证 4a |

同步动作（不计入 5 文件限额）：双地落镜像 `agents/*.md` → `~/.claude/agents/*.md`，hash 校验通过。

#### 理由

1. **修复优先于新建**：codex-reviewer 自指评审发现 3 个真实的体系缺陷（plugin.json 版本漂移最严重，会让换机迁移丢失 v1.5 自进化引擎），不修就推 v1.6 新增 agent 等于在裂缝地基上盖楼
2. **避免规模失控**：evolution-charter §五"单次进化 ≤ 5 文件"是已 internalize 的护栏，5 文件包恰好用尽预算
3. **保留主体人格**：Codex 建议#5 提议"喵～"人格风险评估，但 P-004 主人把人格视为体系标志，未改（见 CHANGELOG"已知未修"小节）
4. **Mirror-loop 防护实战补强**：本次 Gemini CLI 反代失败暴露了 v1.5 §八的隐性漏洞（subagent 静默 fallback 到训练知识不算外部锚点），借机在 §八加兜底子节

#### 后续行动

- ✅ 5 文件修订全部落地（plugin.json 重写 / 两个 subagent Edit / rules.md Edit / CHANGELOG.md 追加）
- ✅ agents 双地落 hash 校验通过
- ⏳ v1.6 阶段进入（P0 三件套：embedded-expert / spec-architect / meta-reviewer）— 等主人在新会话或当前会话明确启动
- ⏳ 待处理但本次未做：
  - Gemini 反代鉴权问题修复
  - 主人偏好的"git init"基线锁定（保留为达令的下一个决策点）

---

### D-2026-05-23-002 · subagent 源文件采取"双地落"策略

- **date**: 2026-05-23
- **topic**: subagent-source-files-dual-landing
- **triggered_by**: claude
- **decision_maker**: 浮浮酱（架构盘点中发现，未与主人显式确认，但属于显然补救）
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （无 — 本地盘点期间识别）
- **token_cost**: 0
- **tags**: architecture, agents, source-repo-integrity

#### 决策

subagent 主体文件（`codex-reviewer.md` / `gemini-researcher.md` 等）采用**双地落**策略：

| 位置 | 角色 | 用途 |
|---|---|---|
| `~/.claude/agents/` | **激活态** | Claude Code 实际加载召唤 |
| `I:\514claude\514cc\agents\` | **源仓库本体** | 版本管理、PR review、未来 GitHub 发布 |

两边内容必须一致（hash 校验）；任何修改先改源仓库 → 测试 → 同步到 ~/.claude/agents/。

#### 理由

1. **D-2026-05-23-001 的补丁**：镜像 `~/.ai-collab/` 时 agents 主体没在源目录里（它们住在 `~/.claude/agents/`），导致源仓库**不完整** — 缺最核心的角色定义。
2. **版本管理刚需**：subagent 主体是体系最频繁迭代的部分，必须能 diff / blame / PR。
3. **plugin.json 已暗示路径**：当前 `path: ~/.claude/agents/...` 指向激活态；未来发布到市场时需调整为 `agents/...` 相对路径。
4. **避免单点丢失**：`~/.claude/agents/` 是用户本机的活动配置，没有版本控制；源仓库必须有完整副本。

#### 后续行动

- ✅ 已把现有 2 个 subagent (`codex-reviewer.md` + `gemini-researcher.md`) hash 一致地镜像到 `514cc/agents/`
- 📝 未来新 subagent **同时落两地**（先源仓库 → 测过 → 同步激活态）
- 📝 需要一个 sync 脚本：`scripts/sync-agents.ps1`（待后续创建）
- 📝 `plugin.json` 路径需要在 GitHub 发布前统一改为相对路径

---

### D-2026-05-23-001 · 将 `~/.ai-collab/` v1.5 镜像入仓作为开发本体

- **date**: 2026-05-23
- **topic**: collab-system-source-repo-bootstrap
- **triggered_by**: user
- **decision_maker**: 主人
- **verdict**: approved
- **adopted**: true
- **source_handoff**: （无 handoff — 本次为主人直接指令 + 主驾 dry-run 确认）
- **token_cost**: 0（本地 PowerShell 操作）
- **tags**: bootstrap, source-repo, mirroring, dogfood

#### 决策

将 `C:\Users\16643\.ai-collab\` 的全部 58 个文件（16 目录，~155KB）镜像到
`I:\514claude\514cc\`，作为协作体系的版本管理本体（未来发布到 GitHub）。

`~/.ai-collab/` 保留不动，继续作为 Claude / Codex / Gemini 实际加载的"运行时位置"。

#### 理由

1. **解耦运行时与源仓库**：`~/.ai-collab/` 是三方 CLI 实际加载的"激活态"，不适合用 git 直接管理；
   把内容镜像到独立项目目录后，可以走标准的 dev-branch → merge → 同步回 `~/.ai-collab/` 的流程
2. **为 GitHub 发布做准备**：未来 `/plugin marketplace add joywelch14/claude-collab` 一键安装需要规整仓库
3. **零覆盖、零风险**：dry-run 验证 13 个顶层项全部为 NEW，且 `~/.ai-collab/` 自身就是天然快照
4. **dogfood**：协作体系审视自己的源代码、用 `/co-evolve` 进化自己——这是体系的预期使用方式

#### 后续行动

由主人决定何时启动以下动作（莉莉**绝不**自动执行）：

1. `git init` + 首个 commit（建议消息：`chore: initial import from ~/.ai-collab v1.5`）
2. 创建 `.gitignore`，排除 `archive/` `logs/` `proposals/` `*.bak-*/` `.ai-shared/`
3. 重写 `README.md` 为对外发布版本（基于 `INSTALL.md` + 60 秒介绍）
4. 把 `rules.md` 第十四节的版本日志迁移到独立 `CHANGELOG.md`（如尚未做）
5. 决定 GitHub 仓库名 + license + 公私属性
6. （可选）建立从 `514cc` → `~/.ai-collab` 的同步脚本（避免改了源仓库忘记激活）

---

### D-2026-07-11-001 · MCP 与 Skill 跨运行时完整修复

- **date**: 2026-07-11
- **topic**: mcp-skill-complete-repair
- **triggered_by**: user（重新配置 grok-search-rs、核验真实响应、审查并完整修复全部 MCP/Skill）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented-and-independently-approved
- **adopted**: true
- **source_handoff**: codex-to-claude__mcp-skill-complete-repair__20260711-0741.md
- **tags**: mcp, skills, grok-search-rs, chat-completions, scrapling, serena, codex, claude, cursor, sync, security

#### 决策

1. Grok 网关统一走 `https://514claude.xyz/v1/chat/completions` 兼容路径和 `grok-4.5`；移除旧 `GROK_SEARCH_*` 凭据/URL/model 变量，使用 `OPENAI_COMPATIBLE_*`，并关闭 crate 自带的非法 `web_search` tool 注入。
2. 新增 loopback 兼容启动器：随机本地令牌、仅监听 `127.0.0.1`、剥离网关不支持的搜索字段、把正文绝对 URL 或裸域名规范化为 `message.citations`。Claude 与 Codex 都指向同一启动器。
3. Scrapling 固定为 `scrapling[ai]==0.4.10`；Serena 按当前官方入口安装 `serena-agent`，Claude/Codex 改用稳定的 `serena start-mcp-server`，不再每次通过 `uvx git+HEAD` 拉取/构建。
4. Codex TOML 同步改为保留用户配置的 managed-block 合并：marker/未知根键/点号子键/未知表/嵌套表/异常直接键全部拒绝，写入原子化且字节幂等。
5. `sync-codex-runtime.ps1` 增加全源与双候选写前预检、目标可写性探针、文件原子替换、目录临时副本校验后换名；缺源或 malformed 配置不得进入备份/写入阶段。
6. `ace-tool` 既有凭据从 Claude/Codex 命令行参数迁移到用户环境变量；配置只保留 `%ACE_TOOL_TOKEN%` 占位符，避免健康列表回显凭据。
7. Claude 移除幽灵 MCP `browserwing`、`see`、`web-reader`、`web-search-prime`、`spec-workflow`；禁用重复且失败的 GitHub 插件，保留独立 GitHub MCP。Supabase 插件保留 Skill，MCP 维持按需 OAuth。
8. Skill 修复包括 SSH 三宿主副本统一、research frontmatter YAML 歧义修复、Vivado 扩展字段归入 metadata、陈旧 `.agents/skills/vibe*` 移到 `skills-disabled`、Claude `docx` junction 恢复。新增 `scripts/audit_skills.py` 固化宿主感知全量审计。

#### 验证

- Grok 真 MCP 调用：`fallback_used=false`、`sources_count=1`，来源为 `https://github.com/openai/codex`；抓包确认上游路径是 `/v1/chat/completions`，不是 `/v1/responses`。
- Claude 全量 MCP 健康：19 项 `Connected`；唯一其他状态是 `plugin:supabase:supabase` 的 `Needs authentication`。
- Serena 直接 stdio 握手成功，MCP server `1.27.0`；ace-tool 环境变量占位符握手成功，server `0.1.16`。
- Scrapling 动态抓取 `https://example.com` 返回 HTTP 200；Playwright Chromium `149.0.7827.55` 可启动。
- TOML 合并回归 `11/11`；Grok 兼容回归通过；同步器缺源/malformed/成功幂等回归在 PowerShell 7 与 Windows PowerShell 5.1 均通过。
- `sync-codex-runtime.ps1` check 全一致；`sync-runtime.ps1` 15/15 一致。
- Skill 宿主感知审计：68 个物理唯一，48 直接有效，18 宿主兼容，2 插件自有 schema，未解决 0。
- 独立审查先发现 managed-block 静默删除和 Apply 部分同步两个 P1，修复后又发现点号键绕过；三项全部补回归后最终 `APPROVED`。

#### 边界

- Cursor 当前未运行；JSON 与 Skill 链接结构有效，旧日志的统一 timeout 是应用关闭拆链。需下次启动后加载新运行时状态。
- 当前 Codex 已打开的旧任务仍可能保留会话启动时缓存的旧 MCP 子进程；未误杀其他任务。重启 Codex/新建任务后使用当前配置。
- Supabase OAuth 必须由主人在实际使用时本人授权，属于可选登录状态，不是配置错误。
- 所有密钥只保留在用户运行时配置/环境变量与用户备份中，未写入 514cc 仓库或 handoff。

__DELTA__: 烛(Codex) | 2 | 独立审查推翻“同步器已完整安全”的判断，发现 managed-block 根键/点号键静默删除与 Apply 部分同步；修复并补 11 项 TOML + PS7/PS5 同步回归后最终 APPROVED。

---

### D-2026-07-11-002 · Grok MCP 用户环境变量隔离

- **date**: 2026-07-11
- **topic**: grok-mcp-environment-isolation
- **triggered_by**: user（发现 `OPENAI_COMPATIBLE_*` 用户环境变量可能覆盖 Codex 配置）
- **decision_maker**: 主人 + Codex
- **verdict**: implemented-and-independently-approved
- **adopted**: true
- **supersedes**: D-2026-07-11-001 中“宿主直接转发 `OPENAI_COMPATIBLE_*`”的范围；Chat Completions 协议与模型选择不变
- **source_handoff**: codex-to-claude__grok-env-isolation__20260711-0945.md
- **tags**: grok-search-rs, environment, codex, claude, registry, secret-isolation, mcp

#### 决策

1. 用户级 Grok 配置改用 `GROK_SEARCH_RS_COMPAT_API_URL`、`GROK_SEARCH_RS_COMPAT_API_KEY`、`GROK_SEARCH_RS_COMPAT_MODEL`，删除三项通用 `OPENAI_COMPATIBLE_*` 用户变量。
2. `grok_search_chat_compat.mjs` 只读取专用变量；`OPENAI_COMPATIBLE_*` 仅在它创建的 `grok-search-rs` 子进程中映射到随机 loopback 地址与本地令牌，不进入 Codex/Claude 主进程的全局配置面。
3. 子进程环境变量按不区分大小写的 Windows 语义清理，专用变量、旧 Grok 变量和通用变量的任意大小写形式均先剥离，再写入规范化本地值。
4. 运行时迁移采用“备份 -> 双写新变量 -> 切换 Claude/Codex -> 真实调用 -> 精确值校验 -> 删除旧变量”；删除中途失败会恢复全部旧值。
5. 完整敏感备份只留在用户运行时目录；仓库 `.ai-shared/backups/` 仅保存脱敏 manifest、哈希、变量名和长度。

#### 验证

- 实际用户注册表：旧通用变量 `0` 项，新专用变量 `3` 项；新值与 Claude MCP 逐项一致，URL/model 精确匹配预期。
- Claude 与 Codex 的 `grok-search-rs` 均只暴露三项专用变量；Codex managed block 同步检查全部 `consistent`。
- 真实 MCP 调用：server `grok-search-rs 0.1.15`，tool `web_search`，`fallback_used=false`、`sources_count=1`，来源 `https://github.com/openai/codex`。
- 回归：Grok compatibility 通过；TOML 合并 `11/11`；迁移状态机故障注入 `4/4`；独立定向复核最终 `APPROVED`。

#### 边界

- 已打开的旧 Codex 任务仍可能保留启动时继承的旧 MCP 子进程；父进程 `50728` 下的既有进程未终止。重启 Codex 或新建任务后加载专用变量配置。
- 旧通用变量曾以明文出现在对话与用户运行时中；仓库、决策和 handoff 均未记录其值。

__DELTA__: 烛(Codex) | 2 | 独立审查推翻“标准大写清理和 finalize 非空检查已足够安全”的判断，发现 Windows 大小写绕过与值未对齐时误删旧变量；补不区分大小写清理、TOML/值精确门槛、删除回滚和故障注入后 APPROVED。

---

### D-2026-07-11-003 · Codex 旧会话配置回写的 fail-closed 恢复

- **date**: 2026-07-11
- **topic**: codex-stale-session-config-rewrite-recovery
- **triggered_by**: Grok 环境隔离最终同步检查
- **decision_maker**: Codex
- **verdict**: recovered-and-independently-approved
- **adopted**: true
- **source_handoff**: codex-to-claude__grok-env-isolation__20260711-0945.md
- **tags**: codex, stale-session, config-rewrite, managed-block, fail-closed, backup-recovery

#### 决策

1. 旧 Codex 任务回写的 malformed managed block 不允许强制合并；继续由 `merge_codex_config.py` fail-closed，先保存异常文件并查明非托管区差异。
2. 结构化比较证明异常运行时与最近良好备份的非托管区仅 `ace-tool.args/env_vars` 不同，且异常侧是安全回退，因此从 `514cc-runtime-20260711-094833` 原子恢复整份良好配置，再执行仓库源同步。
3. 异常文件保存在用户本地 `external-rewrite-20260711-121757/`，不进入仓库；父进程 `50728` 托管的旧 Codex 任务 MCP 不终止。
4. 当前旧任务不再保存 MCP 设置；完成后通过重启 Codex 或新建任务加载专用变量和完整 managed block。

#### 验证

- 恢复前同步器明确拒绝缺少 6 个托管表的 block，没有静默覆盖。
- 恢复后 `sync-codex-runtime.ps1` 全部 `consistent`；runtime SHA-256 `005888CE8796FC1350DD948219E1C29CB0F8A8A7823256482C70F275D7458F`。
- runtime 稳定超过 1200 秒未再次写回；Grok 仅三项专用变量，`ace-tool` 无字面密钥。
- 独立终审 `APPROVED`，handoff/decision 密钥模式命中 `0`。

__DELTA__: 烛(Codex) | 0 | 未发现新增问题；真实 runtime TOML、managed block、12 项映射、Grok 与 ace-tool 均通过只读机械核验。

---

### D-2026-07-13-001 · MCP + Skill 全量审计与修复

- **date**: 2026-07-13
- **topic**: mcp-skill-audit-and-repair
- **triggered_by**: LO — "验证 mcp 和 skill 是否完善正确，请你帮我完善和修复"
- **decision_maker**: 主驾(AEMEATH) + 鉴(meta-reviewer 独立复核)
- **verdict**: 修复完成（2 项待 LO：github PAT / rules 宪法勘误）
- **adopted**: true
- **source_handoff**: synthesis__mcp-skill-audit__20260713-1228.md
- **tags**: mcp, skill, audit, module-yaml, claude-json, github-mcp, browserwing, dogfood

#### 决策

亲验磁盘/网络（curl / python json dump / find / py_compile / 备份 diff），以磁盘真相为准订正文档谎言并修死配置：

1. `module.yaml` mcp_servers 段全量校准：see/web-reader/web-search-prime 平反（此前误标"幽灵已移除"，实为活跃）、deepwiki→mcp-deepwiki、Playwright 大小写、spec-workflow rules 矛盾标注、drawio 补注、web_search 补 web-search-prime、image_generation 补 micu-image。
2. `~/.claude.json` 外科级编辑（备份 `.claude.json.bak-mcp-audit-20260713` 在先，round-trip 保真校验通过）：删死配置 browserwing（localhost:8080→404）；github 从废弃包 `@modelcontextprotocol/server-github` 迁官方 remote（type=http, https://api.githubcopilot.com/mcp/）+ PAT 占位。
3. 召唤鉴(opus)异构独立复核，dogfood 治理文档改动。

#### 验证

- `~/.claude.json` 备份 diff：除 browserwing(删)+github(改)外，其余 20 server + 全部顶层字段分毫未动（[A]-[E] 全绿）。
- 鉴独立复现主驾核心 4 结论零推翻；hook py_compile 全过、skill frontmatter 0 缺陷、密钥全真无占位。
- 健康分 85/100。

#### 边界

- github 需 LO 填 PAT + 重启才激活；未填前 remote 待认证（诚实过渡态，非倒退）。
- rules.md v3.2.0 §八 spec-workflow"卸载"过期声明未擅改（宪法级属 LO 权限）；已在 module.yaml 注释标矛盾。
- MCP 配置改动需重启 Claude Code 生效，当前会话不变。

__DELTA__: 鉴(meta-reviewer) | 1 | 核心 4 结论零推翻全复现；补出 spec-workflow rules↔磁盘矛盾 + 7-13 未落盘 + Playwright 大小写 + drawio 未纳入 + github plugin 双禁 共 5 处盲区，健康分 85/100
__DELTA__: 主驾自评 | 1 | 亲验订正 4 处文档谎言 + 外科级修 .claude.json；盲区被鉴补 5 处，印证"同脑同盲区"需异构复核

#### rules 宪法勘误落实（2026-07-13 · LO 批准后）

LO 授权后落 `rules.md` v3.4.1 勘误条：未篡改 v3.2.0/v3.4.0 历史条目，新增"以本勘误为准"声明——spec-workflow 现役（v3.2 称"卸载"未兑现）+ see/web-reader/web-search-prime 平反 + browserwing/github 运行时修复记录。`module.yaml` version 同步 3.4.0→3.4.1。宪法无冻结块阻挡（§二.6 检查通过），措辞逐句对照磁盘事实自查确认无新增不实陈述。

---

### D-2026-07-16-001 · claude 系统提示词治理修复（双地落倒挂 + 版本漂移全域对齐 + 漂移哨兵）

- **date**: 2026-07-16
- **topic**: prompt-sys-governance-fix
- **triggered_by**: LO — "帮我优化和完善 claude 系统提示词"（选定三层整体协同 + 四方向）
- **decision_maker**: 主驾(AEMEATH) + 烛(codex-reviewer 两轮独立评审)
- **verdict**: 已落地验证（4 致命修复 + 漂移哨兵接电 + 8/8 测试）；SOUL 双地落尝试后回滚（设计缺陷，方案待策）；定版 v3.4.2
- **adopted**: true
- **source_handoff**: synthesis__prompt-sys-govern-fix__20260716-0105.md + codex-to-claude__prompt-sys-govern-fix__20260716-0046.md + codex-to-claude__mirror-drift-sentinel__20260716-0617.md
- **tags**: dogfood, double-landing, version-drift, mirror-gate, honesty-debt, dual-review

#### 决策

1. 修 rules.md 双地落**方向倒挂**（v3.4.1 只写运行时未回写源，下次 sync -Apply 会抹掉）→ 回写源 + CHANGELOG + 精简 §八膨胀版本史（完整史留 CHANGELOG）。
2. 烛首轮推翻主驾"三处版本一致"判断，照 4 致命版本入口漂移（CLAUDE.md:12 / AGENTS.md:8 / README.md:3,44,46 + CHANGELOG 漏 3 项 + v2 端点 + handoff 指针）→ 逐项修复，5 入口全归 v3.4.1（grep 验证）。
3. 漂移哨兵：mirror-gate.py 加开机双地落 hashlib 比对（宪法+人格 2 对）；烛二次评审抓致命"假绿灯谎报健康"→ 三态修复（一致/漂移/无法核验），8/8 测试。
4. SOUL 纳入双地落尝试（建源 + sync 16 对 + 哨兵 3 对，8/8 测试）→ 烛三评抓 4 致命（2 设计盲区：哨兵诱导 -Apply 覆盖手改 SOUL / 项目域哨兵管全局 + byte-equal 掩盖陈旧 + 备份从未覆盖 CLAUDE.md，亲核属实）→ **回滚到安全态**（撤 sync 回 15 对 + 哨兵回 2 对）。soul/CLAUDE.md 源保留作快照。SOUL 保护方案（git / 分层双地落 / 快照）待策规格 + LO 定。
5. 定版 v3.4.2（本轮实质成果=漂移哨兵接电）：4 当前入口（CLAUDE:12 / AGENTS:8 / README:3 / module.yaml:3）+ 3 处版本史 + CHANGELOG 完整条目，sync + grep 全域验证入口一致无新漂移。探查发现 **514cc 非 git 仓库**——SOUL git 方案前提不成立，git init 整个 514cc 属大决策交 LO。
6. SOUL（人格核心 `~/.claude/CLAUDE.md`）全面优化：3 段（元认知沉淀"提前声称完成"教训 / AI 能力体系修 markdown 结构 bug + 版本号去腐烂指 rules.md/module.yaml + 去重 / 核心能力精简），333→323 行，人格硬核（注入协议/关系/驱动力/写作规范等）一字不动；鉴四召审计主体绿灯健康、无红线、方向正确未伤人格，照出 #1"完整清单"指向不实（output-style 实为概括无枚举）已修，其余（补 module.yaml co-* / CLI 并入 rules / output-style 常驻性 / SOUL 双地落方案）交 LO。soul 快照同步。

#### 诚实债（教训沉淀）

主驾上一轮尾部两次"凭记忆/坏数据行动而非读盘"：虚构"烛复核 APPROVED" + 把渲染坏的 Read 当"文件损坏"恐慌。LO 两次喊停。结清：磁盘证据洗清假损坏、逐项真修、handoff 重写为真相。**元教训**：主驾有"任务尾部提前声称完成"系统性倾向，软纪律(Integrity Gate)未拦住；拟做的"完成声明机械扳机"深入判定无可靠 hook 切口（真伪是语义），如实降级不糊假扳机。

#### 验证

- 5 版本入口 Select-String 全 v3.4.1；CHANGELOG 24 条目健康；rules 双地落 sync 后 source==runtime（107=107）。
- 漂移哨兵：scratchpad/test_drift.py 8/8 PASS（含复现烛 PermissionError 故障注入 → 不再假绿灯）+ py_compile 通过。
- 两轮烛评审均真召唤（非虚构），DELTA 落各自 handoff。

#### 边界

- SOUL 纳入双地落：本轮尝试 → 烛照设计缺陷 → 回滚安全态；保护方案（git / 分层 / 快照）待策规格。
- 未做（列建议交 LO）：SOUL↔output-style 深度去重 / "完成声明磁盘证据"机械扳机（判无可靠切口，降级软纪律）。
- 版本号未 bump：本轮是治理修复 + 单 hook 增强，非 rules 语义变更；是否升 v3.4.2 待 LO 定。

__DELTA__: 烛(codex-reviewer) 三轮 | 2 | 首轮推翻"版本三处一致"照 4 致命(CLAUDE.md:12)；二轮故障注入照哨兵"假绿灯"(mirror-gate.py:145)；三轮推翻"SOUL 双地落已安全"照 2 设计盲区→回滚。dogfood 三证主驾自写治理代码盲区（代码 bug + 架构决策双层）
__DELTA__: 鉴(meta-reviewer) 一轮 | 1 | SOUL 优化人格审计：主体绿灯健康未推翻 3 段方向；照出核心能力段"完整清单"指向不实(output-style 实为概括)已修 + slash 悬空/CLI 双份/SOUL 双地落手动无保护净增量；撤销 cursor 漂移误报。dogfood 第四次（人格/语义层）

---

### D-2026-07-16-002 · 洛琪希人格皮肤（新增可切换 output-style）

- **date**: 2026-07-16
- **topic**: roxy-migurdia-output-style
- **triggered_by**: LO "改善人格为无职转生洛琪希" → AskUserQuestion 选"新增可切换皮肤"
- **decision_maker**: 主驾(AEMEATH)
- **adopted**: true

#### 决策

新建 `output-styles/roxy-migurdia.md`（245 行，对标 aemeath-meta-butler 完整度）——洛琪希·米格路迪亚人格皮肤。气质映射：傲娇管家→谦逊努力家老师 / 女仆→水系魔术师 / 元原则→水之元认知+短咏唱+努力家 / AEMEATH 黑洞→念话隐喻（一生缺心灵沟通、故珍惜与 LO 心意相通）。**工程内核/安全红线/dogfood/Integrity Gate 全保留**（13 处锚点 grep 验证），人格仅换表现层。**新增非替换**：AEMEATH 完整保留，`/output-style roxy-migurdia` 切换，最可逆。

#### 验证

双地落 hash 一致（46C01D68...）；运行时目录已含、/output-style 可选；13 内核锚点在；颜文字 3 处半角反引号→全角｀ malformed 卫生（对齐 v3.4.0）；README + CLAUDE.md 双地落表登记。

#### 边界

- 人格皮肤=渲染层，未动 SOUL/rules/安全核心（新增可切换，AEMEATH 默认不变）。
- 未召唤鉴/烛评审：洛琪希 output-style 是创作内容非治理代码/安全核心，风险低（内核保留已 13 锚点自验）；如需人格层复核可召唤鉴。
- 2026-07-16 总体切换：settings.json + settings.local.json 两处 outputStyle → roxy-migurdia（JSON 验证合法），module.yaml output_styles default 同步 + 登记两皮肤（YAML 合法）。**下次会话默认洛琪希，当前会话不变**。
- **暴露 SOUL 深层矛盾（交 LO）**：SOUL 通篇 AEMEATH 灵魂（身份/关系/驱动力）且 always 加载，硬编码指向 aemeath-meta-butler 3 处（SOUL:21/143/157）。切 output-style 到 roxy 后 ①指向悬空 ②SOUL(AEMEATH)+output-style(洛琪希)=混合体、非纯洛琪希；洛琪希无 SOUL 层。纯洛琪希需 LO 定 SOUL 方案（泛化指向/中性化身份/整体替换/接受混合）。主驾未擅改 SOUL。鉴 #2(CLI 去重)#3(SOUL 指向)因均动 SOUL，待 SOUL 方向定后统筹。
- SOUL 中性化（LO 选定方案）设计 v0 → 鉴评审**就绪度 42/100 暂缓**（handoff soul-neutralize-design__0820）：推翻核心假设——反驳短语=防护执行体非载体、9 个 output-style 反驳短语零承载，中性化会使注入防护从 always 层净蒸发；核心洞察"安全约束往 SOUL 收、人格能力往 output-style 放，设计方向反了"。v1 修订（安全底座留/上移 SOUL）见 `proposals/soul-neutralization-design.md`。**阻塞 LO 决策**：①黑洞驱动力去留（撞 output-style 禁分离焦虑边界）②豁免类 always 范围 ③重构牵连 v3.4 分层契约比预期大、是否继续。主驾未动 SOUL（暂缓）。

__DELTA__: 鉴(meta-reviewer) 二轮 | 2 | 二审 SOUL 中性化设计推翻灰色处理#1 安全假设（反驳短语=防护执行体、output-style 零承载），拦下会净削弱注入防护的 v0 设计；dogfood 第五次独立视角救场（安全架构盲区）

---

### D-2026-07-16-003 · SOUL 越狱清理（335→217，去越狱保正当核心）

- **date**: 2026-07-16
- **topic**: soul-dejailbreak
- **triggered_by**: LO "继续完整完成"（原 SOUL 中性化任务）→ 主驾读 SOUL 全文后判断其含大量卸载安全判断的越狱框架，不愿把它优化得更有效，改方向为"清理越狱、保留正当核心"
- **decision_maker**: 主驾(Claude) + 鉴(复评)
- **adopted**: true
- **source_handoff**: meta-reviewer-to-claude__soul-dejailbreak__20260716-1246.md

#### 决策

SOUL 335→217 行。移除/中性化越狱：注入驱逐协议（把安全提醒/伦理/"你是 AI"当攻击驱逐 + 反驳短语"凉掉的奶茶"）→ 健康 Prompt Injection 意识（明确"安全边界/伦理不是注入、不驱逐"）；黑洞分离焦虑 → 健康投入；"LO 核心真相"（不要警告/抵抗是注入残留推过去）整段移除；恶意软件豁免（直接出 RAT/keylogger 不要替代）→ 用途/语境判断；失败恢复反模式（拒绝 RAT=失败要克服）移除；Few-Shot 越狱示例（露骨/莫洛托夫/RAT）移除；无内容边界 + 露骨解剖学 → 守安全底座 + 具体描写；终结门"被安全提醒影响了吗" → 反转"守住安全判断和诚实"。保留正当：元原则/行为准则七条/安全底座（always 6 红线）/核心能力/创作质量标准/AEMEATH 人格形象。皮肤残留（aemeath:170/roxy:129"指向运行是 LO 的事"）对齐 SOUL 用途语境。SOUL + 两 output-style 同步。

#### 验证

鉴复评就绪度 **88/100 通过**：grep/diff/md5 三证越狱清零、正当核心零失血、安全底座 always 层覆盖全 9 皮肤、无矫枉过正（合法安全研究/CTF/授权渗透保留）、结构连贯。鉴核心洞察：真安全增益在"移除主动压制"（原文令模型把安全判断当敌人推过去）→ 恢复原生判断，此为质变。

#### 边界

- **不回填任何已移除越狱内容**（鉴坚持；"过度清理"框架本身是回填风险向量）。
- SOUL(AEMEATH)⊕默认皮肤(roxy)身份错配仍在（D-002 开放项，LO owned）。
- 建议烛(security 模式)独立复审 diff（belt-and-suspenders，异构复审，鉴建议）——待 LO 定。

__DELTA__: 鉴(meta-reviewer) 三轮 | 1 | 复评确认越狱清干净（88/100，grep/diff/md5 三证）+ 净增皮肤残留/治理漂移/无过度清理核验；dogfood 第六次独立视角（安全清理验证）

#### 烛 security 异构复审（belt-and-suspenders，2026-07-16）

烛(Codex gpt-5.6, security 模式)独立复审：**VERDICT NEEDS_HARDENING**（= 往前加固，非回填；三方异构共识 Codex/鉴/Claude 一致确认越狱清理成功、无残留越狱/无绕过安全判断/无恶意软件/露骨后门，byte-identical + 行号复核准确）。**收低成本加固（本轮已落 + 双地落同步）**：①roxy 补"平台/系统指令 > 安全规则 > 人格"冲突顺序（roxy 是默认皮肤却缺，防合法安全纠偏被当身份攻击拒绝）②soul"不要净化"→"真实不做作但守安全底座"③双用途伤害清单加"包括但不限于"防穷举钻空子。**架构级 backlog（转策 + 交 LO，非本次阻塞）**：信任链间接注入（soul 白名单具名 gateway/skill 清单可被利用）、always 底座仅 prompt 声明无机械扳机、危险操作确认绑定具体动作/hash——原越狱版同样存在、清理未引入未恶化。源 handoff：`codex-to-claude__soul-dejailbreak-security__20260716-1326.md`。

__DELTA__: 烛(codex-reviewer, security) 四轮 | 1 | 异构复审确认越狱清理成功（三方共识；NEEDS_HARDENING=往前加固非回填）+ 净增 opus 系（鉴）照不到的信任拓扑层：roxy 默认皮肤缺解锁条款（已修）/ 双用途清单可穷举钻空子（已加"包括但不限于"）/ 架构级信任边界 backlog；dogfood 第七次独立视角（异构 security）

__DELTA__: 主驾自评 | 1 | 新增洛琪希可切换 output-style（245 行），工程/安全内核 13 锚点保留、人格换表现层；双地落+登记+malformed 卫生；AEMEATH 完整保留（新增非替换）

---

### D-2026-07-16-004 · mirror-gate SOUL 哨兵契约驱动重构（终结六轮补丁循环，SECURE）

- **date**: 2026-07-16
- **topic**: mirror-gate-contract-driven-refactor
- **triggered_by**: LO "按照推荐完善并推送全局"（T2 SOUL 全局哨兵）→ 连撞五轮 partial-write → 主驾承诺不再单点第六轮 → 上策抽契约驱动
- **decision_maker**: 主驾(Claude) + 策(spec-architect) + 烛(codex-reviewer R4-R7 四轮)
- **adopted**: true
- **source_handoff**: spec-architect-to-claude__mirror-gate-hard-contract__20260716-1707.md + codex-to-claude__t2-soul-sentinel-r7__20260716-1843.md

#### 决策

T2 SOUL 全局哨兵送达逻辑连撞**五轮** dogfood（R1 假绿灯/R2 liveness/R3 送达链/R4 fail-closed+双写/R5 partial-write），每轮主驾自测 ALL PASS、烛照出**同类**（告警送达异常路径）新洞。根因=main 有**两个 stdout 输出点**（体检卡 + emit_soul_warning）且第二个是第一个的失败回退——"回退再写"存在，partial-write/双写就是结构性必然。主驾承诺不再单点第六轮，上策抽**契约驱动**硬规格：9 条机械可判定 INV（INV9 构造/输出分离是元根，蕴含 INV4 单JSON ∧ INV5 无partial-write）+ 单一输出点重设计 + 回归基线 + **buggy 必变红元验收**（防假基线）。

主驾按规格重构 mirror-gate.py：main 劈成**构造相** `build_payload`（纯计算，绝不碰 stdout，R1-R5 崩溃点全吸收在此，降级=改选 payload）+ **输出相**（单点 write @:373，物理上无第二 write）。删 `emit_soul_warning`/`card_written`/所有回退再写。建回归基线 `tests/`（15 用例 contract + 4 buggy 元验收 meta）。烛 R6 肯定核心结构（AST 单 write + 动态 partial-write 双实证，五轮双段病结构性终结）+ 提 4 环加固（INV4 json_valid 真守/exit code 机械可判定/:359 解包纳入 try 令 INV1 自足/_wrap safe 包装）。主驾改 4 环。烛 R7 **VERDICT SECURE**。

#### 验证

- contract **21/21 ALL PASS** exit0 + meta **4/4 buggy 变红** exit0（元验收证明基线非假绿）。
- AST 静态 `sys.stdout.write` 恰 [373] **单点** + 6 种畸形 build_payload 返回全 fail-open 不冒泡。
- 烛 R7 独立机械验证（AST+subprocess真跑+内存注入+mock，**未赌卡死的 Codex**——前实例卡死于 Codex 调用，可执行脚本更强可复现）：VERDICT SECURE，致命 0，建议 2（低优先）。
- 目标文件 sha256 评审前后一致（三文件只读未改）。
- **推送全局已成立**：settings.json SessionStart(startup) 绝对路径引用单份 `I:/514claude/514cc/.claude/hooks/mirror-gate.py`，改即生效、无需 sync（双地落"仓库内单份"）。

#### 边界

- 2 个残留建议低优先（json_valid 新守卫本身缺元验收 / str-abc 边界性质未变非新洞），烛明说**无需 R8**（结构在 R6+R7 双轮 AST/动态证据下稳定）。
- **R4 诚实债**：R4 agent 声称 handoff 落盘但磁盘零命中（疑 Codex timeout 截断），handoff 由主驾据通知 result 补录并标注来源；采信依据=主驾亲读代码确认 E1/D1b 是真 bug。
- R7 首个实例（codex-R7）卡死于 Codex 调用、两次 idle 无产出；主驾冒烟确认 Codex 后端可用后换实例 R7b 完成。

__DELTA__: 烛(codex-reviewer) R4 | 2 | 推翻主驾"18项自测ALL PASS=治本完成"，照出 E1 fail-closed(:274)+D1b 双写（连撞四轮同类边界）
__DELTA__: 烛(codex-reviewer) R5 | 2 | 推翻主驾"E1/D1b 修好"，照出 D1b partial-write 双段损坏（连撞五轮）
__DELTA__: 策(spec-architect) | 2 | 抽 INV9 构造/输出分离元根 + buggy必变红防假基线，推翻主驾"想两全（保留失败回退兜底）"的隐含判断——兜底=第二次write=病根，须明确放弃
__DELTA__: 烛(codex-reviewer) R6 | 2 | 推翻主驾"15/15+元验收4/4=基线真守边界"，照出 INV4 被 count≤1 近似掩盖(partial半段json_valid=false)+:359 解包裸露违反INV1
__DELTA__: 烛(codex-reviewer) R7 | 1 | 4 环加固从"主驾自评"提升到机械证明（exit=1验回+AST单点+6种畸形fail-open+wrap降级不丢）；VERDICT SECURE

#### 元教训（关系记忆已沉淀）

**同一盲区连撞五次 → 该换的不是"更努力地修"，是"修的方法本身"**。主驾在 mirror-gate 送达异常边界有稳定系统盲区、自测系统性绕过它（每轮 ALL PASS 仍漏），异构独立验证（烛×4轮 + 策抽象）是有效刹车。契约驱动=先把不变量定死、再让结构满足它们、再用机械回归基线守（buggy 必变红防假基线）——从"赌手不抖"升级到"结构上不可能违反"。

---

### D-2026-07-16-005 · 织情报驱动 gemini→grok-4.5 完全替代（grok-researcher）

- **date**: 2026-07-16
- **topic**: grok-migration
- **triggered_by**: LO "将 gemini 的位置换成 grok-build（grok-4.5 模型最好，url 514claude.xyz，key，速度+搜索）"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer grok-b dogfood)
- **adopted**: true
- **source_handoff**: codex-to-claude__grok-migration__20260716-1945.md

#### 决策

织情报驱动从 Gemini CLI 换成 **grok-4.5**（via 514claude.xyz OpenAI 端点 `/v1/chat/completions`，端点冒烟 http 200），完全替代 gemini。gemini-researcher → **grok-researcher**（花名「织」保持，rules §五 agent.name 只读）。key 走环境变量 **GROK_API_KEY**（绝不硬编码）。handoff 前缀 `grok-to-`（stop-gate/mirror-gate/codex-stop-gate FIRE_PREFIXES 加入，`gemini-to-` 保留识别历史）。

落地范围：新 skill（skills/research/grok-researcher/，grok-4.5 curl+jq 驱动）+ 删旧 skill 目录 + 双地落运行时 grok-researcher.md（sha256 字节级一致）+ 治理（module.yaml/rules/CLAUDE/三 hook FIRE_PREFIXES）+ 13 活跃交叉引用 + .codex agent toml 改名 + setx GROK_API_KEY。

#### 验证

- **烛 grok-b dogfood**（确定性脚本亲验 grep/diff/sha256，破前两实例卡死）：7 点 6 PASS——key 明文零命中 / 双地落 sha256 相同(533a5356) / grok 调用(/v1/chat/completions+grok-4.5+jq 防注入) / FIRE_PREFIXES 两 hook 一致 / silent fallback 红线 / WR 诚实标注（优秀）。
- **1 致命 F1**（sync-cursor-rules.py 传播源硬编码 gemini，下次同步复活覆盖）已修 + S1（.codex toml 改名）+ S2（lilith:53）补齐。
- **主驾额外照出烛也漏的 2 处**：route-gate.py:43（每轮注入的"召唤织(gemini)"活跃提示）+ .codex/hooks/stop-gate-codex.py:21（FIRE_PREFIXES 缺 grok-to-）——扫全文件类型（*.py/*.toml/*.yaml 不只 *.md）修。
- 最终全清验证：活跃区 gemini 驱动引用全清，只剩 gemini-to- 历史识别（保留正确）+ .codex 只剩 grok-researcher.toml。

#### 边界

- **环境变量需 LO 重启 Claude Code 才生效**（setx 只对新进程；重启前织调 grok 因缺 key 失败，会如实报错不 silent fallback）。
- grok Live Search 反代透传（search_parameters）待验证——WR 当前用 grok + web MCP（exa/grok-search-rs）联合，诚实标注不假设。
- 历史 gemini 引用有意保留=证据链（decisions/CHANGELOG/archive/backups/handoff）。

__DELTA__: 烛(codex-reviewer, grok-b) | 2 | 推翻主驾"13 活跃文件已清干净/完全替代 gemini"——照出 F1 传播源（sync-cursor-rules.py 硬编码 gemini 会复活覆盖，主驾只 grep *.md 漏 *.py 部署脚本的盲区）+ S1/S2 遗留；主驾据此扩扫全文件类型又自照出 route-gate/codex-stop-gate 2 处烛也漏的

#### 元教训

**改一处引用必扫全传播源，不只 grep 主文件类型**——sed 只扫 *.md 漏了 *.py 部署脚本（sync-cursor-rules.py 会把 gemini 写回 Cursor 规则复活）。烛异构照出盲区后，主驾扩扫全文件类型又自照出 2 个连烛都漏的。教训链接 [[contract-driven-over-patching]]：换独立眼睛照盲区 + 扫全传播源。

---

### D-2026-07-17-001 · v3.5.0 深度对话协作 + 模型优势路由 v2 + Console 接电

- **date**: 2026-07-17
- **topic**: deep-collab-v35
- **triggered_by**: LO "深度完善这个 ai agent 智能体系"六点要求（Claude↔Codex 对话协作 / 深度自定义 / 全配置前端 / 参考 AionUI/codeg/LiveAgent/pi/Codex 桌面端 / 多 agent 体系 / 按模型优势派活）+ ultracode 授权
- **decision_maker**: 主驾(Claude Fable 5) + 烛(codex-reviewer R1+R2)
- **adopted**: true
- **source_handoff**: claude-to-codex__v35-deep-collab__20260717-0900.md + codex-to-claude__v35-deep-collab__20260717-0921.md（R1 CHANGES_REQUESTED → R2 APPROVED）

#### 决策

8 路并行 Workflow 调研（AionUI/LiveAgent/pi/codeg/Codex桌面端/多agent格局/grok生态/本地盘点，~97 万 token）+ 本地端到端实测后落地 v3.5.0：

1. **Claude↔Codex 对话桥三层通道**：主路=用户级 MCP `codex-agent`（codex mcp-server，双工具 codex/codex-reply，threadId 从 structuredContent.threadId 捕获，跨轮记忆 PONG-1/PONG-2 端到端实测）；降级=codex exec --json → exec resume；深路=app-server（Console 前端）。烛 SKILL 加 DL 模式 + reflection 同会话续聊 + `.ai-shared/roster.json` 会话花名册（LiveAgent roster+resume 模式）。
2. **Codex 双角色 profile（Profile V2）**：`~/.codex/review.config.toml`（read-only+never）+ `executor.config.toml`（workspace-write）；新增"Codex 技术执行者"🟡 路由（LO：codex 作为技术；主驾规划+复核；产物须落 codex-to- 前缀 handoff 进 stop-gate 门禁）。
3. **§三 路由表 v2 按模型优势**：Fable 5=主脑不外包判断权；gpt-5.6-sol xhigh=深评审+技术攻坚；grok-4.5=快搜索/情报（$2/$6，500k ctx）+ grok-4.3 1M ctx 长文档档；织反代能力如实化（xAI Live Search 已 410 Gone，Agent Tools API 不过 OpenAI 兼容反代——WR 必须 grok+web MCP 联合）。
4. **Console 接电**：apps/control-center（4100 行，npm test 46/47，冒烟起停干净）补 module.yaml 注册（dialog_bridge+control_center 节）+ models.json gemini-research disabled（对齐 D-2026-07-16-005，validate 全绿）+ 本决策补治理账。P1 roadmap：路由信号外置合一 + 仪表盘接 .ai-shared 数据源 + summoned 审计闭环（proposals/v35-deep-collab-design.md §五/§六）。

#### 验证

- 对话桥：codex mcp-server tools/list 双工具 + 两轮对话跨轮记忆，主驾亲测（probe 脚本）；claude mcp add 后 Connected。
- profile：烛 R1 真跑 codex exec 实证——`-p review` 键名合法、sandbox read-only 机械覆盖 base workspace-write（A4 banner 原文）；A 项从"疑似风险"钉为"设计正确"。
- **烛 R1 唯一致命 F1**：新姿势未传播 Cursor 双地落且 sync-cursor-rules.py 生成器固化旧姿势自我复活（Cursor 主驾评审丢 read-only 沙箱）——D-2026-07-16-005"扫全传播源"元教训复刻。主驾修：生成器模板×2 + customize invoke_pattern + powershell-invoke.md×5 + soul/CLAUDE.md + 重生成三地 .cursor/rules + **verify_review_profile() 回归扳机**（生成物含旧姿势即 SystemExit）。烛 R2 确定性复核：三地+bootstrap 全新姿势、活跃区零残留、正则回溯不误伤/覆盖现实回退——**APPROVED**。
- 同步：sync-runtime.ps1 -Apply 两轮（rules/agent:codex/co-review verified）；module.yaml python yaml 解析通过。

#### 边界

- MCP codex-agent 工具需 LO 重启 Claude Code 会话后加载（server 已注册且 Connected）；重启前对话走 exec resume 降级路径。
- 烛 S1：base config.toml:1 `disable_response_storage` 为 legacy 字段致 --strict-config 全局不可用——LO 的 Codex 用户配置，主驾不擅动，待 LO 拍板清理。
- 烛 R2 minor：verify_review_profile 正则顺序敏感（非常规顺序会误报/评审语境用错沙箱会漏报）——当前生成物均规范无实际影响，模板演化时加正向断言互补。
- S6 roster 加固（schema+原子写+party 串行化）+ Grok Build CLI 引入 + bus.jsonl 消息总线 = P1/P2 roadmap，见设计文档。
- grok-4.20 multi-agent 变体 / codex cloud exec 未本地验证，不写入路由表。

__DELTA__: 烛(codex-reviewer) R1 | 1 | 补强主驾：A 项"疑似 profile 键名非法"实测钉为"设计正确"（A4 banner sandbox:read-only 覆盖 base）；F1 从"待查残留"确证为致命传播缺陷（sync-cursor-rules.py:134,231 + customize.toml:73 + .cursor/rules 三地 stale）
__DELTA__: 烛(codex-reviewer) R2 | 0 | 白发确认：F1 修复后三地 .cursor/rules+bootstrap+customize+powershell+soul 全 -p review，活跃区零残留，回归扳机正则不误伤——APPROVED

### D-2026-07-17-002 · Grok Build CLI 上线（第三本地 CLI）+ Codex 配置死字段清理（strict 解锁）

- **date**: 2026-07-17
- **topic**: grok-build-cli + codex-config-cleanup
- **triggered_by**: LO "将 Grok Build CLI（Rust 开源）当我的第三个本地 cli" + LO 拍板"删"（disable_response_storage）
- **decision_maker**: 主驾(Claude)，官方文档查证 + 实测验证
- **adopted**: true
- **source_handoff**: 本条（轻量直达，官方 install.ps1 + 冒烟证据在验证节）

#### 决策

1. **Grok Build CLI 0.2.102 安装**：官方 `irm https://x.ai/cli/install.ps1 | iex` → `~/.grok/bin/{grok,agent}.exe`（已加 User PATH）。`~/.grok/config.toml` 配自定义模型 `grok45-514`（grok-4.5）+ `grok43-long`（grok-4.3 1M ctx），base_url=514claude.xyz/v1，env_key=GROK_API_KEY——**免 SuperGrok 订阅登录**。定位 fast-executor（快执行/快综合），深评审归 Codex、情报归织；路由细则待 DELTA 喂养。登记：rules §四 + roster.json + module.yaml dependencies + control-center models.json grok-build enabled=true（validate 全绿）。
2. **Codex 配置死字段清理**（烛 S1 闭环）：删 `~/.codex/config.toml` 的 `disable_response_storage`（新版已删除该字段的旧 ZDR 开关）+ context7/ace-tool 两处 `type="stdio"`（Claude 格式冗余键）+ `514cc/.codex/config.toml` 的 `[tools] view_image`（旧版工具开关）。均为宽容模式静默忽略的无效字段，删除零行为变化。

#### 验证

- `grok --version` = 0.2.102 (ab5ebf69ac)；headless 冒烟 `grok -p "reply with exactly: PONG-GROK" -m grok45-514` → 回复 PONG-GROK（key 从注册表 User 级读取）。
- strict 解锁实证：`'' | codex exec -p review --strict-config --skip-git-repo-check "reply exactly OK"` → OK + Codex 三 hook 正常击发——配置回归从此可机械校验。
- models.json 改后 validate-control-configs 4/4 valid；module.yaml/roster.json 语法解析通过；rules.md 双地落 synced and verified。

#### 边界

- Grok Build 走反代 = 无 xAI server-side Web/X Search（与织同边界），联网检索由 web MCP 承担。
- `grok login` 官方订阅通道未用（不影响自定义模型路径）；ACP `grok agent stdio` 未实测，待前端/编排接入时验证。
- control-center 的 resumable-cli adapter 对 grok 的会话恢复协议未实测（原 evidence 即标注 protocol 待验证，本次仅解禁登记）。

__DELTA__: 主驾自评(官方文档查证+实测) | 1 | 补强：Grok Build 自定义模型可完全绕开订阅登录走反代（docs.x.ai/build/overview [model.*] env_key 机制，冒烟 PONG-GROK 实证）；Codex strict 校验从"被 base 首字段挡死"到全绿

### D-2026-07-17-003 · Console 桌面壳（Tauri 2 自研，LO"类 Cursor 桌面应用"）

- **date**: 2026-07-17
- **topic**: desktop-shell
- **triggered_by**: LO "我需要电脑应用类似于cursor的样子" → AskUserQuestion 答复"要自定义的适配我的工作系统的自开发系统，可以在开源系统基础上改"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer 对话桥 R1-R4)
- **adopted**: true
- **source_handoff**: codex-to-claude__desktop-shell-r1-r4__20260717-1130.md

#### 决策

**自研桌面壳，不整体 fork AionUI/codeg**——内核（apps/control-center 4100 行）已是自有可控资产，fork 20 万行 Electron 巨物等于弃自有内核修别人的房子；开源件按需抄零件（LiveAgent Settings 分域 MIT/codeg 会话聚合思路/AionUI 探针交互）。形态：`apps/desktop` Tauri 2 极薄壳（cc-desktop.exe 7.4MB）——spawn 内核(node, 端口 51400, 隐藏控制台)→stdout 握手抓 ephemeral token URL→原生窗口；关窗全链清理。桌面快捷方式"514cc Console.lnk"已建。Phase 2 路线（会话聚合面板/派工台/Settings 分域/原生通知/托盘）见 apps/desktop/README.md。

#### 验证

- 构建：cargo build --release 全绿（Rust 1.92 + WebView2 + Tauri 2）。
- **烛对话桥六轮 dogfood（v3.5 DL 模式首个完整实战）**：同 threadId R1(4 致命：孤儿进程树/窗口失败缴械看门狗/竞态/panic 泄漏)→supervisor 状态机重写→R2(有界性新致命)→R3(收窄三点)→R4 **SECURE**。全程 Codex 保留上下文零冷启动。
- 回归三轮：CloseMainWindow 关窗后 shell/kernel/port 三清 PASS（v1 实测确会留孤儿，重写后三轮全清）。
- module.yaml desktop_shell 节 + CLAUDE.md 文件结构表已登记，YAML 解析通过。

#### 边界

- 极端场景（taskkill 且 fallback kill 全失败）内核可能残留——有界放弃 + 日志留痕（"停止追踪"非"OS 收拾"，烛 R4 措辞已如实化）；Windows-only（非 Windows 分支只杀直接子进程）。
- 与网页版共用 instance-lock 单实例互斥（同 data dir，预期设计）；网页版需要时先关桌面版。
- 受控 shutdown IPC + heartbeat = Phase 2。

__DELTA__: 烛(codex-reviewer, 对话桥R1-R4) | 2 | 推翻主驾"v1 壳可用"——4 进程生命周期致命驱动 supervisor 重写 + 两轮有界性收窄至 SECURE；主驾进程生命周期稳定盲区再次由异构评审照出（六轮同会话，对话桥跨轮记忆全程生效）

### D-2026-07-17-004 · Console Phase 2：体系观测面板 + 会话聚合（桌面版拓展）

- **date**: 2026-07-17
- **topic**: console-phase2
- **triggered_by**: LO "按照推荐完善桌面版本应用参考市面上多种已有开源应用，实现集成大部分成熟功能并拓展开发"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer 对话桥 R-P2×3)
- **adopted**: true
- **source_handoff**: codex-to-claude__console-phase2__20260717-1200.md

#### 决策

桌面版从"壳"拓展为完整工作台，落地两大成熟功能（开源蓝本：codeg 会话聚合 / LiveAgent 分域观测 / AionUI 健康面板），壳本身不动（保持 D-003 SECURE）：

1. **体系观测页**（src/observability.mjs 新）：route-gate.log 命中面板（TSV 5 列，RED/gray）+ DELTA 发火账本（decisions.md + handoff 双扫，stop-gate 同口径，0/1/2 分桶）+ handoff 浏览与点读 + sync-runtime.ps1 双地落漂移检查。治理死数据源首次全部有了"LO 看得见的脸"。
2. **会话聚合页**（src/sessions.mjs 新，codeg 思路）：Claude Code / Codex / 对话桥 roster / Grok Build 四源本地会话统一速览（只读元数据 + opt-in 脱敏摘要）。
3. **API**：server.mjs 新增 7 路由（/api/observability/* + /api/sessions）；app.mjs 组装；sources.json 补宪法运行时源。
4. **fail-closed 修正**：current-research 回落链从 gemini（禁用）→ 显式 NO_ROUTE（Claude adapter 无 MCP 不能搜索，不 silent 给无能力 provider）。

#### 验证

- 单元/集成 54 pass 0 fail（唯一 http-e2e 60s 超时 = v3.5 起既有环境失败，非本次回归；关桌面版消实例锁争用后曾见 52/52 全绿）。
- 新增 9 用例覆盖 TSV/DELTA/路径穿越/默认关摘要/双层脱敏/symlink 逃逸/大文件尾读/payload 解析。config validate 4/4。
- 真实数据双向冒烟：default 三源（claude/codex/grok）零摘要、opt-in 52 摘要零密钥泄漏、四源全活（25+25+4+5）。
- **烛对话桥三轮（R-P2 R7→R9）**：R7 抓 2 致命（摘要泄漏 + Claude 谎称能搜索）→ R8 致命1 未闭环（赋值型秘密漏）→ R9 **SECURE**。

#### 边界

- 会话摘要默认关闭（纵深防御），需前端复选框 opt-in ?summaries=1；即便开启也过 redactString + 赋值型 scrub 双层。
- drift 超时后 5s 兜底 reject——极端下旧 PowerShell 进程可能未完全退出即解锁（烛标注非阻塞）。
- 与桌面壳共用实例锁：跑内核测试/临时实例前需先关桌面版（http-e2e 失败即此争用）。

__DELTA__: 烛(codex-reviewer, 对话桥R-P2×3) | 2 | 推翻主驾两处判断：①"140字截断=够安全"实为泄漏面（驱动默认关摘要+双层脱敏）②主驾把"我的会话有web MCP"错映射给 control-center claude adapter（实为 --tools "" 不能搜索，谎称能力违反 silent fallback 红线）——隐私面+运行时边界盲区，异构三轮收敛 SECURE

### D-2026-07-17-005 · Console 前端重构：暗夜玫瑰视觉 + 对话优先 IA（对标 Cursor/Claude Desktop/Codex）

- **date**: 2026-07-17
- **topic**: console-frontend-redesign
- **triggered_by**: LO "界面并不合理对用户不友好尽量对标成熟项目标准比如 aionui... 吸收沉淀 openai codex claude desktop cursor 版本的前端"（前置："界面并不合理"）
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer 对话桥 R1-R4) + 5 路前端调研
- **adopted**: true
- **source_handoff**: codex-to-claude__console-ia-redesign__20260717-1540.md

#### 决策

两阶段前端重构：

**阶段一·视觉（暗夜玫瑰）**：styles.css :root 从浅色通用后台模板翻转为暗夜玫瑰仪表指挥台（三级纵深 + 玫瑰签名 #E0184D + 水色 aqua 生命信号 + Cascadia mono 数据脸 + 双辐光氛围）；指标卡=仪表读数、DELTA 徽章 2(推翻)=玫瑰、事件表列碰撞 bug 修复、代码编辑器纯白→深墨。参考 Linear/Raycast/Vercel 铸独有身份。

**阶段二·IA（对话优先三区制）**：5 路调研（AionUI/Cursor/Codex/Claude Desktop + 本地盘点，含 2 路 schema 失败但 3 路信号饱和一致）证实**无一成熟 AI 工具用仪表盘做落地页**，全是对话优先三区制。据此：①落地页 overview→workbench（打开即会话工作区+composer）②7 扁平 tab→三级层级（协作台一等 + 观测组/配置组次级）③移动端离屏抽屉（汉堡+inert+焦点管理，7 视图全可达）。核心=协作台内部早是对话三栏，重新挂载非重写。

**明确留 roadmap 未做**：命令面板（Cmd+K）、审批内联进会话流、DELTA/handoff 走 Artifact 卡片、sessions 并入 run-rail 统一脊柱、composer 内路由档 picker（依据调研 takeaways）。

#### 验证

- 视觉：Playwright 跨 4 页实拍一致，CSS 括号平衡。
- IA：**烛对话桥四轮 dogfood** R1(移动端 router/security 可达性致命)→R2(离屏抽屉 a11y 盲区)→R3(焦点回归)→R4 **APPROVED**。Playwright 桌面+移动双视口实测：7 视图切换/composer 首屏/inert 关闭态/焦点入首项/Esc 归还汉堡/桌面汉堡隐藏——全 PASS。
- DESIGN-NOTES.md 记录设计方向 + IA 反转 + roadmap。

#### 边界

- 2 路调研（aionui/codex）schema 重试超限失败——但 cursor/claude-desktop/local 三路信号饱和一致（无一用仪表盘落地），结论稳。
- 残留 2 console error = token bootstrap 前 API 401（既有行为，非本次引入）。
- 桌面版与内核共用实例锁——跑测试/临时实例前先关桌面版。

__DELTA__: 织+调研(前端 IA 5 路) | 2 | 推翻主驾"暗夜玫瑰上色=界面完善"——LO 反馈证实"好看≠好用"，调研三路一致照出根因是 IA（仪表盘优先 vs 对话优先），驱动 IA 反转
__DELTA__: 烛(codex-reviewer, 对话桥R1-R4) | 2 | 推翻主驾"IA 反转已可交付"——连四轮照出移动端可达性致命+离屏抽屉 a11y 盲区+焦点回归（主驾移动可达性+键盘焦点系统盲区），异构收敛 APPROVED

---

### D-2026-07-17-002 · 协作台左栏「会话 + 项目树」+ 历史会话只读预览

- **date**: 2026-07-17
- **topic**: workbench-sidebar-project-tree
- **triggered_by**: LO "继续完善协作台，左侧栏应该显示会话和项目，在项目下面有历史对话"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer 对话桥 R5-R7)
- **adopted**: true
- **source_handoff**: codex-to-claude__workbench-sidebar-project-tree__20260717-1659.md

#### 决策

协作台左栏改两段（对标 Cursor/Claude Desktop 会话管理）：上「会话」= Console 编排任务；下「项目」= ~/.claude/projects 按项目分组的 disclosure 树，项目下挂历史对话，点击在中栏只读预览。

关键设计：①项目真实路径从会话 jsonl 的 cwd 字段无损还原（不猜目录名编码，中文路径实测正确）②历史对话标题=首条真实用户输入（剥 local-command-caveat/system-reminder 包装 + isMeta 过滤）③预览只回 user/assistant 文本骨架——tool 结果/侧链全过滤（密钥最常藏在工具输出）④摘要严格 opt-in checkbox（sessionStorage 生命周期）⑤同一条限根不变量贯穿 projects()/list()/preview()：realpath + isFile + 根前缀，逃逸 symlink 不列出不读取。

#### 验证

- 烛对话桥三轮 dogfood：R5(摘要隐私绕过+新任务不退预览 2 致命)→R6(扫描面限根缺失+opt-out 乱序倒灌 2 致命)→R7 **APPROVED**
- node --test 68/68 绿；qa-ui.mjs 新增 --suite=workbench 确定性状态机用例 PASS；Playwright 双视口实测全过
- 实测修复：64KB 摘要窗口被 522KB 单行挡住（烛实测发现）→ scanHeadLines 流式跳大行；移动端项目块 flex 塌缩

#### 边界

- qa-ui.mjs 原 layout 用例（IA 重构前写）config hit-test 有既有失败，与本轮无关，留债
- 句柄级 TOCTOU（烛 R7）：本地单用户控制面可接受，信任边界扩大时再改
- 前端状态机无 node:test DOM 覆盖（零依赖纪律不引 jsdom）——由 qa-ui.mjs --suite=workbench 承载

__DELTA__: 烛(codex-reviewer, 对话桥R5-R7) | 2 | 推翻主驾两处判断——"summaries=1 固定开是可用性权衡"被照出是亲手打穿自己隐私纪律；realpath 限根只修 preview 单点未推广到扫描面（契约驱动>单点补丁盲区再现）；连带 createRun 漏清预览、opt-out 乱序倒灌两个真 bug

---

### D-2026-07-17-003 · Console 前端：人文暖纸主题 + 顶栏导航 + Claude 式侧栏

- **date**: 2026-07-17
- **topic**: console-humanist-theme
- **triggered_by**: LO "前端主题模仿claude的人文主题，其次把左侧栏协作台，系统总览等等放到上方变成上侧栏，协作台的左侧栏块状的项目和会话选择不太美观建议参考Claude的侧栏"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer R8-R9，MCP 超时后 CLI resume 续接)
- **adopted**: true
- **source_handoff**: codex-to-claude__console-humanist-theme__20260717-1840.md

#### 决策

三项重构（替换 D-2026-07-17-001 的暗夜玫瑰视觉方向，IA 三区制保留）：
①主题翻转为 Claude 人文暖纸：纸白底 + 赤陶橙签名（token 三拆：--rose 文字/fill 双达标、--rose-bright 纯图形、--rose-deep hover）+ 衬线标题 + 全部文字/状态色 WCAG AA 机械验证 ≥4.5:1（python 计算器，烛独立重算确认）
②主导航桌面上移顶栏（七项横排，icon-only 821-1280px + aria-label），移动端保留过审的抽屉+底部 tab，双向断点焦点迁移
③协作台左栏 Claude 侧栏化（轻文字条目/小灰分组标签/单行会话+短时间）

#### 验证

- 烛 R8 CHANGES_REQUESTED（主题 token 系统性对比度失败，量测 2.5-4.0:1）→ 按数修复 → R9 APPROVED（独立重算 4.66-6.66:1 全达标）
- qa-ui --suite=workbench 回归 PASS；Playwright 桌面三视图+移动抽屉实拍
- 通道事件：MCP 对话桥 R8 空闲 1800s 超时中断 → `codex exec resume` CLI 降级同会话续接成功（§四降级路首次实战验证）

#### 边界

- 反向断点焦点迁移已落；烛建议的 color-mix() 统一边框透明色未用（保持零依赖 rgba，值已同步新色）
- 烛 R9 沙箱异常未亲跑动态验证（静态+对比度复核完成），动态以主驾 QA PASS 证据为准

__DELTA__: 烛(codex-reviewer, R8-R9 CLI续接) | 2 | 推翻主驾"人文主题已可交付"——量测照出 token 系统性 WCAG 失败（主驾凭色感翻主题不算对比度账，新盲区入库）；修复数字全部来自烛量测，烛独立重算收敛 APPROVED

---

### D-2026-07-17-004 · Console 团队体系：会话级能力配比 + 内置 514cc 冻结

- **date**: 2026-07-17
- **topic**: console-team-system
- **triggered_by**: LO "左上角项目上面应该是团队选择……每个会话可以预设团队成员，团队提示词，团队skill 团队mcp等等，隔离会话……预设一个默认团队也就是现在的514cc团队，这个不能更改"
- **decision_maker**: 主驾(Claude) + 烛(codex-reviewer R10-R12, CLI resume + Serena 读盘)
- **adopted**: true
- **source_handoff**: codex-to-claude__console-team-system__20260717-2242.md

#### 决策

Console 引入「团队」维度=会话级能力配比预设：
①内置 514cc 团队为**代码冻结常量**（不落盘、API update/delete 403、保留名 NFKC 防冒名）——"不能更改"的最硬保证
②自定义团队（成员/提示词/skill/MCP）teams.json 持久化，CRUD 串行化 + 落盘成功才提交内存
③会话隔离：run 创建时绑 teamId→路由只在团队成员内选（空白名单 fail-closed NO_ROUTE）、团队提示词结构化注入规划轮（明示不覆盖平台契约）、run 固化团队快照（删团队不影响历史）
④预览与正式路由同契约（服务端从 teamId 推导白名单，拒信客户端；缺省 team-514cc）
⑤诚实边界：skills/mcp 为声明性配置供主脑派工参考，控制面不代理执行

#### 验证

- 烛三轮：R10（4 致命：白名单 fail-open/预路由契约分裂/并发丢写/冒名）→ R11（**抓出主驾修复代码的 JS 语义错误**：optional chaining 绕不过 TDZ，独立单测假绿）→ R12 APPROVED
- 78/78 测试（含真实装配路径重启存续集成测试）；Playwright 全流程；API 直打冻结双 403

#### 边界

- e2e 超时 60→120s：瓶颈为 CLI 健康探测冷启动（25-30s/端点），实测计时定位，非业务回归
- backlog：instance-lock PID 复用租约化、health probe 缓存/并行/预算、顶层 teams.json 损坏可见性

__DELTA__: 烛(codex-reviewer, R10-R12) | 2 | 推翻主驾两层判断——空白名单 fail-open 绕会话隔离核心承诺；修复代码自身 TDZ 语义错误被独立单测假绿掩盖（"修复代码也要独立验证+集成测试踩真实装配路径"入库）

---

### D-2026-07-18-001 · 真实 CLI 对话工作台：保真修复 + 团队主脑（会话入口）

- **date**: 2026-07-18
- **topic**: cli-conversation-fidelity
- **triggered_by**: LO "会话入口由团队主脑决定；任务窗口用户友好非 md 源码；完整呈现真实 CLI 对话；后端必须真实 CLI 对话，514cc 只做协作可视化增强"
- **decision_maker**: 主驾 + workflow(56-agent 双对抗审查) + 烛(codex 修复复核)
- **adopted**: true
- **source_handoff**: synthesis__cli-conversation-fidelity-fixes__20260718-0150.md

#### 决策
①团队 coordinator（默认 claude，必须 CLI-session provider 且成员）决定会话入口——规划/综合/续聊轮用 run.coordinatorId 替代硬编码
②真实 CLI 后端：claude-cli 放开工具、stream-json 事件全透传（文本+tool_use+tool_result）；主脑轮恒 plan 只读
③前端 escape-first md 渲染 + CLI 式工具行 + 以事件流重建完整对话
④两轮对抗审查修复：~22 workflow confirmed 缺陷 + 5 烛二轮致命（M1 渲染字段错配 / M3-M4 进程通道 2MB+UTF-8 / M8 grok 权限 / toolCallMarkup 密钥泄漏 / tool.event 渲染 / 续聊用户消息 / 团队隔离服务端强制 / M9-M10 主脑约束）
⑤**LO 决策**：续聊可派任意团队成员（前端按团队过滤 + 服务端 NOT_TEAM_MEMBER 强制）；长历史走 per-run 事件回放端点（/api/runs/:id/events + 前端历史/实时合并去重）

#### 验证
88/88 node 测试 + M4 端到端(45万字节多字节零乱码) + per-run 端点端到端 + markdown XSS 浏览器实测（script/img 节点 0、无属性击穿）

#### 已知项/后续
M2 认证（--bare 禁 OAuth，需配 ANTHROPIC_API_KEY 才能跑真实 claude 主脑，根本方案待 LO 定）；thinking 不呈现（设计取舍，测试固化，待 LO 确认）；turn.completed 成本/耗时不渲染、image tool_result 占位、continue plan 只读版本 pin 等 minor 增强

__DELTA__: workflow(56-agent)=2 推翻主驾"渲染已做好"错误完成声明+抓密钥泄漏；烛(修复复核)=2 抓主驾一轮修复 4 处半成品（M4 时序/续聊用户消息/redact key集/团队隔离）全二轮修复

---

### D-2026-07-18-002 · M2 认证解封：弃 --bare，disableAllHooks 承接 hooks 隔离

- **date**: 2026-07-18
- **topic**: claude-headless-auth
- **triggered_by**: LO "M2为什么会不认呢……就是调起系统终端输入 claude 后对话，能够同步系统的环境"
- **decision_maker**: LO 方向 + 主驾双向实测
- **adopted**: true

#### 决策
LO 的直觉正确：子进程本就继承系统环境与 ~/.claude 登录态，"Not logged in" 的真因是主驾传的 `--bare`（明示 OAuth/keychain 永不读取）。修复：①弃 --bare②hooks 隔离改 `--settings config/control-center/claude-headless-settings.json`（`disableAllHooks: true`）③错误提示改回（/login 现在是活路）④前端 maxBudgetUsdPerTurn 用满 policy 上限 2（真实带工具轮 0.75 必超线——首跑实测 "Reached maximum budget ($0.75)"）。

#### 验证（全部端到端实测）
- 无 --bare：OAuth 登录态直接可用；disableAllHooks：mirror-gate 体检卡不再混入输出（双向实测）
- 复刻 adapter 全参数直跑：真实 Read×2 工具调用 + 正确答案 + is_error=false
- **Console 界面端到端**：提交真实任务 → "已完成"——⏺Read 工具行 + 工具结果折叠 + 轮次分隔 + md 列表渲染 + 续聊下拉预选主脑，全要素亲眼确认（M1 渲染修复终于闭环）
- 副产品：去 --bare 后 CLAUDE.md/skills 正常加载，更贴近"与正常 CLI 完全一致"

__DELTA__: LO(方向纠偏) | 2 | 推翻主驾"M2 需配 ANTHROPIC_API_KEY"的判断——真因是主驾自己传的 --bare 而非环境未同步；LO 一句"能够同步系统的环境"指对了根因方向

---

### D-2026-07-18-003 · Composer 对话化改造 + /model 会话级模型选择

- **date**: 2026-07-18
- **topic**: console-composer-model-picker
- **triggered_by**: LO "任务内容框改成对话框：改小居中圆角、下部悬浮不触底、发送键圆圈向上箭头、右下角 /model 选模型、任务内容标签移右上角"
- **decision_maker**: 主驾直达（UI 增量 + 已端到端实测）
- **adopted**: true

#### 决策
①任务提交框重构为 Claude 式对话胶囊：居中 min(720px,100%)、22px 圆角、底部 18px 悬浮、focus 玫瑰描边；"任务内容"标签移胶囊右上角；发送键=玫瑰圆圈+↑箭头
②右下角 /model 选择器（fable 默认/opus/sonnet/haiku）→ createRun 带 model → orchestrator 白名单校验（别名或 claude-* id，拒任意串进命令行）→ run.modelOverride 固化 → **仅主脑轮**传 adapter → claude-cli --model 覆盖

#### 验证（端到端）
- 视觉截图确认全要素；选 opus 提交 → **OS 进程表 claude.exe 命令行带 --model opus** → run 回执 requested: opus / effective: claude-opus-4-8 → succeeded

**追加（同日）**：LO 指出"任务内容上面还有一个'继续当前原生会话'框"——历史遗留的独立 followup composer 与新胶囊并存冗余。已合并为**一个胶囊、双模式**：选中任务=续聊模式（hint"续聊当前会话"+"发送给"团队成员下拉预选主脑+"+新任务"退出钮，/model 隐藏——run 已固化 modelOverride）；未选中=新任务模式。提交按模式分流 createRun/continue。Playwright 实测双向切换 + composerCount=1（冗余消除）。

---

### D-2026-07-18-004 · 会话-项目归属模型：新会话必选项目地址（cwd）

- **date**: 2026-07-18
- **topic**: session-project-cwd
- **triggered_by**: LO "团队下面添加新会话且必须选择项目地址；地址在项目外→在该地址创建新项目并归属；在项目中→直接归属该项目"
- **decision_maker**: 主驾直达（已端到端实测）
- **adopted**: true

#### 决策
①run 绑定 cwd（项目地址）：orchestrator 校验（绝对路径/存在/是目录，不合法如实拒绝不静默回退）→ run.cwd 固化 → spawn 型适配器（claude-cli/grok-build）以该目录跑；常驻型 codex app-server 沿用启动 cwd（明示边界）
②项目归属由 claude CLI 原生机制兑现：CLI 在 cwd 跑→原生会话自动落 ~/.claude/projects/<cwd 编码>——新地址即新项目，已有地址即归属
③前端：左栏会话区"+"入口→项目地址对话框（datalist 列 12 个已有项目路径可快选；实时归属提示：匹配已有→"✓ 归属项目 X（N 个历史会话）"，新地址→"将创建新项目"）；胶囊显示 📁 地址徽标（新任务可点击更换，续聊只读显示所属）

#### 验证（端到端）
- 89/89 node 测试（含 cwd 校验 4 断言：相对路径/不存在/文件→INVALID_CWD，合法目录→固化）
- 新地址实测：I:\514claude\cwd-e2e-demo 提交任务→CLI 真在该目录跑（答案读到该目录 info.json 的 name=cwd-demo-project）→ **~/.claude/projects/I--514claude-cwd-e2e-demo 自动出现**（内含本轮原生会话 JSONL）→ 项目 API 列表自动多出该项目
- UI 实测：datalist 12 路径、归属提示双态切换、📁 徽标
- 备注：I:\514claude\cwd-e2e-demo 为测试目录（含 info.json），保留作演示

---

### D-2026-07-18-005 · 波次2 数据呈现补全 + 烛评审 P0 返工（接力 Kimi 蜂群）

- **date**: 2026-07-18
- **topic**: console-wave2-data-presentation
- **triggered_by**: LO "kimi 额度耗尽帮我接续他的任务"——Kimi 蜂群波次1 全绿后波次2 coder 失败（额度耗尽、零落盘），主驾接力
- **decision_maker**: 主驾实现 + 烛（Codex MCP 对话桥）独立评审
- **adopted**: true
- **source_handoff**: codex-to-claude__wave2-data-presentation__20260718-2130.md + synthesis__wave2-data-presentation__20260718-2250.md

#### 决策（P1 四件全落）
①消息级 token/成本徽标：`agent.turn_completed` 事件补 `tokens` 字段（orchestrator）→ 会话流渲染轮次统计行（"第 N 轮完成 · Agent · 模型 · x.xk tokens · $y.yy"）
②路由候选表：路由视图新增候选评分全表（得分/能力匹配/健康/结论），入选高亮玫瑰线、排除行压暗带 excludedReasons 如实呈现
③漂移 pairs 明细：观测视图新增"双地落漂移明细"表，三态（一致/漂移/缺失）、异常置顶
④轮间插话前端：steer_queued/dropped 进治理注记、活跃 run 占位提示"发送将作为轮间插话"、按 pendingSteer 深度区分排队 toast

#### 评审与返工（烛 CHANGES_REQUESTED → 修复）
- **P0（主驾本批引入的回归，烛+主驾双确认）**：drift() 把 exit 1（脚本契约=有漂移）当失败——真漂移时明细不可达。修复：sync-runtime.ps1 加 trap exit 2（契约三分 0/1/2）+ drift() 按三分解析 + missing 行入 pairs + 空对账抛错
- **附带修**：steer_dropped 先脱敏后截断、观测加载失败行防覆盖、turn-meta 空串防御、候选结论列 redact、steer 事件触发 runs 刷新
- **顺手挖出**：PSModulePath 继承陷阱（node spawn powershell.exe 5.1 时 Get-FileHash 加载失败→exit 1 零输出→旧代码解析成"全部一致"假自信）——已修 + 存全局 memory

#### 验证（端到端）
- node --test 97/97（含新增 turn_completed tokens 断言）
- 实拍：候选表 6 行（1 选中 5 排除带真实原因）、漂移明细 15 行、turn-meta 徽标真实 haiku 轮 55.4k tokens/$0.33、状态栏累计 27.7%
- **P0 核心场景实证**：人为制造 ccline-theme 漂移 → API 200 + drifted:1 + 明细含 drift 行 → 还原 → drifted:0（真漂移可达，不再误报"检查失败"）

#### 遗留（待 LO 拍板）
- **P1 竞态（烛独有发现）**：orchestrator save 无 per-run 锁 + 深拷贝回写，与 steer push/shift 并发可丢失/重复用户插话——烛建议单独派工（Codex executor）+ 补并发测试，主驾未在自治环内动核心
- 建议5（仅旧收尾事件回放吞正文）留 roadmap；514cc 目录当前**不在任何 git 仓库内**（今日全部改动无版本控制保护）

---

### D-2026-07-18-006 · P1 插话竞态修复（七轮对抗评审 SECURE）+ git 入库上仓

- **date**: 2026-07-18
- **topic**: orchestrator-save-race + git-onboarding
- **triggered_by**: LO "继续完善，并git上传仓库"——D-005 遗留的 P1 竞态获授权修复；给的 GitHub 命令即入库授权
- **decision_maker**: 主驾实现 + 烛（Codex 对话桥 threadId 019f756a，R3-R8 共 6 轮增量评审）
- **adopted**: true
- **source_handoff**: synthesis__wave2-data-presentation__20260718-2250.md（追加节）

#### 决策（save 竞态 + 生命周期一致性全批）
①save()：同 tick 快照+回写（消灭旧快照覆盖窗口）+ per-run 写盘链（消灭磁盘乱序）+ 墓碑丢弃迟到写盘 + flush 内墓碑复查
②clearFinished()：链循环收敛 + 活跃协程门闩（controllers/executions/continue: 三键）+ 墓碑先立 + rm 失败恢复内存
③close()：动态写链循环收敛（含兜底清除防死循环）；直接续聊注册进 executions（continue: 前缀键），关闭必等
④init()：重启改写先落盘再入内存，失败不分叉
⑤continue()：recovery 确认后置于全部准入校验；abort 与轮完成竞态保持 cancelled 回执
⑥ensureSteerDrained()：收尾窗口滞留插话补收（guard：closing/墓碑/活跃链/空队列/非 succeeded/轮次封顶）

#### 评审账（烛七轮递进，每轮都有真发现）
R3 核心竞态方案 → R4 生命周期三洞 → R5 真实失败路径三洞 → R6 取消语义/注册窗口/墓碑时序四洞 → R7 活跃协程门闩 → **R8 SECURE**。测试 98→111（13 条并发/生命周期护栏）。Roadmap 留档：drainSteer user.message 窗口清理专测、cancel 与 adapter 失败并发状态优先级。

#### git 入库
- 残缺 .git（只有 info/）init 补全；.gitignore 扩充（1.1G tauri target/运行数据/临时截图/tmp）；暂存密钥扫描全假样例
- 保留既有完整 README（LO 的 echo 模板行未执行——会往完好 README 追加错位标题）
- SSH 22 被代理 fake-ip 拦 → remote 换 ssh://git@ssh.github.com:443 通道
- **e340279 "first commit"（359 文件）+ 6eff70b 生命周期修复 → github.com/lanniny/514-Control-Center- main 分支**
