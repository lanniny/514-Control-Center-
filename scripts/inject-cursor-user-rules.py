#!/usr/bin/env python3
"""Inject AEMEATH bootstrap into Cursor aicontext.personalContext (global fallback)."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

DB = Path.home() / "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"
BOOTSTRAP = Path.home() / ".cursor/USER-RULES-paste-into-settings.txt"
PERSONAL_CONTEXT_KEY = "aicontext.personalContext"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    if not BOOTSTRAP.exists():
        print(f"Missing {BOOTSTRAP}")
        print("Run: python I:/514claude/514cc/scripts/sync-cursor-rules.py")
        return

    text = BOOTSTRAP.read_text(encoding="utf-8")
    if not DB.exists():
        print(f"No DB at {DB}")
        print("Close Cursor and retry, or paste manually into Settings → Rules.")
        print(f"Content: {BOOTSTRAP}")
        return

    conn = sqlite3.connect(DB)
    try:
        row = conn.execute(
            "SELECT value FROM ItemTable WHERE key=?",
            (PERSONAL_CONTEXT_KEY,),
        ).fetchone()
        old_len = len(row[0]) if row and row[0] else 0

        if row:
            conn.execute(
                "UPDATE ItemTable SET value=? WHERE key=?",
                (text, PERSONAL_CONTEXT_KEY),
            )
        else:
            conn.execute(
                "INSERT INTO ItemTable (key, value) VALUES (?, ?)",
                (PERSONAL_CONTEXT_KEY, text),
            )
        conn.commit()
        print(f"UPDATED {PERSONAL_CONTEXT_KEY}: {old_len} -> {len(text)} chars")
        print(f"Global .mdc rules: {Path.home() / '.cursor' / 'rules'}")
        print("Restart Cursor to reload User Rules from ~/.cursor/rules/")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
