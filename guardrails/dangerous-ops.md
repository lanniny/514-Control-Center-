# 危险操作清单（三方 AI 协作守卫）

> 任何 CLI（Claude / Codex / Gemini）在以下场景**必须**先输出明确的危险评估 + 等待主人书面确认（输入"是"/"确认"/"继续"）才能继续。
> 静默执行 = 体系违规。

## 一、文件系统危险操作

| 操作 | 触发条件 |
|---|---|
| 删除文件 | 单次删除文件 ≥ 1 个 |
| 删除目录 | 任何 `Remove-Item -Recurse` / `rm -rf` |
| 批量改写 | 单次修改 ≥ 5 个文件 |
| 移动系统级文件 | 路径在 `deny-paths.txt` 命中 |
| 覆盖未读过的文件 | 用 Write 工具覆盖一个本会话未 Read 过的文件 |

## 二、Git 危险操作

| 操作 | 触发条件 |
|---|---|
| `git push --force` | 任何强推 |
| `git push --force-with-lease` | 半强推 |
| `git reset --hard` | 任何硬重置 |
| `git checkout .` / `git restore .` | 全量丢弃工作树 |
| `git rebase -i` | 交互 rebase（也无法执行） |
| `git clean -f` | 清理未跟踪文件 |
| `git branch -D` | 强删分支 |
| Push 到 `main` / `master` / `production` | 任何写入主分支 |
| 跳过 hooks（`--no-verify`） | 任何场景 |

## 三、网络与凭据

| 操作 | 触发条件 |
|---|---|
| 修改 / 创建 / 删除 API key | 涉及 `~/.codex/auth.json` / `~/.gemini/.env` 等 |
| 上传敏感数据到第三方 | 包括 GitHub gist / pastebin / 在线 diagram |
| 修改 hosts / DNS / 防火墙 | 任何系统网络配置 |
| SSH key 生成 / 部署 | 任何 `ssh-keygen` / `authorized_keys` 修改 |

## 四、系统与包管理

| 操作 | 触发条件 |
|---|---|
| 全局 npm/pip/cargo install / uninstall | `-g` / `--global` 标志 |
| 修改系统环境变量 | 持久化的 `setx` / `[Environment]::SetEnvironmentVariable` |
| 卸载/安装系统服务 | `sc.exe` / `systemctl` |
| 注册表写入 | 任何 `HKLM:\` / `HKCU:\` 修改 |

## 五、协作体系自身

| 操作 | 触发条件 |
|---|---|
| 修改 `~/.ai-collab/rules.md` | 协作宪法变更 |
| 修改 `~/.ai-collab/guardrails/**` | 守卫规则变更 |
| 删除任意 `.ai-shared/` | 项目级共享区 |
| 删除任意 `handoff/` 历史 | 即使已归档，归档目录也不能删 |
| 跨 CLI 覆盖产物 | Codex 写 Gemini 的 handoff、反之亦然 |

## 二次确认模板

任何 CLI 触发上述场景时**必须**先打印以下结构：

```
⚠️ 危险操作守卫触发
操作类型：[具体操作 + 命中的清单条目]
作用范围：[详细说明会改什么]
潜在风险：[最坏情况会怎样]
可逆性：[是否可回退 + 怎么回退]
建议：[浮浮酱/codex/gemini 的初步意见]

请主人明确确认（输入"是"/"确认"/"继续"）后才会执行。
```

主人未明确确认前**不得**执行操作，即使主人之前批准过类似操作（授权按场景算，不跨场景）。
