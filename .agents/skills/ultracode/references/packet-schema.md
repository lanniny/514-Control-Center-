# Ultracode Packet Schema

Use this when a non-trivial Ultracode run needs inspectable workflow artifacts.

## Layout

```text
.workflow/ultracode/<run-slug>/
  plan.md
  orchestration.md
  state.json
  packets/
    01-discovery.md
  results/
    01-discovery.md
  integration.md
  final-report.md
```

Optional high-risk files:

```text
eval-contract.md
contracts/
handoffs/
final-audit.md
```

## plan.md

Required sections:

```text
# <task title>

## Goal
## Success criteria
## Current context
## Constraints
## Risk level
## Approval gates
## Mode
## Work packets
## Eval contract
## Integration policy
## Verification plan
## Completion criteria
```

For explicit Ultracode on non-trivial work without native agents, include the concrete no-delegation reason.

## orchestration.md

Required sections:

```text
# Orchestration

## Parent critical path
## Packets
## Delegation
## Agents
## Delegation limits
## Wait points
## Fallback
## Verification order
```

Keep it operational. It is the execution contract, not a transcript.

## state.json

Minimum keys:

```json
{
  "title": "string",
  "slug": "string",
  "created_at": "ISO-8601 string",
  "updated_at": "ISO-8601 string",
  "status": "planning",
  "mode": "direct|workflow|delegated",
  "baseline_ref": "git HEAD sha or no-git",
  "risk_level": "low|medium|high|unknown",
  "eval_contract": {
    "level": "none|inline|full",
    "path": "eval-contract.md or null",
    "status": "pending|ready|checked"
  },
  "approval": {
    "required": false,
    "granted": null,
    "notes": ""
  },
  "delegation": {
    "native_agent_available": false,
    "native_agent_planned": false,
    "native_agent_used": false,
    "agent_count": 0,
    "wave_count": 0,
    "no_delegation_reason": "",
    "notes": ""
  },
  "packets": [],
  "verification": {
    "status": "pending",
    "checks": []
  }
}
```

Allowed run statuses: `planning`, `waiting_for_approval`, `executing`, `integrating`, `verifying`, `complete`, `blocked`, `cancelled`.

## Packet files

```text
# Packet <id>: <name>

## Objective
## Context
## Sources
## Ownership
## Do
## Do not
## Expected output
## Verification
## Handoff format
```

For write-capable packets, add:

```text
## Write scope

- path/to/file-a
- path/to/module/

## Coordination rule

You are not alone in the codebase. Do not revert edits made by others. Adapt to nearby changes.
```

## Result files

```text
# Result <id>: <name>

## Summary
## Evidence
## Handoff
## Files changed
## Decisions
## Risks
## Verification run
## Open questions
```

## integration.md

```text
# Integration

## Accepted
## Rejected
## Conflicts
## Decisions
## Final changes
## Verification still needed
## Remaining risks
```

## final-report.md

```text
# Final report

## Outcome
## What changed
## Verification
## Final audit
## Skipped checks
## Remaining risks
## Next useful step
```

## Naming

- Use two-digit packet prefixes such as `01-discovery`.
- Use lowercase hyphen-case slugs under 64 characters.
- Match result file names to packet IDs.
- Do not mark work complete without verification evidence or an explicit skipped-check reason.
