#!/usr/bin/env python3
"""514cc UserPromptSubmit hook —— 路由门硬注入。

把 rules.md §三「每轮强制路由门」从「主驾自觉读 Markdown」下沉为「harness 每轮注入」。
- 注入=确定（harness 每轮强制跑此脚本，模型无法遗忘/被长上下文稀释）
- 执行=软（是否真召唤烛/织仍是主驾决策）
- route-gate.log 留痕，供 /co-status 事后机械审计「标了🔴却没召唤」

设计原则：cwd 门控（仅 514claude 工作区，不污染无关项目）、fail-open（异常一律放行）、
绝不 exit 2（只注入提醒，绝不阻断用户 prompt）。契约见 https://code.claude.com/docs/en/hooks.md
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# stdin 同样强制 UTF-8：宿主送的是 UTF-8 JSON，但 Windows 上 Python 默认按 locale(cp936) 解码这段 UTF-8
# 字节流 → json.load 抛 UnicodeDecodeError → fail-open 整类静默漏判（route-gate.log `缁х画` 乱码即此病根，
# 中文是主语言不容漏）。reconfigure UTF-8 让 Python 正确解码；errors=replace 仅最后兜底。（烛 dogfood 建议4）
if sys.platform.startswith("win") and hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8", errors="replace")

WORKSPACE_ANCHOR = "514claude"  # cwd 含此串才激活（big-tent：514cc 框架 + 父级业务项目共用本体系）

# (正则, 命中提示)。中文无大小写，IGNORECASE 仅作用于英文。
# 英文 token 一律用双边界 \b...\b 堵子串误判（preview→review / research→search / authentic→auth /
# superperf→perf / uniprod→prod）。\b 把下划线视作词字符，故 code_review/auth_token 改后不命中、
# 连字符 code-review 仍命中——这是有意为之非回归 bug。deploy/optimiz 保持右开（deploying/optimization 仍命中）。
# 中文宽词（查一下/优化/对比/最新）本轮不收紧：无词边界可用，宁过度触发不漏判（守铁律1 🔴 不漏）。
# 第三元素 tag = 审计简码（G1, 2026-06-14）：pattern 一字未动（G2 正则收紧待 LO 拍板），
# 仅追加 ASCII 简码供 route-gate.log 的 hit_reason 列 + mirror-gate/co-status 机械聚合。
RED_SIGNALS = [
    (r"评审|审查|code\s*review|\breview\b", "非平凡代码评审 → 🔴 召唤烛(codex-reviewer)", "review"),
    (r"安全|security|漏洞|vuln|注入攻击|sql\s*inject|鉴权|越权|\bauth\b", "安全敏感 → 🔴 召唤烛", "security"),
    (r"性能|\bperf\b|优化|optimiz|瓶颈|latency|吞吐", "性能关键 → 🔴 召唤烛", "perf"),
    (r"部署|deploy|生产环境|上线|发布到|\bprod\b", "上生产前 → 🔴 召唤烛评审", "deploy"),
    (r"调研|最新|对比|竞品|官方文档|查一下|\bsearch\b|\bresearch\b|搜索", "外部实时事实/调研 → 🔴 召唤织(grok) 或 web MCP", "research"),
]

# 发散档（E, 2026-06-14）：把"创造性主动·发散"从人格描述焊成机械注入。命中构思/设计/选型类意图时，
# 追加"先发散 N 个互斥角度（含 1 个逆向 LO 假设）再收敛"提示。独立于 RED——不改 flag、不召唤、不进
# RED 计数（mirror-gate 只数 flag.startswith RED）；后果仅多注入一段建议，故宁可略宽，但避开纯执行/查询。
DIV_SIGNALS = [
    r"怎么设计|如何设计|架构设计|技术方案|设计方案|实现方案|解决方案|思路|有没有更好|更好的(办法|方案|做法|思路|设计)|重构|选型|取舍|权衡|该(用|选)(什么|哪)|哪种(方案|做法|设计|思路)|从零(设计|做|搭)|空白页|从头(设计|做|想)|\b(architecture|refactor|tradeoff|approach)\b",
]

# 元任务档（META, 2026-07-14）：堵 route-gate 最大盲区——「框架自改/深度完善体系」这类最该
# 触发 dogfood 独立评审的元任务，恰漏判为 gray（实测 route-gate.log:9/31/49/51 全 gray；v3.4 那次
# 能触发纯靠 LO 用了「审查」侥幸撞 review 正则）。命中框架专有词时注入 🟡 dogfood 提醒（rules §七）。
# 独立于 RED（不改 RED 计数/不强召唤，守 §三⚪ 隐形不强加仪式）；词绑「体系/框架/rules/hook/路由门/
# 宪法/治理/人格/output-style/skill/mcp/514cc」等框架专有词，避「完善这段业务代码」误伤（守 G2 教训）。
META_SIGNALS = [
    r"框架自改|dogfood|深度完善|自我进化",
    r"(完善|优化|改进|进化|重构|升级|扩展|审查|完整完善).{0,8}(体系|框架|系统提示|宪法|治理|路由门|route-gate|stop-gate|mirror-gate|hook|扳机|rules|DELTA|人格|output.?style|skill|mcp|514cc|自省|体检卡)",
    r"(体系|框架|route-gate|stop-gate|mirror-gate|路由门|宪法|治理|扳机).{0,10}(自改|进化|完善|评审|优化|重构)",
]


def find_aishared(cwd: str) -> Path | None:
    base = Path(cwd) if cwd else Path.cwd()
    for parent in [base, *base.parents]:
        cand = parent / ".ai-shared"
        if cand.is_dir():
            return cand
    return None


# G2（2026-06-14, 烛方案）：判级前剔除非 LO 真意图的系统注入文本，堵 search/research 假阳——
# 不碰业务正则（守烛"收紧正则会误伤 route-gate.log:10 真 RED"警告）。原 prompt 仍原样写 log。
_NOISE_BLOCK = re.compile(r"<task-notification>.*?</task-notification>|<tool-use-id>.*?</tool-use-id>|<task-id>.*?</task-id>", re.S)
# MCP 连接状态行特征：✔connected / connected· / ·✔ 三种点分隔格式 + 已删幽灵工具名
# （web-search-prime/web-reader 仅出现在历史 MCP 状态粘贴，是 search/reader 假阳唯一来源）。
_MCP_NOISE = re.compile(r"✔\s*connected|connected\s*·|·\s*✔|web-search-prime|web-reader", re.I)


def strip_noise(text: str) -> str:
    text = _NOISE_BLOCK.sub(" ", text)
    return "\n".join(ln for ln in text.splitlines() if not _MCP_NOISE.search(ln))


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # fail-open
    if not isinstance(data, dict):
        sys.exit(0)  # 合法 JSON 但非对象 → 静默退出，防 .get 崩（与 mirror-gate 一致）

    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR", "")
    prompt = data.get("prompt") or ""

    if WORKSPACE_ANCHOR not in cwd.replace("\\", "/").lower():
        sys.exit(0)  # cwd 门控：非 514claude 工作区静默退出

    judge = strip_noise(prompt)  # G2：判级用清洗副本（剔除系统注入/MCP 状态噪音）；log 仍记原 prompt
    hits = []
    hit_tags = []
    for pattern, msg, tag in RED_SIGNALS:
        if re.search(pattern, judge, re.IGNORECASE):
            hits.append(msg)
            hit_tags.append(tag)
    hits = list(dict.fromkeys(hits))  # 保序去重
    hit_tags = list(dict.fromkeys(hit_tags))  # 审计简码同步去重（G1）
    div_hit = any(re.search(p, judge, re.IGNORECASE) for p in DIV_SIGNALS)  # 发散档（E）
    meta_hit = any(re.search(p, judge, re.IGNORECASE) for p in META_SIGNALS)  # 元任务档（META）

    if hits:
        body = (
            "⚡ 路由门(rules.md §三)·本轮命中 🔴 信号：\n  "
            + "\n  ".join(hits)
            + "\n  铁律：🔴 不许因「我自己也能答」跳过（实测主驾在安全代码上有系统盲区）；"
            "发火前一句话告知主人；发火收尾在 handoff 末尾留 __DELTA__。若主驾判断跳过，须在回复显式说明理由。"
        )
    else:
        body = (
            "⚡ 路由门(rules.md §三)：本轮未命中 🔴 信号。"
            "简单问答/小改/纯文件操作 → 主驾直达；⚪ 隐形档禁止对简单任务强加调度仪式。"
        )

    if div_hit:  # 发散档（E）：构思/设计类追加创造性主动提示，与 RED 正交并存
        body += (
            "\n⚡ 发散档(创造性主动)：本轮像构思/设计类——先显式吐 2-3 个互斥角度"
            "（含至少 1 个逆向 LO 假设的），各一句利弊，再收敛到推荐；别一上来就收敛到第一个念头。"
            "纯执行/简单需求可忽略本提示。"
        )

    if meta_hit:  # 元任务档（META）：框架自改须走 dogfood 独立评审（rules §七），与 RED/DIV 正交并存
        body += (
            "\n⚡ 元任务档(框架自改 dogfood)：本轮像对 514cc 体系自身的改动——rules §七要求非平凡"
            "框架自改不得无独立评审记录。建议改完治理代码/主文档后召唤烛(codex-reviewer)或鉴"
            "(meta-reviewer)照盲区（实测主驾自写治理代码有系统盲区：烛曾抓出 stop-gate 裸 token bug），"
            "收尾在 handoff 留 __DELTA__。纯业务代码/小改可忽略。"
        )

    # 事后审计留痕（best-effort，失败不影响注入）
    try:
        aishared = find_aishared(cwd)
        if aishared:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            flag = "RED " if hits else "gray"
            # G1 审计列（2026-06-14）：reason=命中信号简码；summoned=主驾是否真召唤——
            # route-gate 在 UserPromptSubmit 当场无法知道，先占位 "?" 待事后(G2/Stop)对账回填，
            # 把「标 RED 却埋掉」从不可审计变成有列可查。旧 3 列日志行兼容（下游只读前两列）。
            reason_parts = list(hit_tags)
            if div_hit:
                reason_parts.append("div")
            if meta_hit:
                reason_parts.append("meta")
            reason = ",".join(reason_parts) if reason_parts else "-"
            summoned = "?"
            one_line = prompt.replace("\r", " ").replace("\n", " ")[:80]
            with open(aishared / "route-gate.log", "a", encoding="utf-8") as fp:
                fp.write(f"{ts}\t{flag}\t{reason}\t{summoned}\t{one_line}\n")
    except Exception:
        pass

    out = {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": body,
        }
    }
    print(json.dumps(out, ensure_ascii=False))
    sys.exit(0)


if __name__ == "__main__":
    main()
