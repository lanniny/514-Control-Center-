# Agent Benchmark Notes

This file captures current-source comparison points for Lilith. Refresh before making product claims.

## Codex CLI

- Source: https://github.com/openai/codex
- Useful strengths:
  - Local terminal coding agent.
  - AGENTS.md project guidance.
  - Sandboxing, approvals, and network controls are first-class safety concepts.
  - Skills/MCP/subagent ecosystem can be treated as interoperable building blocks.
- Lilith adoption:
  - Keep AGENTS-style source guidance.
  - Treat dangerous operations as approval-gated.
  - Do not weaken sandbox/approval semantics with persona language.

## OpenCode

- Source: https://opencode.ai/docs/cli/
- Useful strengths:
  - TUI-first CLI with programmatic run mode.
  - Strong emphasis on sessions, agents, permissions, MCP, and multi-provider workflows.
  - Good model for user-visible developer experience and IDE-adjacent operation.
- Lilith adoption:
  - Pi TUI should expose Lilith state, sessions, and gates visibly.
  - Roadmap should include LSP diagnostics and session navigation.
  - Permissions must be explicit and inspectable.

## Hermes Agent

- Sources:
  - https://hermes-agent.nousresearch.com/docs/
  - https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
  - https://github.com/nousresearch/hermes-agent
- Useful strengths:
  - Bounded curated persistent memory.
  - Built-in learning loop that creates/improves skills from experience.
  - Periodic nudges and cross-session recall.
- Lilith adoption:
  - Memory writes are candidate-first, evidence-backed, and sensitivity-labeled.
  - Repeated workflows become skill candidates.
  - Reflection is a mechanical closeout path, not optional diary prose.

## OpenClaw

- Sources:
  - https://docs.openclaw.ai/cli
  - https://docs.openclaw.ai/concepts/session
  - https://openclaw.ai/
- Useful strengths:
  - Guided onboard/configure flows.
  - Sessions routed by channel/source.
  - Chat-platform and background-job orientation.
- Lilith adoption:
  - Add `lilith onboard` and `lilith configure` before wide runtime sync.
  - Future chat gateway must isolate sessions by DM/group/channel/cron/webhook.
  - Background wakeups need explicit channel and permission policy.

## Pi Harness

- Source: `G:/tasks/pi proxy/packages/coding-agent/docs/extensions.md`
- Useful strengths:
  - TypeScript extensions can intercept lifecycle/tool events.
  - Commands, custom tools, UI widgets, session persistence, and subagents are extension-level primitives.
- Lilith adoption:
  - Pi extension is the primary body layer.
  - Keep state visible with status/widgets.
  - Use tool gates for dangerous commands and protected paths.

## Claude Code 2.1.88 Local Source Snapshot

- Source: `J:/下载/cc2.1.88.gz`
- Checked files:
  - `all/src/utils/permissions/PermissionMode.ts`
  - `all/src/utils/permissions/PermissionRule.ts`
  - `all/src/utils/permissions/dangerousPatterns.ts`
  - `all/src/utils/settings/toolValidationConfig.ts`
  - `all/src/utils/sessionStoragePortable.ts`
- Useful strengths:
  - Permission modes are explicit product states, not just prose.
  - Permission rules separate behavior (`allow` / `deny` / `ask`) from tool-specific rule content.
  - Dangerous shell prefixes include interpreters, package runners, shells, SSH, and optional internal high-risk tools.
  - Tool validation distinguishes file-pattern tools, shell-prefix tools, and custom validators.
  - Session storage is a portability concern, not an afterthought.
- Lilith adoption:
  - Keep Lilith mode states explicit (`plan` / `review` / `build`) and visible in reports.
  - Keep protected-path and shell mutation checks in policy-backed code.
  - Comparison matrix records environment/probe status instead of claiming external runs.
  - Task-pack acceptance stays deterministic so Codex CLI, OpenCode, and Lilith can eventually run the same workspace tasks.
