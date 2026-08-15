# 多 CLI 执行 Adapter 接入评估（opencode / openclaw / hermes / CodeBuddy / cursor）

> 日期：2026-08-02 · 触发：LO「正常应该只有 cli 后端处理工具……opencode openclaw hermes CodeBuddy cursor」
> 立场：**未通过本机验证的 CLI 不伪装成可执行席位**（index.html runtime-seat-integration-boundary 既有纪律）。本文档是接入前置评估，不是接入承诺。

## 一、现状矩阵（实证）

| CLI | Provider/连接 | 会话源 | 执行 Adapter | 本机安装 | 结论 |
|---|---|---|---|---|---|
| Claude Code | ✓ claude | ✓ | ✓ claude-stream-json | ✓ | 已接入 |
| Codex | ✓ codex | ✓ | ✓ codex-app-server（+exec-json 回退） | ✓ | 已接入 |
| Grok Build | ✓ grokbuild | ✓ | ✓ grok-build-headless | ✓ | 已接入 |
| Kimi Code | cli-managed | ✓ | ✓ kimi-headless-resume | ✓ | 已接入 |
| Pi | adapter-managed | ✓ | ✓ pi-rpc | ✓ | 已接入 |
| Gemini CLI | ✓ gemini | ✓ | ✓ gemini-stream-json（席位已禁用，模板保留） | ✓ | 已接入但席位停用 |
| Grok Search | — | — | MCP 通道（transport=mcp） | — | **非 CLI 执行后端**；2026-08-02 起 selectable:false，仅供内置 grok-search 固定绑定 |
| OpenCode | ✓ opencode | ✓ | ✗ | ✗（which 实测） | Provider/会话已进体系，执行待接入 |
| OpenClaw | ✓ openclaw | ✓ | ✗ | ✗（which 实测） | 同上 |
| Hermes | ✓ hermes | ✓ | ✗ | ✗（which 实测） | 同上 |
| CodeBuddy | ✗ | ✗ | ✗ | ✗（which 实测） | 完全未进体系 |
| Cursor（cursor-agent） | ✗ | 读侧（sessions 读取源） | ✗ | ✗（/f/cursor 是编辑器二进制，非 cursor-agent） | 执行体系未接入 |

## 二、逐 CLI 协议调研（公开资料，已注明出处）

### OpenCode（anomalyco/opencode）
- headless：`opencode run [message..]`（v1.4+ 引入 run 子命令取代旧 `-p`），`--model <provider/model>`、`--dir <path>`、`-c/--continue` 续会话。出处：[opencode.ai/docs/cli](https://opencode.ai/docs/cli/)、[SWE-AF#45（v1.4 旗标变迁实证）](https://github.com/Agent-Field/SWE-AF/issues/45)。
- 风险点：权限模型 `external_directory: ask` 兜底规则在 headless 下会阻塞（[opencode#20864](https://github.com/anomalyco/opencode/issues/20864) 请求 --yolo）；席位 permissionModes 映射需实测。
- Adapter 形态：`local-cli` / argv / stream-json 输出（需 `opencode run --output-format` 实测确认格式）。

### Cursor（cursor-agent）
- headless：`cursor-agent -p "<prompt>"` + `--output-format stream-json` + `--force`（写盘）+ `--model`。出处：[cursor.com/docs/cli/headless](https://cursor.com/docs/cli/headless)、[nimbalyst#513](https://github.com/Nimbalyst/nimbalyst/issues/513)。
- 风险点：社区实证 headless 有怪癖——进程不释放终端（[forum#133624](https://forum.cursor.com/t/cursor-cli-headless-mode-does-not-release-the-terminal/133624)）、首连 10-15s 静默（[forum#150246](https://forum.cursor.com/t/cursor-agent-p-print-headless-mode-hangs-indefinitely-and-never-returns/150246)）；`ls` 等子命令忽略 headless 旗标（[forum#151821](https://forum.cursor.com/t/cli-headless-doesnt-work-with-ls-no-way-to-get-a-list-of-chat-ids/151821)）。Adapter 需进程超时/输出哨兵兜底。
- 安装：`curl https://cursor.com/install -fsS | bash`（Windows 需另核）；CURSOR_API_KEY 或登录态。

### OpenClaw / Hermes
- 514cc 既有边界注记：`运行 ACP Adapter 尚未通过本机验证`——预定路径是 ACP（Agent Client Protocol）Adapter，与 Gemini 的 ACP 生态同源。
- 二者为 pi-mono 生态工具，协议细节以本机安装后 `--help` / ACP 握手实测为准，本文档不预断。

### CodeBuddy（腾讯）
- 公开 headless/CLI 资料有限，未找到可引用的非交互协议文档；且 Provider/会话体系均未覆盖。
- 建议最后处理：先确认是否提供 CLI 与 headless 模式，再评估。

## 三、Adapter 实现路径（参照既有冻结面）

新增任一 CLI 的执行 Adapter 固定四步（对齐 kimi-cli.mjs / gemini-cli.mjs 的 argv-headless 形态）：

1. `src/adapters/<cli>.mjs`：spawn 契约（argv 构造、stream 解析、事件归一化到 eventStore、权限模式映射、进程超时与哨兵）。
2. `src/adapters/manifest.mjs`：模板条目（factoryKey、permissionModes、routingDefaults、commandHelp、controlNotes 如实标注验证状态）；能力包络已取消，特殊通道约束只写入带原因的路由规则。
3. `src/adapters/index.mjs`：factoryEntries 注册（受 unusedFactories / unknown factory 双向守卫）。
4. **本机验证**：CLI 安装 → `--version` 冒烟 → 单轮 headless 实测 → 席位创建 → 团队编排真跑一轮。未完成前 controlNotes 必须写"未经本机验证"，席位 teamMemberEligible 置 false。

## 四、建议落地顺序

1. **OpenCode**（headless 文档完整、Provider/会话已在体系内、社区 CI 用例成熟）。
2. **Cursor cursor-agent**（文档完整但有进程释放怪癖，需超时兜底设计）。
3. **OpenClaw / Hermes**（ACP 路径，与生态路线绑定）。
4. **CodeBuddy**（资料稀缺，先侦察再决策）。

## 五、本波已完成的相邻修正（2026-08-02）

- Grok Search MCP 模板 selectable:false——MCP 通道不再混入新建席位下拉；内置 grok-search 席位固定绑定不受影响（resolveAdapterTemplate 对 fixedBinding 放行）。
- adapterTemplateCatalog 全量返回（含 selectable 字段），服务端写路径 selectable 校验不破。
- 席位编辑器：职责不再预填 team-executor（空默认 + datalist 建议）；绑定成员区块 + 删除前置点名；列表品牌徽标。
