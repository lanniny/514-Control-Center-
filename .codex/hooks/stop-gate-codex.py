#!/usr/bin/env python3
"""514cc Codex Stop hook: best-effort DELTA audit for fresh handoffs.

Each (session, handoff file) is blocked at most once, matching the Claude
stop-gate semantics while keeping the hook fail-open.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

if sys.platform.startswith("win"):
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

FIRE_PREFIXES = ("codex-to-", "gemini-to-", "grok-to-", "synthesis__")  # grok-to-=织新驱动；gemini-to- 保留识别历史
FRESH_WINDOW_SEC = 24 * 3600
DELTA_RE = re.compile(r"^__DELTA__:", re.M)


def find_aishared(cwd: str) -> Path | None:
    base = Path(cwd) if cwd else Path.cwd()
    for parent in [base, *base.parents]:
        cand = parent / ".ai-shared"
        if cand.is_dir():
            return cand
    return None


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    cwd = str(data.get("cwd") or os.getcwd())
    session = str(data.get("session_id") or data.get("session") or "nosession")
    if "514claude" not in cwd.replace("\\", "/").lower():
        return 0
    aishared = find_aishared(cwd)
    if not aishared:
        return 0
    handoff_dir = aishared / "handoff"
    if not handoff_dir.is_dir():
        return 0
    state_file = aishared / ".stop-gate-codex-state.json"
    try:
        state = json.loads(state_file.read_text(encoding="utf-8"))
        seen = set(state.get("seen", []))
    except Exception:
        seen = set()
    now = time.time()
    missing = []
    for path in handoff_dir.glob("*.md"):
        if not path.name.startswith(FIRE_PREFIXES):
            continue
        key = f"{session}:{path.name}"
        if key in seen:
            continue
        try:
            if now - path.stat().st_mtime > FRESH_WINDOW_SEC:
                continue
            content = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        if not DELTA_RE.search(content):
            missing.append(path.name)
            seen.add(key)
    if not missing:
        return 0
    try:
        state_file.write_text(json.dumps({"seen": sorted(seen)}, ensure_ascii=False), encoding="utf-8")
    except Exception:
        return 0
    sys.stderr.write(
        "514cc stop gate: fresh handoff missing __DELTA__ line:\n  "
        + "\n  ".join(missing)
        + "\nAdd: __DELTA__: 对象 | 0白发/1补强/2推翻主驾判断 | 证据(file:line)\n"
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
