---
name: 514cc-collab
description: "Use for 514cc collaboration-system work: syncing Claude/Cursor/Codex config, auditing 514cc rules, MCP, skills, hooks, agents, output styles, handoff/DELTA ledgers, or running /co-* equivalent workflows in I:/514claude/514cc."
---

# 514cc Collaboration

Use this skill as the Codex entrypoint for 514cc itself.

## First Reads

Read these before acting on non-trivial 514cc changes:

1. `I:/514claude/514cc/rules.md`
2. `I:/514claude/514cc/.ai-shared/context.md`
3. `I:/514claude/514cc/.ai-shared/decisions.md`
4. `I:/514claude/514cc/module.yaml`
5. Relevant `I:/514claude/514cc/skills/**/SKILL.md`

## Workflow

1. Classify the task with the route gate in `rules.md` section 3.
2. Prefer MCP semantic discovery (`mcp__ace_tool__search_context`) when available, then structured search, then local shell.
3. For config sync, treat repository files as source and user runtime folders as activation targets.
4. Before writing to user runtime folders (`~/.codex`, `~/.claude`, `~/.cursor`, `~/.ai-collab`), create a timestamped backup under `.ai-shared/backups/`.
5. Do not copy secrets or bearer tokens into repository files. Use environment variable forwarding in Codex config.
6. For non-trivial 514cc self changes, write a handoff in `.ai-shared/handoff/` and include a `__DELTA__:` line when an independent pass adds value.

## Equivalents

- `/co-review` -> use `co-review` or the `codex-reviewer` custom agent.
- `/co-research` -> use current web/MCP docs or the `grok-researcher` custom agent when explicitly requested.
- `/co-status` -> inspect `.ai-shared/`, `route-gate*.log`, `mirror-gate*.log`, and handoff DELTA lines.
- `/co-auto` -> classify, choose direct/agent/skill/party, execute, verify.
- `ultracode` / `utralcode` -> use `$ultracode`: xhigh Codex reasoning plus a bounded dynamic workflow with fan-out, adversarial verification, synthesis, and DELTA evidence.
