# Codex PowerShell 调用细节

> 这是 codex-reviewer subagent 的 **Resource Layer 3 文档**。
> 主体 SOP 见 `~/.claude/agents/codex-reviewer.md`。需要深入 PowerShell 调用细节时按需 Read 本文件。

## 黄金法则

```powershell
# ✅ 正确：管道关 stdin
$out = '' | codex exec -p review --skip-git-repo-check $prompt 2>&1 | Out-String

# ❌ 错误：直接调用 → PowerShell 下 stdin 永不 EOF → 永久卡死
$out = codex exec -p review --skip-git-repo-check $prompt
```

## 短 prompt 调用（< 2KB）

```powershell
$prompt = "请评审以下代码: ... [代码片段]"
$out = '' | codex exec -p review --skip-git-repo-check $prompt 2>&1 | Out-String

# 提取评审内容（去除 codex 元信息日志）
$reviewBody = ($out -split "codex`n" | Select-Object -Last 1) -split "tokens used" | Select-Object -First 1
```

## 长 prompt 调用（≥ 2KB，推荐 — 任务卡走文件路径）

```powershell
# 1. 先把详细任务卡写到 handoff/
$taskCardRel = ".ai-shared/handoff/claude-to-codex__$topic__$ts.md"
# (Claude 主驾用 Write 工具落任务卡到 $taskCardRel)

# 2. 用短指令告诉 codex 去读
$cmd = "请阅读文件 '$taskCardRel' 作为完整任务卡，按其中要求完成评审，并将结果以 markdown 形式打印到 stdout。"
$out = '' | codex exec -p review --skip-git-repo-check $cmd 2>&1 | Out-String
```

## Token 提取

Codex stdout 在尾部有 `tokens used N` 行，可正则解析：

```powershell
if($out -match 'tokens used\s+([\d,]+)'){
    $tokens = [int]($Matches[1] -replace ',', '')
} else {
    $tokens = $null
}
```

把 `$tokens` 写入 handoff 头部 `总 token: $tokens` 字段，供 `usage-summary.ps1` 后续扫描。

## 命令行参数

| 参数 | 含义 | 何时用 |
|---|---|---|
| `--skip-git-repo-check` | 跳过 git 仓库检查 | 项目不是 git 仓库时（必加，否则报错）|
| `--config <k>=<v>` | 覆盖 config.toml 字段 | 临时调试，例如改 `model_reasoning_effort` |
| `--model <name>` | 指定模型 | 主人 `~/.codex/config.toml` 默认 `gpt-5.5`，特殊场景可临时换 |

## 失败兜底

```powershell
# 网关 504 / 401
if($out -match 'Gateway Timeout|Invalid token|unauthorized'){
    # 不要重试 — 几乎都是反代或 key 问题
    # 报告给主驾 + 落 handoff/codex-error__*.md
    return @{ success=$false; reason='gateway' }
}

# stdin 卡死征兆（CPU idle + 长时间无输出）
# 已用 '' | 前缀防御，理论不该出现，若出现说明 codex 版本变更，需要重新摸 stdin 行为

# Codex 输出格式不符合预期
if(-not ($out -match '## 致命问题')){
    # 第一次重试：在 prompt 里加更强约束
    # 第二次失败：原样上报主驾
}
```

## 调试技巧

```powershell
# 看 codex 详细日志（DEBUG 级）
$env:RUST_LOG = "codex=info"
$out = '' | codex exec -p review --skip-git-repo-check $prompt 2>&1 | Out-String

# 看 codex 进程是否真在跑（CPU idle 表示卡住）
Get-Process codex | Select-Object Id, CPU, @{n='RT';e={(Get-Date)-$_.StartTime}}
```

## 相关 resource

- [`output-format.md`](./output-format.md) — handoff 文件格式 + VERDICT 协议
- [`reflection-mode.md`](./reflection-mode.md) — 迭代评审循环
- [`error-handling.md`](./error-handling.md) — 错误处理细节
