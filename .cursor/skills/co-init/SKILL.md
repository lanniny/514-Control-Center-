---
name: init
description: "在当前项目目录初始化协作体系——创建 .ai-shared/ 结构，个性化 context.md，落项目级锚点文件。"
---

# Init — 项目初始化

> 让任何项目在 30 秒内接入协作体系。

## 流程

### Step 1：检查前置条件
确认 `<PROJ>` = 当前工作目录。
`.ai-shared/` 已存在？→ 无 `--force` 则询问 / 有 `--force` 则备份后覆盖。

### Step 2：复制模板
从 `{skill-root}/templates/` 复制 `.ai-shared/` 基础结构：
- `context.md`（项目上下文）
- `decisions.md`（决策记录）
- `handoff/`（交接目录）

### Step 3：个性化
- 项目名 → 目录名
- 工作目录 → 绝对路径
- 技术栈 → 通过 Glob 探测（package.json/pyproject.toml/Cargo.toml/go.mod 等）
- 时间戳 → 当前绝对时间

### Step 4：报告
输出创建的文件清单 + 下一步命令建议。

## 参数

- `--force` 覆盖已存在的 .ai-shared/
- `--minimal` 只落 .ai-shared/，不动其他文件
- `--dry-run` 只打印不执行

## 约束

不修改全局模板。不写入项目外路径。拒绝系统根目录。
