<!--
将以下内容插入项目级 CLAUDE.md 的合适位置（通常在"AI 使用指引"或"项目概览"之后）。
由 /co-init 自动插入；手动启用时主人复制粘贴即可。
-->

## 多 AI 协作模式

本项目接入 **Claude Code / Codex CLI / grok-4.5** 三方协作体系（Claude 强主导）：

- Claude Code = 总指挥（编排 / 文件操作 / MCP 调度）
- Codex CLI   = 评审官（深推理 / second opinion / 沙箱执行）
- grok-4.5  = 情报官（长文档 / 多模态 / Web 检索）

**全局宪法**：[`~/.ai-collab/rules.md`](~/.ai-collab/rules.md) — 三方共同遵守
**项目共享区**：[`./.ai-shared/`](./.ai-shared/) — 当前任务上下文与产物交接
**召唤方式**：
- `Agent({subagent_type: "codex-reviewer", ...})` 或 `/co-review <file>`
- `Agent({subagent_type: "grok-researcher", ...})` 或 `/co-research <topic>`

@~/.ai-collab/rules.md
