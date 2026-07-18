# Codex 错误处理速查

> Resource Layer 3。主体 SOP 见 `~/.claude/agents/codex-reviewer.md`。

## 错误分类与处理

### 1. PowerShell stdin 卡死

**征兆**：调用 `codex exec` 后 60s+ 无输出，进程 CPU ≈ 0

**原因**：忘记加 `'' |` 管道关 stdin

**处理**：
1. `Stop-Process -Name codex -Force` 杀进程
2. 重新调用，确保 `'' | codex exec ...`

### 2. 反代网关 401

**征兆**：`Invalid token` / `unauthorized`

**原因**：`~/.codex/auth.json` 的 OPENAI_API_KEY 失效（micu 反代 key 过期）

**处理**：
1. 用带 `Authorization: Bearer` 的 PowerShell 自检：
   ```powershell
   $h = @{ "Authorization" = "Bearer $((Get-Content ~/.codex/auth.json | ConvertFrom-Json).OPENAI_API_KEY)" }
   Invoke-WebRequest "https://www.micuapi.ai/v1/models" -Headers $h -SkipHttpErrorCheck
   ```
2. 若仍 401 → 主人去 micu 后台拿新 key → 写回 `~/.codex/auth.json`
3. 落 `handoff/codex-error__auth__*.md` 告知主人

### 3. 反代网关 504 / Gateway Timeout

**征兆**：返回 HTML 含 `Cloudflare` `504`

**原因**：单次请求过大（prompt > 50KB）或 micu 反代上游慢

**处理**：
1. 不要重试（重试也是 504）
2. 拆短 prompt（任务卡走文件路径而非内联）
3. 落 `handoff/codex-error__gateway-504__*.md`

### 4. 模型不存在

**征兆**：`model 'xxx' not found`

**原因**：`~/.codex/config.toml` 的 `model = xxx` 在反代实际不支持

**处理**：
1. 用 `Authorization` 头 ping `/v1/models` 看可用列表
2. 选最接近的 → 临时用 `--config model=...` 覆盖
3. 提醒主人考虑更新 config.toml

### 5. Skill 加载失败警告

**征兆**：stderr 含 `failed to load skill ... invalid description`

**原因**：某 SKILL.md 的 description 超过 1024 字符

**处理**：
- **不影响主流程**，忽略即可
- 后台记一笔，下次主人有空时建议修复对应 skill 文件

### 6. Codex 输出不含 `## 致命问题` 章节

**征兆**：Codex 自由发挥，没按四节格式

**处理**：
1. **第 1 次重试**：prompt 里加更强约束（"必须严格按以下 4 个 markdown 二级标题输出，不得增减或合并"）
2. **第 2 次失败**：原样落到 handoff + 在浮浮酱备注里诚实说明"格式偏离"
3. **不要**自己改写 codex 输出强行套格式（会丢失信息）

### 7. 主人中途叫停

**征兆**：Ctrl+C 或主人在对话里说"停"

**处理**：
1. 立即 `Stop-Process` codex
2. 把已经收到的部分输出保存到 `handoff/codex-to-claude__{topic}__INTERRUPTED__{ts}.md`
3. 在 handoff 头部标 `__VERDICT__: INTERRUPTED_BY_USER`

## 通用兜底

任何无法分类的错误：
1. 落 `handoff/codex-error__unknown__{ts}.md`，附上完整 stderr 前 2KB
2. 报告给主驾："Codex 返回未知错误，已落 handoff，请主人查看"
3. **不要**自动重试（避免成本失控）

## 相关 resource

- [`powershell-invoke.md`](./powershell-invoke.md) — 正确调用姿势
- [`output-format.md`](./output-format.md) — 期望输出结构
