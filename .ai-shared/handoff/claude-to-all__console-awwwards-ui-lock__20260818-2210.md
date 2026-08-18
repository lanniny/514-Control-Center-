---
from: 主驾(Cursor/AEMEATH)
to: all
topic: console-awwwards-ui-lock
date: 2026-08-18
status: LOCKED
supersedes: architect-to-claude__console-awwwards-ui__20260818-2147.md §4.2 ADR-UI-01 与 §4.6/§5 壳拓扑
---
<!-- 514cc-session-id: 514cc-local -->

# LO 锁定：514cc Console Awwwards UI

方案阶段冻结。未改产品代码。实现另波，等 LO 说开工。

策的双寄存器、RAF 互斥、零 emoji、不恢复独立 `#/hero`、仪器面冲突时赢——全部保留。
被本锁推翻的只有两处：

1. **ADR-UI-01 玫瑰签名 + 铜橙材料 + 暖纸合成** → 换成墨稿席位场。
2. **保留 232px 带标签侧栏、先锋只发生在面内** → 协作台收成 48px 席位轨。

## LO 选择题原文

- 视觉身份：`ink-field`（墨稿席位场）
- 外壳 chrome：`seat-rail`（协作台 48px 席位轨，页面跳转交给 Ctrl+K）

## 命题

控制面不是面板，是一张正在写的协作墨稿。席位在纸上移动，连线是正在发生的委托。

签名元素只此一件：**席位场（Seat Field）**，三种振幅共用同一物理引擎。

| 振幅 | 在哪 | 做什么 |
|------|------|--------|
| 底稿 8% | 协作台背后 | 当前团队活图，pointer-events:none |
| 舞台 100% | 团队页 | 页面本体，不是卡片 widget |
| 样本 40% | 外观仪典头 | 被大字镂空切穿，调墨时场跟着变 |

无席位数据时场必须停在静帧墨渍，禁止随机粒子冒充氛围。

## 六色（开工真源）

| 名 | Hex | 职 |
|----|-----|----|
| 墨井 Ink Well | `#14181F` | 暗色主表面 |
| 宣蓝 Blotting | `#E4E7EE` | 亮色主表面。禁止暖米黄当页底 |
| 胆矾 Gall | `#5E8B86` | `--primary`。主按钮、滑杆、当前页指示 |
| 胭脂 Madder | `#A84D68` | 只表示活着。busy / 流式左缘 / AEMEATH 在场。ccline 暗夜玫瑰 Continuity 落在这里，不填主按钮 |
| 蓝铅笔 Blue Pencil | `#6A849C` | 焦点环、委托脉冲 |
| 灯芯 Wick | `#D9C5A8` | 仪典 Display 字。只准大字，不准铺底 |

铜橙 `#D97757` 从 `--primary` 退役。外观四色卡取消，改成：纸面（墨井/宣蓝/跟随）+ 在场（胭脂开/关）+ 仪典墨（胆矾 | 蓝铅笔 两档）。

Dark-first。亮色是宣蓝纸的一等公民反相，不是暖米售后。

## Chrome（已锁）

- 协作台：48px 席位轨。品牌墨戳 + 活席位 + 底「工坊 / 设置」。页面级导航不在这里。
- 工作室页（团队/总览/外观/配置…）：48px 图标轨 + 200px 领域二级栏。settings-rail 并进设置工作室整页。
- 协作台内部三栏密度保留（左工具轨 / 时间线 / 右任务核）。
- 落地页仍是 workbench。不恢复 `#/hero`。
- 移动底栏三键：协作台 / 团队 / 设置。

## 仍有效的策约束

- 仪典礼面 vs 工作仪器面。冲突时仪器面赢。
- RAF 互斥；30fps cap；hidden / reduced-motion / 外观开关停帧。
- CSP 无内联 style；动态值 CSSOM。
- 全程 Lucide；零 emoji；官方 CLI fill 徽标仅席位身份。
- 不重写后端、不改 adapter、无 CDN、无 WebGL、本波不 commit。

## 体感验收（答不上 = FAIL）

1. 打开协作台：左边几点墨在动，中间才是话。
2. 打字派工没有变慢。
3. 没有小黄脸。
4. 团队页是一幅活图，不是卡片里的演示。
5. 关动效后画面仍完整，像印刷品。

__DELTA__: 主驾 | 2 | 证据：LO 锁定 ink-field + seat-rail，推翻策规格 ADR-UI-01（玫瑰+铜橙暖纸合成）与「保留带标签侧栏」；视觉真源改为墨井/宣蓝/胆矾/胭脂，协作台 chrome 改为 48px 席位轨。
