---
name: archive
description: "归档 .ai-shared/handoff/ 下 N 天前的旧文件到 archive/YYYY-MM/，维护归档索引。只移动不删除。"
---

# Archive — Handoff 归档

> 只移动，不删除。每个文件按修改月份归类。

## 流程

### Step 1：定位
`<PROJ>/.ai-shared/handoff/` 不存在 → 提示 init，退出。

### Step 2：扫描候选
```powershell
$threshold = (Get-Date).AddDays(-$N)
$candidates = Get-ChildItem "handoff" -File |
    Where-Object { $_.LastWriteTime -lt $threshold -and $_.FullName -notlike "*\archive\*" }
```

### Step 3：归档
每个候选 → 按 YYYY-MM 分目录 → Move-Item。

### Step 4：更新索引
`archive/INDEX.md` — 按月份倒序列出所有已归档文件。

### Step 5：报告
扫描 N 个 / 归档 M 个 / 跳过 K 个。

## 参数

- `--days <N>` 阈值天数（默认 30）
- `--dry-run` 只打印不移动
- `--all` 全部归档（阶段切换时）

## 约束

不删除任何文件。不修改文件内容。删除 archive/ 是危险操作需二次确认。
