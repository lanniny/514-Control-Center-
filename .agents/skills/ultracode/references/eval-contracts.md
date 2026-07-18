# Ultracode Eval Contracts

Use eval contracts to prevent integration drift. Skip them when they would be paperwork.

## Levels

Use `none` when the task is tiny, touches one obvious behavior, and no packet produces a surface consumed by another packet.

Use `inline` when the task has moderate risk, clear packet scopes, and 5-12 lines in `plan.md` can define success.

Use `full` when:

- write-capable agents share integration surfaces
- one packet produces a surface another consumes
- public APIs, schemas, CLIs, UI flows, migrations, auth, data contracts, or shared modules change
- LO asks for a high-risk audit or independent verification

## Inline Template

```text
Eval contract:
- Outcome:
- Shared surfaces:
- Required checks:
- Blocking conditions:
- Handoff evidence:
```

## Full Template

```text
# Eval contract

## Goal
## Success criteria
## Integration surfaces
## Downstream consumers
## Required checks
## Deliverables
## Blocking conditions
```

## Downstream Contracts

Create `contracts/` only when one packet produces something another packet consumes:

```text
# Downstream contract: <surface>

Producer:
Consumers:
Surface:
Location:

## Guarantees
## Compatibility checks
## Allowed changes
## Forbidden changes
```

## Anti-Bureaucracy Rule

If the contract cannot name a consumer, surface, required check, deliverable, or blocker, keep it inline or skip it.
