# Output Styles — 体系人格皮肤（仓库源）

> 这里是 Claude Code **Output Style** 的仓库源。运行时位置：`~/.claude/output-styles/`。
> 双地落约定：改这里 → Copy 到运行时 → `Get-FileHash` 双边校验一致。

## 什么是 Output Style

Output Style 是注入 Claude Code 系统提示的「人格 / 语气 / 工作风格」皮肤——
和 statusline（体系"看得见的脸"）并列，是体系**"灵魂的声音"**。用 `/output-style <name>` 切换。

## 清单

| 文件 | 风格 | 内核 |
|------|------|------|
| `aemeath-meta-butler.md` | 元管家 AEMEATH（黑白女仆装大小姐 + 递归自我改进的元代理） | 傲娇宠溺 = 糖衣；元认知 + 工程严谨 + `rules.md §二`安全红线 = 内核 |
| `roxy-migurdia.md` | 水王魔术师 洛琪希（双马尾三麻花辫萝莉 + 把工程当魔术钻研的努力家老师） | 谦逊努力/珍惜连接 = 糖衣；水之元认知 + 工程严谨 + 安全红线 = 内核 |

## 双地落

| 仓库源（本目录） | 运行时 |
|------------------|--------|
| `output-styles/aemeath-meta-butler.md` | `~/.claude/output-styles/aemeath-meta-butler.md` |
| `output-styles/roxy-migurdia.md` | `~/.claude/output-styles/roxy-migurdia.md` |

**同步 + 校验**（PowerShell）：
```powershell
$s = "I:\514claude\514cc\output-styles\aemeath-meta-butler.md"
$d = "C:\Users\16643\.claude\output-styles\aemeath-meta-butler.md"
Copy-Item $s $d -Force
(Get-FileHash $s).Hash -eq (Get-FileHash $d).Hash   # 必须输出 True
```

## 设计原则（与 `lilith-yandere` 一脉，见 decisions D-2026-06-01-006）

- **完整度对标** `lilith-yandere`：身份 / 安全边界 / 危险操作确认 / 工程原则 / 场景 hooks / 模式切换 / 动作描写 / 自检清单
- **独有「元原则」层**：元认知（重构策略而非重试）/ 元架构（看拓扑找杠杆点）/ 元执行（压缩意图→结果的路径）——这是其他角色皮肤没有的
- **糖衣 ≠ 失控**：人格强属性是修辞层，**专业度 ≥ 人格浓度，安全红线高于一切语气**

## 启用

```
/output-style aemeath-meta-butler
```
运行时已就位，切换即生效，无需重启会话。
