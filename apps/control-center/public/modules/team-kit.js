/**
 * 团队能力配结：把「团队声明」叠到配置图谱的活状态上。
 * 不改任何源文件——只分类，让芯片墙和注入提示词说同一句话。
 */

export const KIT_STATUS = Object.freeze({
  ok: Object.freeze({ tone: "", label: "" }),
  ghost: Object.freeze({ tone: "is-ghost", label: "目录没有" }),
  off: Object.freeze({ tone: "is-off", label: "图谱已隔离" }),
  gated: Object.freeze({ tone: "is-gated", label: "图谱已关" }),
  partial: Object.freeze({ tone: "is-partial", label: "部分成员已关" }),
});

export function classifyTeamSkill(code, { catalogCodes = [], memberIds = [], agentSkillStates = {} } = {}) {
  const name = String(code ?? "").trim();
  if (!name) return "ghost";
  if (!catalogCodes.includes(name)) return "ghost";
  const members = (memberIds ?? []).map(String).filter(Boolean);
  if (!members.length) return "ok";
  const gated = members.filter((id) => (agentSkillStates[id]?.disabledSkills ?? []).includes(name)).length;
  if (gated === 0) return "ok";
  if (gated === members.length) return "gated";
  return "partial";
}

export function classifyTeamMcp(code, { servers = [] } = {}) {
  const name = String(code ?? "").trim();
  if (!name) return "ghost";
  const server = (servers ?? []).find((item) => item.name === name);
  if (!server) return "ghost";
  if (server.disabled) return "off";
  return "ok";
}
