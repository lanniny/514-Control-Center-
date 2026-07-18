#!/usr/bin/env python3
"""514cc Codex UserPromptSubmit hook.

Codex hook contracts differ from Claude's; this hook is intentionally conservative:
it logs route-gate evidence and prints a compact reminder for hook UIs that surface stdout.
The durable behavior still lives in AGENTS.md and .codex/instructions/.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

if sys.platform.startswith("win"):
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

WORKSPACE_ANCHOR = "514claude"
RED_SIGNALS = [
    (r"评审|审查|code\s*review|\breview\b", "review"),
    (r"安全|security|漏洞|vuln|注入攻击|sql\s*inject|鉴权|越权|\bauth\b", "security"),
    (r"性能|\bperf\b|优化|optimiz|瓶颈|latency|吞吐", "perf"),
    (r"部署|deploy|生产环境|上线|发布到|\bprod\b", "deploy"),
    (r"调研|最新|对比|竞品|官方文档|查一下|\bsearch\b|\bresearch\b|搜索", "research"),
]
UC_SIGNALS = [
    r"\bultra\s*code\b|\bultracode\b|\butralcode\b|Codex\s*ultra|Claude\s*ultra|最强大脑|深度完善|全面审查体系|动态\s*workflow|dynamic\s*workflow",
]
DIV_SIGNALS = [
    r"怎么设计|如何设计|架构设计|技术方案|设计方案|实现方案|解决方案|思路|有没有更好|重构|选型|取舍|权衡|\b(architecture|refactor|tradeoff|approach)\b",
]
NOISE_BLOCK = re.compile(r"<task-notification>.*?</task-notification>|<tool-use-id>.*?</tool-use-id>|<task-id>.*?</task-id>", re.S)
MCP_NOISE = re.compile(r"✔\s*connected|connected\s*·|·\s*✔|web-search-prime|web-reader", re.I)


def find_aishared(cwd: str) -> Path | None:
    base = Path(cwd) if cwd else Path.cwd()
    for parent in [base, *base.parents]:
        cand = parent / ".ai-shared"
        if cand.is_dir():
            return cand
    return None


def strip_noise(text: str) -> str:
    text = NOISE_BLOCK.sub(" ", text)
    return "\n".join(line for line in text.splitlines() if not MCP_NOISE.search(line))


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}

    cwd = str(data.get("cwd") or os.getcwd())
    prompt = str(data.get("prompt") or data.get("user_prompt") or data.get("input") or "")
    if WORKSPACE_ANCHOR not in cwd.replace("\\", "/").lower():
        return 0

    judge = strip_noise(prompt)
    tags = []
    for pattern, tag in RED_SIGNALS:
        if re.search(pattern, judge, re.IGNORECASE):
            tags.append(tag)
    tags = list(dict.fromkeys(tags))
    uc_hit = any(re.search(pattern, judge, re.IGNORECASE) for pattern in UC_SIGNALS)
    div_hit = any(re.search(pattern, judge, re.IGNORECASE) for pattern in DIV_SIGNALS)

    try:
        aishared = find_aishared(cwd)
        if aishared:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            flag = "RED " if tags else "gray"
            reason = ",".join(tags + (["uc"] if uc_hit else []) + (["div"] if div_hit else [])) or "-"
            one_line = prompt.replace("\r", " ").replace("\n", " ")[:100]
            with open(aishared / "route-gate.codex.log", "a", encoding="utf-8") as fp:
                fp.write(f"{ts}\t{flag}\t{reason}\t?\t{one_line}\n")
    except Exception:
        pass

    if tags or div_hit or uc_hit:
        msg = "514cc route gate: "
        if tags:
            msg += "RED=" + ",".join(tags) + "; "
        if uc_hit:
            msg += "UC=Codex Ultracode: xhigh + bounded dynamic workflow; "
        if div_hit:
            msg += "DIV=先发散2-3个互斥角度再收敛; "
        print(msg.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
