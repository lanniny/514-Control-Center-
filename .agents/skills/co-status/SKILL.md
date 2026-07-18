---
name: co-status
description: "Use to inspect 514cc health/status: route-gate logs, mirror-gate logs, DELTA ledger, handoff freshness, runtime sync drift, and Codex/Claude/Cursor configuration alignment."
---

# Co Status

Inspect:

- `I:/514claude/514cc/.ai-shared/context.md`
- `I:/514claude/514cc/.ai-shared/decisions.md`
- `I:/514claude/514cc/.ai-shared/route-gate.log`
- `I:/514claude/514cc/.ai-shared/route-gate.codex.log`
- `I:/514claude/514cc/.ai-shared/mirror-gate.log`
- `I:/514claude/514cc/.ai-shared/mirror-gate.codex.log`
- `I:/514claude/514cc/.ai-shared/handoff/`

Run drift checks:

- `powershell -NoProfile -ExecutionPolicy Bypass -File I:/514claude/514cc/scripts/sync-runtime.ps1`
- `powershell -NoProfile -ExecutionPolicy Bypass -File I:/514claude/514cc/scripts/sync-codex-runtime.ps1`

Report only verified facts. If a log is absent, say absent rather than inferring inactivity unless the absence itself is the audited signal.
