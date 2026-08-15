export function classifyTask(prompt = "", { hasVisualAttachment = false } = {}) {
  // 真实附件只用于选择路由规则，不再触发能力准入门。普通模型和成员默认拥有全部能力；
  // 只有 routing.json 中带 constraints + reason 的特殊规则才能限制候选通道。
  if (hasVisualAttachment) return "multimodal";
  const tests = [
    ["current-research", /最新|当前|今天|实时|搜索|search|news|202[5-9]/i],
    ["long-context", /长文档|全文|超过\s*\d+\s*(?:kb|mb)|long[- ]?context|document/i],
    ["review", /评审|审计|review|security|安全/i],
    ["debugging", /修复|报错|错误|异常|故障|debug|bug|exception|失败/i],
    ["coding", /实现|写代码|开发|编码|implement|code|build/i],
    ["planning", /规划|方案|架构|设计|plan|architecture/i],
  ];
  return tests.find(([, pattern]) => pattern.test(prompt))?.[0] || "planning";
}

function healthValue(providerHealth) {
  return providerHealth.status === "online" ? 1 : providerHealth.status === "degraded" ? 0.5 : 0;
}

function routeScore(profile, providerHealth, weights, preference = 0) {
  return (
    profile.quality * weights.quality
    + profile.speed * weights.speed
    + healthValue(providerHealth) * weights.health
    + ((6 - profile.costTier) / 5) * weights.cost
    + preference
  );
}

function constrainedProviders(rule) {
  const ids = rule?.constraints?.allowedProviders;
  return Array.isArray(ids) ? new Set(ids) : null;
}

export class ModelRouter {
  constructor({ profiles, policy, healthService }) {
    this.profiles = profiles;
    this.policy = policy;
    this.healthService = healthService;
  }

  async preview({ prompt = "", taskType, requestedProvider, risk = "normal", needsCurrentSource = false, allowedProviders = null, hasVisualAttachment = false, visualAttachmentType = null } = {}) {
    // 团队成员白名单由服务端推导。空数组必须 fail-closed，不能退化为“不设限制”。
    const allowed = Array.isArray(allowedProviders) ? new Set(allowedProviders) : null;
    const resolvedTaskType = hasVisualAttachment === true || visualAttachmentType !== null
      ? "multimodal"
      : needsCurrentSource
        ? "current-research"
        : taskType || classifyTask(prompt);
    const health = await this.healthService.map();
    const rule = this.policy.rules.find((item) => item.taskTypes.includes(resolvedTaskType));
    const specialAllowed = constrainedProviders(rule);
    const preference = new Map((rule?.prefer || []).map((id, index) => [id, Math.max(0, 0.12 - index * 0.03)]));

    if (requestedProvider) {
      const explicit = this.profiles.find((profile) => profile.id === requestedProvider);
      if (!explicit) throw Object.assign(new Error(`unknown requested provider: ${requestedProvider}`), { code: "PROVIDER_NOT_FOUND" });
      if (!health.get(explicit.id)?.available && this.policy.failOnUnavailableExplicitProvider) {
        throw Object.assign(new Error(`requested provider ${requestedProvider} is unavailable`), { code: "PROVIDER_UNAVAILABLE" });
      }
    }

    const candidates = this.profiles.map((profile) => {
      const providerHealth = health.get(profile.id) || { available: false, status: "unknown", reason: "no probe" };
      const excludedReasons = [];
      if (!profile.enabled) excludedReasons.push("disabled");
      if (allowed && !allowed.has(profile.id)) excludedReasons.push("not a team member");
      if (requestedProvider && profile.id !== requestedProvider) excludedReasons.push("not explicitly requested");
      if (specialAllowed && !specialAllowed.has(profile.id)) excludedReasons.push(`special route: ${rule.reason}`);
      if (this.policy.requireHealthyProvider && !providerHealth.available) excludedReasons.push(providerHealth.reason || "unhealthy");
      const score = routeScore(profile, providerHealth, this.policy.weights, preference.get(profile.id) || 0);
      return {
        id: profile.id,
        label: profile.label,
        role: profile.role,
        score: Number(score.toFixed(4)),
        health: providerHealth,
        excluded: excludedReasons.length > 0,
        excludedReasons,
      };
    });

    const eligible = candidates.filter((candidate) => !candidate.excluded).sort((a, b) => b.score - a.score);
    if (!eligible.length) {
      const error = new Error(`no healthy provider can satisfy ${resolvedTaskType}`);
      error.code = "NO_ROUTE";
      error.candidates = candidates;
      throw error;
    }
    const selected = eligible[0];
    const independentRequired = this.policy.independentPass?.requiredFor?.includes(risk) || false;
    const selectedProfile = this.profiles.find((profile) => profile.id === selected.id);
    const independentCandidates = independentRequired
      ? this.profiles
          .filter((profile) => profile.id !== selected.id)
          .map((profile) => {
            const providerHealth = health.get(profile.id) || { available: false, status: "unknown", reason: "no probe" };
            const excludedReasons = [];
            if (!profile.enabled) excludedReasons.push("disabled");
            if (allowed && !allowed.has(profile.id)) excludedReasons.push("not a team member");
            if (specialAllowed && !specialAllowed.has(profile.id)) excludedReasons.push(`special route: ${rule.reason}`);
            if (this.policy.requireHealthyProvider && !providerHealth.available) excludedReasons.push(providerHealth.reason || "unhealthy");
            if (this.policy.independentPass?.mustDifferFromPrimary && profile.provider === selectedProfile?.provider) {
              excludedReasons.push("same provider as primary");
            }
            const score = routeScore(profile, providerHealth, this.policy.weights);
            return {
              id: profile.id,
              label: profile.label,
              role: profile.role,
              score: Number(score.toFixed(4)),
              health: providerHealth,
              excluded: excludedReasons.length > 0,
              excludedReasons,
            };
          })
          .sort((a, b) => b.score - a.score)
      : [];
    const independent = independentCandidates.find((candidate) => !candidate.excluded) || null;
    if (independentRequired && !independent) {
      const error = new Error(`risk ${risk} requires a healthy independent provider`);
      error.code = "NO_INDEPENDENT_ROUTE";
      error.candidates = independentCandidates;
      throw error;
    }
    const specialRoute = specialAllowed
      ? { ruleId: rule.id, reason: rule.reason, allowedProviders: [...specialAllowed] }
      : null;
    return {
      taskType: resolvedTaskType,
      risk,
      selected,
      independent,
      independentRequired,
      candidates: candidates.sort((a, b) => b.score - a.score),
      reason: `${selected.label} 通过健康与团队边界，按质量、速度、健康和成本综合得分 ${selected.score}${rule?.reason ? `；规则依据：${rule.reason}` : ""}`,
      specialRoute,
      // 显式选席是用户决策，不是路由降级；即使策略首选席位已禁用也不得误标 fallback。
      fallbackUsed: !requestedProvider && Boolean(rule?.prefer?.[0] && selected.id !== rule.prefer[0]),
      preferredProvider: rule?.prefer?.[0] || null,
    };
  }
}
