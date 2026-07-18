#!/usr/bin/env python3
"""514cc Stop hook —— DELTA 落盘完成门禁。

把 rules.md §三铁律3「🔴发火收尾必留 __DELTA__」从「主驾自觉」升级为「harness 强制」：
本轮若产出了烛/织发火 handoff（codex-to-/gemini-to-）却缺 __DELTA__ 行，exit 2 逼主驾补齐再收尾。

死循环杜绝（官方无 stop_hook_active 字段，必须自防）：
  1. 每个 (session, 文件) 只 block 一次——block 前先把它写进 .stop-gate-state.json 的 seen
  2. 持久化失败则放弃 block（exit 0）——「记不住就不拦」，从根上杜绝无限拦截
  3. 只看最近 24h 内修改的 handoff——历史发火不打扰
fail-open：任何异常一律放行。契约见 https://code.claude.com/docs/en/hooks.md
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

# stderr 是本 hook 喂回 Claude 的通道，Windows 默认 cp936 会让中文反馈乱码，强制 UTF-8
if sys.platform.startswith("win") and hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

WORKSPACE_ANCHOR = "514claude"
FRESH_WINDOW_SEC = 24 * 3600  # 只管最近 24h 的发火 handoff（历史 synthesis 靠这个窗口挡，不靠前缀）
# 已知限度（烛 dogfood 建议2，P1-A 处理）：24h 窗挡历史，但挡不住"近 24h 内、非本会话遗留的 synthesis"——
# seen 按 session 去重，故每会话最多被某个无 DELTA 的遗留文件拦一次（自限、有界）。彻底解需按 session_id 归属过滤。
# 🔴 强制落 DELTA 的三类产物：codex-to-/gemini-to- = 真外部发火；synthesis__ = 多 agent 自审收尾。
# 加 synthesis__ 因磁盘真相：codex-to-/gemini-to- 最新停在 5-23（早超 24h 窗，结构上永不触发），
# 而近期真在产的是 synthesis__ 自审产物却不带受控前缀 → stop-gate 上线 0 次击发。扩前缀让自审也被逼留账本。
FIRE_PREFIXES = ("codex-to-", "gemini-to-", "grok-to-", "synthesis__")  # grok-to-=织新驱动；gemini-to- 保留识别历史


def find_aishared(cwd: str) -> Path | None:
    base = Path(cwd) if cwd else Path.cwd()
    for parent in [base, *base.parents]:
        cand = parent / ".ai-shared"
        if cand.is_dir():
            return cand
    return None


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # fail-open

    cwd = data.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR", "")
    session = data.get("session_id", "nosession")

    if WORKSPACE_ANCHOR not in cwd.replace("\\", "/").lower():
        sys.exit(0)

    aishared = find_aishared(cwd)
    if not aishared:
        sys.exit(0)
    handoff_dir = aishared / "handoff"
    if not handoff_dir.is_dir():
        sys.exit(0)

    state_file = aishared / ".stop-gate-state.json"
    try:
        seen = set(json.loads(state_file.read_text(encoding="utf-8")).get("seen", []))
    except Exception:
        seen = set()

    now = time.time()
    missing = []
    try:
        candidates = list(handoff_dir.glob("*.md"))
    except Exception:
        sys.exit(0)

    for f in candidates:
        name = f.name
        if not name.startswith(FIRE_PREFIXES):
            continue
        key = f"{session}:{name}"
        if key in seen:
            continue
        try:
            if now - f.stat().st_mtime > FRESH_WINDOW_SEC:
                continue  # 历史发火不打扰
            content = f.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        # 必须匹配账本行（行首 __DELTA__:），不是裸 token——否则正文讨论"缺 __DELTA__"也会被误判为已补
        # （烛 dogfood 致命1：synthesis 文件常含该 token，裸判会让门禁静默放行=治理失效）
        if not re.search(r"^__DELTA__:", content, re.M):
            missing.append(name)
            seen.add(key)

    if not missing:
        sys.exit(0)

    # 关键：只有成功持久化 seen（保证下次不重复 block）才允许 exit 2，否则放弃拦截杜绝死循环
    try:
        state_file.write_text(
            json.dumps({"seen": sorted(seen)}, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        sys.exit(0)

    sys.stderr.write(
        "本轮有 handoff 缺 __DELTA__ 账本行（rules.md §三铁律3）：\n  "
        + "\n  ".join(missing)
        + "\n请在对应 handoff 末尾补一行： __DELTA__: 对象 | 0白发/1补强/2推翻主驾判断 | 证据(file:line)\n"
        "（codex-to-/gemini-to- = 外部发火；synthesis__ = 多 agent 自审收尾。本提醒每文件只触发一次，不反复打断。）"
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
