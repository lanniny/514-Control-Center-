# .ai-shared/ — 三方 AI 协作共享区

本目录是 **Claude Code / Codex CLI / grok-4.5** 三方智能体的"公共白板"。

## 目录约定

| 路径 | 用途 | 谁会写 | 谁会读 |
|---|---|---|---|
| `context.md` | 当前任务的活跃上下文 | Claude 主驾 | 三方都读 |
| `decisions.md` | 已做的关键决策（追加式） | Claude 主驾 | 三方都读 |
| `handoff/` | CLI 之间的产物交接 | 子代理 | 编排方 Claude |
| `logs/` | 协作过程的运行日志（debug 用） | 钩子/脚本 | 调试时 |

## 全局规约

本目录的协作规则**继承自** 514cc 体系宪法 `rules.md`（v3.0）。
本项目的特定补充（如有）写在本目录的 `shared-rules.md`（默认不存在）。

## 工作流原则

1. 写入权由 Claude 主驾把守；Codex/Gemini 仅产出到 `handoff/`
2. 新任务先读 `context.md` 和 `decisions.md`
3. 完成任务追加到 `decisions.md`，不删除历史
4. 日期一律绝对化（YYYY-MM-DD）

## Handoff 文件命名

`{from}-to-{to}__{topic}__{YYYYMMDD-HHmm}.md`

例：`codex-to-claude__react-app-review__20260521-1530.md`

## 维护

由 `/co-init` 命令从 `skills/utility/init/templates/` 复制创建。
