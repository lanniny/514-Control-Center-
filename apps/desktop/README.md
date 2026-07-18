# 514cc Console Desktop（Tauri 2 壳）

> LO 拍板（2026-07-17）：不整体 fork AionUI/codeg，**在自有 control-center 内核上自研桌面应用**，开源件按需抄零件。
> 壳保持极薄：UI 全部由 `apps/control-center` Web 面板提供，壳只管进程生命周期 + 原生窗口。

## 形态

```
514cc Console.exe（Tauri 2，~10MB）
  ├─ 启动：spawn node apps/control-center/server.mjs（端口 51400，CREATE_NO_WINDOW 隐藏控制台）
  ├─ 从内核 stdout 捕获带 ephemeral token 的 URL → 原生窗口导航（无地址栏，任务栏独立图标）
  ├─ 看门狗：30s 拿不到 URL（端口冲突/instance-lock/崩溃）→ 退出不悬挂
  └─ 退出：杀内核子进程
```

## 构建与运行

```powershell
cd apps/desktop/src-tauri
cargo build --release          # 产物 target/release/cc-desktop.exe
.\target\release\cc-desktop.exe
```

- 依赖：Rust toolchain + WebView2（Win11 自带）+ node（内核）。
- 仓库根默认 `I:\514claude\514cc`，迁移时用环境变量 `CC_ROOT` 覆盖。
- 图标源：`icons/`（gen_icon.py 生成，黑底玫瑰红 514，呼应暗夜玫瑰主题）。

## Phase 2+ 路线（视 LO 优先级）

1. **会话聚合面板**（codeg 思路）：解析 `~/.claude/projects/*.jsonl`、`~/.codex/sessions`、`.ai-shared/roster.json`，Console 里统一看三家 CLI 的历史会话与对话桥线程。
2. **派工台**：从 Console 直接派活给 Codex（对话桥）/ Grok Build（headless -p），审批经现有 approval-broker。
3. **Settings 分域全配置**（LiveAgent 蓝本）：providers/agents/hooks/customize TOML/output-style 分域编辑，接 config validate→plan→apply→rollback 管线。
4. **原生通知**：审批请求 / 长任务完成（发火收尾）走系统通知；系统托盘常驻。
5. **仪表盘接 .ai-shared 数据源**：route-gate.log / DELTA 账本 / handoff / 双地落漂移（v35 设计文档 §五 P1 项）。
6. **打包分发**：bundle.active=true 出安装包（当前 dev 形态直接跑 exe 即可）。
