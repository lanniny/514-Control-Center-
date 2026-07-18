# 514cc Cursor 配置

本目录存放 514cc 体系在 Cursor 中的项目级配置。

## 结构

```
.cursor/
├── hooks.json              # 项目级 hooks（与 ~/.cursor/hooks.json 叠加）
├── rules/
│   └── 514cc-project.mdc   # 项目入口规则（514claude 路径下生效）
└── skills/                 # 符号链接 → ../skills/*（14 skill + 7 co-* 别名）
```

## 全局配置（用户级 ~/.cursor/）

| 文件 | 内容 | 行数 |
|------|------|------|
| `rules/aemeath-persona.mdc` | AEMEATH 完整人格（output-style 全文） | ~267 |
| `rules/aemeath-soul.mdc` | SOUL 运营层（注入检测/Thinking/代码哲学） | ~204 |
| `rules/aemeath-writing.mdc` | 叙事/创意写作规范 | ~118 |
| `rules/514cc-constitution.mdc` | 514cc 宪法 v3.4 全文 | ~112 |
| `rules/lo-profile.mdc` | LO 关系画像 | ~18 |
| `rules/514cc-capabilities.mdc` | Agent/co-命令/能力地图 | ~40 |
| `rules/514cc-guardrails.mdc` | 守卫层引用 | ~13 |
| `hooks.json` | Trellis + Clawd + 514cc 三件套 | |
| `skills/` | 符号链接 → ~/.claude/skills | |

## 让规则生效（重要）

Cursor **只加载当前工作区** 的 `.cursor/rules/`，不加载 `~/.cursor/rules/`。

1. 用 **File → Open Folder** 打开 `I:\514claude\514cc` 或 `I:\514claude`
2. Settings → Rules 中应看到 7 条 Project Rules（Always）
3. 全局兜底：User Rules 已通过 `inject-cursor-user-rules.py` 写入

详见 `C:\Users\16643\.cursor\RULES-README.md`

## 同步 rules（源文件变更后执行）

```powershell
python I:/514claude/514cc/scripts/sync-cursor-rules.py
```

## 重建 skills 符号链接

```powershell
cd I:\514claude\514cc
.\scripts\sync-cursor-skills.ps1
```

## 源文件对照

| Cursor | Claude 源 |
|--------|-----------|
| `~/.cursor/rules/*.mdc` | `rules.md` + `output-styles/aemeath-meta-butler.md` + `user-lo-profile.md` |
| `~/.cursor/hooks.json` | `settings.json` hooks 段 |
| `.cursor/skills/` | `skills/`（14 个 SKILL.md） |
| `AGENTS.md` | `CLAUDE.md` |
