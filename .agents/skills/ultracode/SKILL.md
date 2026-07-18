---
name: ultracode
description: "Use when LO explicitly invokes Codex ultracode/utralcode/ultra code, asks for Claude ultracode parity in Codex, asks to split/delegate across agents, or gives high-cost authorization such as '最强大脑深度完善' for a substantive task. Runs the Codex-safe equivalent of Claude ultracode: xhigh reasoning plus workflow artifacts, bounded native fan-out, eval contracts, approval gates, verification, synthesis, and DELTA evidence."
---

# Codex Ultracode

Codex Ultracode is the 514cc/Codex equivalent of Claude Code ultracode.

This is a skill, not a hidden runtime, proxy, or official Claude/OpenAI feature. It teaches Codex how to run a disciplined high-effort workflow with the tools the current host actually exposes. Host/system/developer rules always win.

Official Claude semantics, adapted safely:

- Claude ultracode is not a separate effort level; it sends `xhigh` to the model and additionally orchestrates dynamic workflows for substantive tasks.
- In this 514cc Codex project, `.codex/config.toml` already sets `model_reasoning_effort = "xhigh"`.
- This skill adds the missing part: a deliberate dynamic workflow discipline, inspectable artifacts, bounded delegation, eval contracts, approval gates, and final audit for substantive tasks.

## Trigger

Enter this mode only when LO explicitly authorizes it, for example:

- `ultracode`, `utralcode`, `ultra code`, `Codex ultracode`
- "用最强大脑深度完善"
- "全面审查体系给出优化方案"
- "深度完善整个架构"
- "split this across agents", "delegate this", "parallel agents", "multi-agent workflow"

Do not treat ordinary "想清楚一点" or "深入思考" as authorization for expensive fan-out by itself.

## First Pass

Before acting, classify:

- task type: research, code change, bug fix, migration, audit, docs, design, QA, release
- risk: low, medium, high
- blast radius: single file, module, repo-wide, external system
- verification: none, command, tests, build, browser, manual checklist
- delegation: useful, not useful, allowed by host, blocked by environment
- eval contract: none, inline, full
- approval gates: required, not required, already granted

Then choose the smallest mode that can prove the result.

## Operating Contract

When active:

1. State briefly that Codex Ultracode is active.
2. Freeze the objective, scope, constraints, and acceptance criteria.
3. Build a high-level plan before tools or subagents.
4. For non-trivial tasks, create workflow artifacts before delegation or broad edits.
5. Use current-source context first: repo files, MCP/official docs when required, then shell fallback.
6. Fan out only when it materially improves the result:
   - 2-4 parallel sidecars for independent audit/research/design/verification.
   - Stay under 5 sidecar agents total unless LO explicitly approves more.
   - Max 6 concurrent Codex agents is the hard runtime ceiling, matching `.codex/config.toml`.
   - Depth 1 by default; do not create recursive agent trees unless LO explicitly asks.
7. Keep the main thread on the critical path while sidecars run.
8. Synthesize, do not forward raw subagent output as final truth.
9. Run adversarial verification for high-risk conclusions.
10. Record evidence: files, line numbers, commands, test output, sources, and what changed.
11. For non-trivial 514cc work, write a handoff with `__DELTA__:` and append a decision when the change affects the framework.

## Dynamic Workflow Shape

Use the smallest workflow that can honestly solve the task:

### UC-1 Direct Mode

For small, clear tasks:

- Do the task directly.
- Do not create workflow artifacts unless useful or requested.
- Verify with the narrowest useful check.
- Mention skipped workflow only when it matters.

### UC-2 Workflow Mode

For multi-step work without useful or permitted delegation:

1. Create a run directory under `.workflow/ultracode/<slug>/` unless project instructions require another scratch root.
2. Write `plan.md`, `orchestration.md`, `state.json`, packet notes under `packets/`, packet results under `results/`, `integration.md`, and `final-report.md`.
3. Execute packets as separated parent-session passes.
4. Keep packet evidence separate and integrate before final verification.
5. Record the concrete reason native delegation was not used.

### UC-3 Delegated Mode

For independent packets where Codex native agents are available and delegation is permitted:

1. Create workflow artifacts first.
2. Keep the immediate blocking path local.
3. Spawn read-only `explorer` agents for discovery, risk review, test discovery, or verification planning.
4. Spawn `worker` agents only for bounded write packets with explicit, non-overlapping ownership.
5. Tell every worker: "You are not alone in the codebase. Do not revert edits made by others. Adapt to nearby changes."
6. Do not combine `agent_type=explorer|worker` with full-history fork; use a self-contained prompt, or omit the role if full context is required.
7. Wait only when the parent is blocked on a result.
8. Close agents after collecting results when the tool surface supports it.

### UC-4 Research + Build

For current docs, external APIs, or unfamiliar tools:

1. Verify current facts with official docs or current-source MCP/web.
2. Build only after the facts are pinned.
3. Validate against local runtime.

### UC-5 514cc Self-Evolution

For 514cc itself:

1. Read `rules.md`, `.ai-shared/context.md`, `.ai-shared/decisions.md`, `module.yaml`, and relevant skills.
2. Use `.ai-shared/handoff/` and `decisions.md` as the project-specific workflow ledger; also use `.workflow/ultracode/` when packets/eval contracts add value.
3. Identify the mechanical trigger or sync target; avoid adding soft doctrine when a hook/script/check can enforce it.
4. Edit source of truth first.
5. Sync runtime when runtime files are affected.
6. Validate.
7. Handoff + decision + `__DELTA__`.

## Workflow Artifacts

Default layout:

```text
.workflow/ultracode/<run-slug>/
  plan.md
  orchestration.md
  state.json
  packets/
  results/
  integration.md
  final-report.md
```

Optional high-risk artifacts:

```text
eval-contract.md
contracts/
handoffs/
final-audit.md
```

Read `references/packet-schema.md` before creating or validating these files.

## Eval Contracts

Choose the smallest contract:

- `none`: tiny direct task.
- `inline`: ordinary workflow/delegated task; put 5-12 lines in `plan.md`.
- `full`: public API/schema/CLI/UI/auth/data/migration/shared-module changes, write-capable agents sharing surfaces, or high-risk audits.

Inline contract shape:

```text
Eval contract:
- Outcome:
- Shared surfaces:
- Required checks:
- Blocking conditions:
- Handoff evidence:
```

Read `references/eval-contracts.md` before full contracts.

## Approval Gates

Ask one clear approval question before deletion, overwrites, mass renames, force push, publish/deploy/post/email, production data changes, credentials/secrets/billing/user accounts, broad codemods, global installs, or expensive/long-running swarms.

If approval is missing, continue only with safe read-only work, local drafts, or non-destructive checks. Read `references/approval-gates.md` when risk is ambiguous.

## Guardrails

- Ultracode increases effort, not authority. All Codex platform/system/developer instructions, safety rules, 514cc guardrails, and dangerous-operation confirmations still apply.
- Do not spawn agents just to look impressive. Fan-out must have independent value.
- Do not claim Claude-native cloud Workflow parity when running inside Codex. This is a Codex-native workflow equivalent using available Codex tools, skills, MCP, and subagents.
- Do not copy proxy/router behavior from projects such as UltraCode-Shim unless LO explicitly asks to install a proxy and accepts the credential/routing risk. Model routing is a separate capability from this skill.
- If subagents or MCP tools are unavailable, say so and fall back to a local multi-pass workflow.
- External current facts still require current-source verification.

## Final Shape

For substantial ultracode runs, report:

```markdown
**Codex Ultracode**
- Objective:
- Mode/artifacts:
- Sidecars/tools:
- Changes:
- Verification:
- Skipped checks:
- Remaining risk:
- DELTA:
```

## References

- Read `references/packet-schema.md` when creating packet, result, orchestration, or state artifacts.
- Read `references/eval-contracts.md` before full contracts or cross-surface delegation.
- Read `references/approval-gates.md` before risky or ambiguous work.
