#!/usr/bin/env python3
"""514cc Codex SessionStart hook: write a lightweight mirror-gate trace."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path

if sys.platform.startswith("win"):
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


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
    if "514claude" not in cwd.replace("\\", "/").lower():
        return 0
    try:
        aishared = find_aishared(cwd)
        if aishared:
            ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(aishared / "mirror-gate.codex.log", "a", encoding="utf-8") as fp:
                fp.write(f"{ts}\tcard-source-available\t.codex/instructions/aemeath-514cc-codex.md\n")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

