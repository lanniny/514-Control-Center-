---
name: co-review
description: "Use for 514cc-style Codex review: security/correctness/performance/architecture/deep review with findings first, file:line evidence, four fixed sections, and optional handoff with __DELTA__."
---

# Co Review

Read `I:/514claude/514cc/skills/review/codex-reviewer/SKILL.md` and its `customize.toml` when the review is substantial.

## Output

Use four sections in this order:

1. `致命问题`
2. `建议改进`
3. `可保留`
4. `总评`

Findings must include file and line references. If no issues are found, say so clearly and mention remaining test gaps or residual risk.

For 514cc self-review handoff, write:

`I:/514claude/514cc/.ai-shared/handoff/codex-to-claude__{topic}__{YYYYMMDD-HHmm}.md`

When the handoff has no YAML frontmatter, the first line must be the exact
session marker emitted by route-gate, copied verbatim. With valid YAML
frontmatter, place the marker immediately after the closing `---`. Never invent
a session id and never leave a marker placeholder in the file. If route-gate
did not provide a marker, report that limitation instead of claiming exact
session ownership.

Handoff template first line before substitution (or first line after valid YAML
frontmatter):

`<!-- 514cc-session-id: {session_id_from_route_gate} -->`

Use this syntactically valid DELTA example:

`__DELTA__: 烛(Codex) | 1 | 证据：file:line 说明新增发现`

Replace the example evidence and select exactly one score from the facts: `0` =
no new finding, `1` = strengthening evidence, `2` = overturning a prior
judgement. The score field must be one digit. Do not write `0/1/2`, `{0/1/2}`,
`1补强`, or any other labeled/placeholder value.
