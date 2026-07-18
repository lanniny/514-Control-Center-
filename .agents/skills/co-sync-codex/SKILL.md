---
name: co-sync-codex
description: "Use to synchronize Claude/Cursor/514cc configuration into Codex: AGENTS, .codex config, MCP, skills, hooks, custom agents, output-style/persona adaptation, and runtime backups."
---

# Co Sync Codex

Use this skill for repeatable Codex sync.

## Steps

1. Read `I:/514claude/514cc/AGENTS.md`, `rules.md`, `module.yaml`, `.codex/config.toml`, and `scripts/sync-codex-runtime.ps1`.
2. Back up `~/.codex/config.toml`, `~/.codex/AGENTS.md`, and `~/.codex/hooks.json` before applying runtime changes.
3. Run `scripts/sync-codex-runtime.ps1` in check mode first.
4. Run with `-Apply` only when the expected sources are clean.
5. Validate TOML, hook JSON, skill frontmatter, and custom agent files.
6. Never write literal API tokens from Claude config into repository files.

## Runtime Targets

- `~/.codex/AGENTS.md`
- `~/.codex/config.toml`
- `~/.codex/hooks.json`
- `~/.codex/agents/*.toml`
- `~/.codex/skills/514cc-*`
- `~/.codex/skills/ultracode`
