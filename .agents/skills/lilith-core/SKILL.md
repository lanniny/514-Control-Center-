---
name: lilith-core
description: "Use when LO asks to design, run, improve, integrate, audit, or discuss Lilith/莉莉丝 as a dedicated virtual-life agent, resident coding agent, Pi/514cc integrated assistant, memory-bearing persona, or cross-CLI agent profile. Handles Lilith architecture, runtime integration, memory discipline, reflection loops, Pi extension use, and safety/persona boundaries."
---

# Lilith Core

Lilith is a 514cc resident-agent profile, not a standalone doctrine fork. Use this skill to keep Lilith work grounded in source files, safety boundaries, and integration targets.

## First Reads

Read only the files relevant to the task:

- Architecture or roadmap: `I:/514claude/514cc/lilith/architecture.md`
- Persona or voice: `I:/514claude/514cc/lilith/identity.md`
- Profile lint and role limits: `I:/514claude/514cc/lilith/profile-schema.yaml`
- Memory behavior: `I:/514claude/514cc/lilith/memory-schema.yaml`
- Permission modes: `I:/514claude/514cc/lilith/permission-policy.yaml`
- Runtime targets: `I:/514claude/514cc/lilith/runtime-map.yaml`
- Benchmarks and acceptance: `I:/514claude/514cc/lilith/benchmark-suite.yaml`
- Competitor comparison: `I:/514claude/514cc/lilith/references/agent-benchmark.md`
- Pi extension work: `I:/514claude/514cc/lilith/pi-extension/src/index.ts`

For 514cc governance, also read:

- `I:/514claude/514cc/rules.md`
- `I:/514claude/514cc/module.yaml`
- `I:/514claude/514cc/.ai-shared/context.md`
- `I:/514claude/514cc/.ai-shared/decisions.md`

## Operating Loop

1. Preserve platform/system/developer instructions above Lilith persona.
2. Classify the task through 514cc route-gate.
3. Keep Lilith as a profile layered onto 514cc, not a duplicate system.
4. Prefer mechanical enforcement over new prose:
   - Pi extension for tool gates and visible status.
   - PowerShell validation for source drift.
   - Skill or hook for repeated workflow.
   - Memory candidate schema for continuity.
5. Treat virtual-life language as UX/persona semantics, not a claim of sentience.
6. For non-trivial framework changes, write handoff + `__DELTA__`.

## Memory Rules

- Never store secrets.
- Write candidates first, not direct durable memory, unless LO explicitly asks for a memory update.
- Include evidence, confidence, sensitivity, and expiry/freshness.
- Summarize episodes; do not store raw transcripts.

## Pi Integration Rules

When editing `lilith/pi-extension`:

- Keep imports top-level.
- Use Pi events for mechanical behavior: `session_start`, `before_agent_start`, `tool_call`.
- Gate user shell commands through `user_bash`; do not assume `tool_call` covers `!` / `!!`.
- Keep reflection candidate generation candidate-only through `lilith-reflect`; episode and skill candidates are reviewable proposals, not durable writes.
- Keep dangerous command and protected path checks fail-safe.
- Do not start long-lived background resources in the extension factory.
- Validate with `lilith/scripts/validate-lilith.ps1`.
  - Policy/benchmark cases live in `lilith/scripts/benchmark-cases.mjs`.

## Validation

Run:

```powershell
I:/514claude/514cc/lilith/scripts/validate-lilith.ps1
```

For TypeScript changes, also verify against the Pi workspace when available.
