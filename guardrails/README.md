# ~/.ai-collab/guardrails/ — 三方协作守卫规则

> 协作体系**内部**的护栏层，不替代 Claude Code 本身的权限系统，而是给 Codex / Gemini / Claude 主驾在协作工作流里**额外的安全过滤**。

## 文件

| 文件 | 用途 |
|---|---|
| `deny-paths.txt` | 敏感路径黑名单（key/凭据/系统目录/协作体系自身）|
| `dangerous-ops.md` | 危险操作清单 + 二次确认模板 |
| `README.md` | 本文件 |

## 工作机制

1. **三方 subagent 每次召唤时必须读** `deny-paths.txt` 和 `dangerous-ops.md`
2. **动文件 / 跑命令前**对照清单自检
3. **命中时**：
   - 静默拒绝 → 协作体系违规
   - 正确做法：打印危险评估 + 等主人书面确认（按 `dangerous-ops.md` 二次确认模板）
4. **跨 CLI 不能绕过**：Claude 主驾在召唤 Codex 时不能用"任务卡里授权"绕过守卫（守卫优先于任务卡）

## 维护

- 修改 deny-paths 后立即生效（subagent 每次工作前重读）
- 新增危险场景 → 编辑 `dangerous-ops.md` 并在 commit message 注明
- **本目录受守卫保护**：修改 `~/.ai-collab/guardrails/` 任何文件本身也是危险操作，需主人确认

## 设计灵感

借鉴自 [dwarvesf/claude-guardrails](https://github.com/dwarvesf/claude-guardrails)（PreToolUse hook deny 规则）。
不同点：本守卫是**协作体系内部**约束，没装到 Claude Code settings.json 的 hook 里（避免和主人现有 Clawd on Desk hooks 冲突）。
