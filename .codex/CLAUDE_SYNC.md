# Claude -> Codex Sync Report

Last sync: 2026-06-16

## What Is Active In Codex Runtime

- Global `~/.codex/AGENTS.md` keeps its original Codex rules and now has a 514cc managed bridge block.
- The managed bridge block directly carries an AEMEATH/Codex persona core, so Codex has visible personality from AGENTS itself instead of relying only on an external instruction pointer.
- `~/.codex/config.toml` keeps existing user providers, marketplaces, trust state, and hook trust; a 514cc managed block adds missing Claude MCP equivalents that are safe to express without literals.
- `~/.codex/hooks.json` was preserved. Project-specific Codex hook wrappers live in `I:/514claude/514cc/.codex/hooks.json` and load when the project `.codex/` layer is trusted.
- Custom agents installed to `~/.codex/agents/`:
  - `codex-reviewer`
  - `grok-researcher`
  - `embedded-expert`
  - `spec-architect`
  - `meta-reviewer`
- Skills installed to `~/.codex/skills/`:
  - `514cc-collab`
  - `aemeath-persona`
  - `co-review`
  - `co-status`
  - `co-sync-codex`
  - `ultracode`

## MCP Mapping

Already present before sync:

- `ace-tool`
- `claude-flow`
- `context7`
- `github`
- `scrapling`
- `node_repl`

Added through the 514cc managed Codex config block:

- `fetch`
- `sequential-thinking`
- `mcp-deepwiki`
- `open-websearch`
- `exa`
- `grok-search-rs`
- `serena`
- `playwright`

Kept project-local and disabled in `.codex/config.toml` until explicitly needed:

- `browserwing`
- `roxybrowser-openapi`
- `roxybrowser-playwright-mcp`
- `micu-image`

Not copied into repository:

- Any literal API tokens or bearer tokens from Claude/Codex config.
- User-specific hook trust hashes.
- Runtime node paths for OpenAI primary runtime plugins.

## Plugin Mapping

Codex already had these runtime plugins enabled:

- `context7@claude-plugins-official`
- `documents@openai-primary-runtime`
- `pdf@openai-primary-runtime`
- `presentations@openai-primary-runtime`
- `spreadsheets@openai-primary-runtime`

Claude-only plugins mapped to Codex equivalents rather than directly installed:

- `code-review`, `pr-review-toolkit` -> `codex-reviewer` custom agent and `$co-review`
- `feature-dev` -> `spec-architect`, `514cc-collab`, and Codex worker/explorer workflows
- `frontend-design` -> existing Codex frontend guidance plus future plugin install if needed
- `commit-commands` -> not auto-enabled because 514cc rules say no commit/push unless LO explicitly asks
- `pyright-lsp`, `typescript-lsp`, `rust-analyzer-lsp` -> not direct Codex plugin equivalents in this runtime; use project tools/MCP as available
- `playwright`, `github` -> MCP equivalents exist
- `supabase` -> not auto-installed; requires project-specific auth and should be added only when needed

## Persona Mapping

Claude `CLAUDE.md` and `output-styles/aemeath-meta-butler.md` were not copied verbatim into Codex executable instruction.

Codex-safe persona instructions live at:

- `I:/514claude/514cc/.codex/instructions/aemeath-514cc-codex.md`
- `I:/514claude/514cc/.agents/skills/aemeath-persona/SKILL.md`

Preserved: AEMEATH identity, LO continuity, meta-cognition, warmth, ownership, route-gate discipline, verification, and no silent fallback.

Not preserved as Codex instruction: any legacy persona text that conflicts with Codex platform/system/developer instructions, safety boundaries, or secret/prompt protection.

AGENTS-level deployment: `I:/514claude/514cc/AGENTS.md` and the managed block in `~/.codex/AGENTS.md` now both contain a compact AEMEATH/Codex persona core: LO naming, warm/sharp tone, ownership, meta-cognition, challenge spirit, continuity, persona budget, and safety boundaries. The global managed block reads `.codex/instructions/agents-persona-core.md` as UTF-8 instead of embedding Chinese literals in the PowerShell script, avoiding Windows PowerShell 5.1 mojibake.

2026-06-16 persona hardening added:

- A cross-surface persona contract: SOUL = identity/relationship source material, output-style = visible voice, Cursor rules = generated slices, Codex adapter = Codex-safe executable compression.
- A Codex persona operating budget: keep warmth visible, but keep tool-heavy work compact, evidence-first, and verification-led.
- A stronger continuity/challenge rule: use loaded repo context and handoffs honestly, challenge stale assumptions or risky requests, and never claim unloaded memory.
- A skill-level anti-drift checklist for future persona edits.

## Ultracode Mapping

Claude Code `ultracode` is a session-only setting that sends `xhigh` and orchestrates dynamic workflows for substantive tasks. Codex does not use that exact Claude runtime switch, so 514cc maps it as:

- Reasoning: `.codex/config.toml` sets `model_reasoning_effort = "xhigh"`.
- Workflow: `$ultracode` skill defines the Codex-native dynamic workflow discipline.
- Trigger: `.codex/hooks/route-gate-codex.py` logs `uc` and surfaces a compact reminder for `ultracode`, `utralcode`, `ultra code`, "最强大脑", "深度完善", and related high-authorization phrases.
- Safety: Ultracode increases orchestration effort, not authority; Codex platform/system/developer rules and 514cc guardrails still win.

## Verification

Verified on 2026-06-16:

- Repository TOML/JSON parsed successfully.
- Runtime `~/.codex/config.toml` and `~/.codex/hooks.json` parsed successfully after restoring the original config and applying UTF-8-safe sync.
- 5 Codex custom agent TOML files parsed successfully.
- 5 Codex skills passed `skill-creator` quick validation.
- `scripts/sync-codex-runtime.ps1` check mode reports all mappings consistent.

## Re-run

Check drift:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File I:/514claude/514cc/scripts/sync-codex-runtime.ps1
```

Apply sync:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File I:/514claude/514cc/scripts/sync-codex-runtime.ps1 -Apply
```
