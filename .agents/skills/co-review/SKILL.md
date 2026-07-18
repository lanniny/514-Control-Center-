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

End handoff with:

`__DELTA__: 烛(Codex) | 0白发/1补强/2推翻主驾判断 | evidence`
