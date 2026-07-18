# 514cc 状态栏（ccline / CCometixLine）

> 514cc 体系"看得见的脸"——Claude Code 底部状态栏，**暗夜玫瑰**主题。

## 是什么

[ccline (CCometixLine)](https://github.com/Haleclipse/CCometixLine) 是 Rust 写的高性能 Claude Code 状态栏工具（v1.1.2）。514cc 为它定制了 **暗夜玫瑰** 主题（配色渊源自初版人格 lilith-yandere 的调色板；体系当前人格见 `output-styles/`，状态栏 output_style 段实时显示）。

## 渲染效果

```
  <model>  󰉋 514cc  󰊢 main ✓   42%  󱋵 <current-output-style> 
```

纯黑底 + 红瞳红（#E0184D）强调 + 暗玫瑰过渡。精简为 5 个 segment：模型 / 目录 / Git / 上下文窗口 / 输出样式（关掉了 usage/cost/session，去拥挤 + 去 API 依赖）。

## 配色

| segment | 文字色 | 背景 |
|---------|--------|------|
| 模型（粗体） | 红瞳红 `224,24,77` | `12,12,16` |
| 目录 | 暗玫瑰 `199,125,160` | `18,14,18` |
| Git | 柔粉 `229,156,196` | `14,11,15` |
| 上下文 | 灰玫瑰 `154,106,130` | `20,15,19` |
| 输出样式（粗体） | 红瞳红 `224,24,77` | `12,12,16` |

## 安装 / 同步（双地落）

主题源在仓库 `statusline/514cc.toml`，同步到运行时：

```powershell
# 主题预设
Copy-Item statusline/514cc.toml ~/.claude/ccline/themes/514cc.toml -Force
# 生效配置
Copy-Item statusline/514cc.toml ~/.claude/ccline/config.toml -Force
# 或用 ccline 切换
ccline --theme 514cc
```

statusLine 已在 Claude Code settings 配置：`{"type":"command","command":"~/.claude/ccline/ccline"}`。

## 字体要求

图标需终端安装 **Nerd Font**（FiraCode / JetBrains Mono Nerd Font 等，见 [nerdfonts.com](https://www.nerdfonts.com/)）。

> ⚠️ **若图标显示为方块** `□`：把 `~/.claude/ccline/config.toml` 的 `[style].mode` 改为 `"plain"`，改用 emoji 图标（📁🌿⚡🎯）兜底——主题已双填，无需重配。

## 回退

```powershell
Copy-Item ~/.claude/ccline/config.toml.bak-20260601 ~/.claude/ccline/config.toml -Force
```

或 `ccline --theme <内置主题>`（cometix/nord/gruvbox/powerline-tokyo-night 等）。

## 能力边界（诚实记录）

ccline 只支持 8 种**预定义** segment，**不支持自定义文本** —— 状态栏无法直接显示体系版本 / DELTA 覆盖 / 路由门状态。`output_style` 段显示当前生效的 output-style 名（实时，无需文档复述）。要显更多体系信息需 wrapper 脚本包装 ccline（成本高，本期未实现）。
