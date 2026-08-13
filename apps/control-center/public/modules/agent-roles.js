/**
 * Shared agent role blurbs — governance identity, not provider ads.
 */
export const AGENT_ROLE_BLURB = Object.freeze({
  "claude-fable": "规划编排席 · 规划与综合",
  "codex-technical": "烛 · 实现与评审",
  "grok-search": "织 · 实时情报",
  "grok-build": "快执行 · 综合",
  "kimi-frontend": "前端 · UI 实现",
  "pi-resident": "常驻 · 工具编排",
  "gemini-research": "调研 · 已禁用",
});

export function roleBlurbFor(agentId) {
  return AGENT_ROLE_BLURB[String(agentId || "")] || "";
}
