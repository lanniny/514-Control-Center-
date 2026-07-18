#!/usr/bin/env python3
"""Host-aware audit for locally discovered Claude/Codex skills."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path


if os.name == "nt" and not sys.flags.utf8_mode:
    completed = subprocess.run(
        [sys.executable, "-X", "utf8", str(Path(__file__).resolve()), *sys.argv[1:]],
        check=False,
    )
    raise SystemExit(completed.returncode)


HOME = Path(os.environ.get("AUDIT_HOME", str(Path.home())))
VALIDATOR_PATH = HOME / ".codex/skills/.system/skill-creator/scripts/quick_validate.py"
SPEC = importlib.util.spec_from_file_location("quick_validate_host_audit", VALIDATOR_PATH)
validator = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = validator
SPEC.loader.exec_module(validator)

ROOTS = (
    HOME / ".agents/skills",
    HOME / ".codex/skills",
    HOME / ".claude/skills",
    HOME / ".codex/plugins/cache",
)
EXCLUDED_PARTS = {"backups", "skills-disabled", ".git", "__pycache__"}


def discover():
    seen = set()
    results = []
    for root in ROOTS:
        if not root.exists():
            continue
        for directory, names, files in os.walk(root, followlinks=False):
            names[:] = [name for name in names if name not in EXCLUDED_PARTS]
            if "SKILL.md" not in files:
                continue
            path = Path(directory) / "SKILL.md"
            real = os.path.normcase(os.path.realpath(path))
            if real in seen:
                continue
            seen.add(real)
            results.append(path)
    return sorted(results, key=lambda path: str(path).casefold())


def main():
    categories = {"valid": [], "host_compatible": [], "plugin_schema": [], "unresolved": []}
    for skill_file in discover():
        valid, message = validator.validate_skill(skill_file.parent)
        record = {"path": str(skill_file), "message": message}
        if valid:
            categories["valid"].append(record)
        elif "Unexpected key(s)" in message and re.search(r"\bargument-hint\b", message):
            categories["host_compatible"].append(record)
        elif "plugins\\cache" in str(skill_file).casefold() and "should be hyphen-case" in message:
            categories["plugin_schema"].append(record)
        else:
            categories["unresolved"].append(record)
    summary = {
        "physicalUnique": sum(len(items) for items in categories.values()),
        "valid": len(categories["valid"]),
        "hostCompatible": len(categories["host_compatible"]),
        "pluginSchema": len(categories["plugin_schema"]),
        "unresolved": len(categories["unresolved"]),
        "hostCompatiblePaths": [item["path"] for item in categories["host_compatible"]],
        "pluginSchemaPaths": [item["path"] for item in categories["plugin_schema"]],
        "unresolvedItems": categories["unresolved"],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if categories["unresolved"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
