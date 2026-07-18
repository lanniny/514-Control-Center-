const taskCapabilities = {
  planning: ["planning", "orchestration"],
  requirements: ["requirements", "planning"],
  coordination: ["orchestration", "delegation"],
  coding: ["coding", "execution"],
  debugging: ["debugging", "coding"],
  review: ["review", "architecture"],
  architecture: ["architecture", "planning"],
  testing: ["testing", "coding"],
  "current-research": ["current-research", "web-search"],
  "web-search": ["web-search", "research"],
  "long-context": ["long-context", "document-analysis"],
  multimodal: ["multimodal", "document-analysis"],
  "document-analysis": ["document-analysis", "long-context"],
  "resident-session": ["resident-session", "extensions"],
  "extension-work": ["extensions", "custom-tools"],
};

export function classifyTask(prompt = "") {
  const tests = [
    ["current-research", /最新|当前|今天|实时|搜索|search|news|202[5-9]/i],
    ["multimodal", /图片|视频|音频|截图|image|video|multimodal/i],
    ["long-context", /长文档|全文|超过\s*\d+\s*(?:kb|mb)|long[- ]?context|document/i],
    ["review", /评审|审计|review|security|安全/i],
    ["debugging", /修复|报错|错误|异常|故障|debug|bug|exception|失败/i],
    ["coding", /实现|写代码|开发|编码|implement|code|build/i],
    ["planning", /规划|方案|架构|设计|plan|architecture/i],
  ];
  return tests.find(([, pattern]) => pattern.test(prompt))?.[0] || "planning";
}

function capabilityScore(profile, required) {
  if (!required.length) return 0.5;
  const present = new Set(profile.capabilities);
  return required.filter((capability) => present.has(capability)).length / required.length;
}

export class ModelRouter {
  constructor({ profiles, policy, healthService }) {
    this.profiles = profiles;
    this.policy = policy;
    this.healthService = healthService;
  }

  async preview({ prompt = "", taskType, requestedProvider, risk = "normal", needsCurrentSource = false, allowedProviders = null } = {}) {
    // 团队成员白名单（514cc 团队体系）：非成员从主选与独立验证候选中一并排除。
    // 只要传了数组就建集合——空白名单必须 fail-closed 产生 NO_ROUTE，绝不退化为"不设限制"（烛 R10 致命1）
    const allowed = Array.isArray(allowedProviders) ? new Set(allowedProviders) : null;
    const resolvedTaskType = needsCurrentSource ? "current-research" : taskType || classifyTask(prompt);
    const required = taskCapabilities[resolvedTaskType] || [resolvedTaskType];
    const health = await this.healthService.map();
    const rule = this.policy.rules.find((item) => item.taskTypes.includes(resolvedTaskType));
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
      if (this.policy.requireHealthyProvider && !providerHealth.available) excludedReasons.push(providerHealth.reason || "unhealthy");
      const match = capabilityScore(profile, required);
      if (match === 0) excludedReasons.push("no required capability match");
      const healthValue = providerHealth.status === "online" ? 1 : providerHealth.status === "degraded" ? 0.5 : 0;
      const score =
        match * this.policy.weights.capability +
        profile.quality * this.policy.weights.quality +
        profile.speed * this.policy.weights.speed +
        healthValue * this.policy.weights.health +
        ((6 - profile.costTier) / 5) * this.policy.weights.cost +
        (preference.get(profile.id) || 0);
      return {
        id: profile.id,
        label: profile.label,
        role: profile.role,
        score: Number(score.toFixed(4)),
        capabilityMatch: Number(match.toFixed(2)),
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
    const independentCapabilities = this.policy.independentPass?.capabilities || ["review", "architecture", "synthesis"];
    const selectedProfile = this.profiles.find((profile) => profile.id === selected.id);
    const independentCandidates = independentRequired
      ? this.profiles
          .filter((profile) => profile.id !== selected.id)
          .map((profile) => {
            const providerHealth = health.get(profile.id) || { available: false, status: "unknown", reason: "no probe" };
            const excludedReasons = [];
            if (!profile.enabled) excludedReasons.push("disabled");
            if (allowed && !allowed.has(profile.id)) excludedReasons.push("not a team member");
            if (this.policy.requireHealthyProvider && !providerHealth.available) excludedReasons.push(providerHealth.reason || "unhealthy");
            if (this.policy.independentPass?.mustDifferFromPrimary && profile.provider === selectedProfile?.provider) {
              excludedReasons.push("same provider as primary");
            }
            const match = capabilityScore(profile, independentCapabilities);
            if (match === 0) excludedReasons.push("no independent-review capability");
            const healthValue = providerHealth.status === "online" ? 1 : providerHealth.status === "degraded" ? 0.5 : 0;
            const score =
              match * this.policy.weights.capability +
              profile.quality * this.policy.weights.quality +
              profile.speed * this.policy.weights.speed +
              healthValue * this.policy.weights.health +
              ((6 - profile.costTier) / 5) * this.policy.weights.cost;
            return {
              id: profile.id,
              label: profile.label,
              role: profile.role,
              score: Number(score.toFixed(4)),
              capabilityMatch: Number(match.toFixed(2)),
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
    return {
      taskType: resolvedTaskType,
      risk,
      requiredCapabilities: required,
      selected,
      independent,
      independentRequired,
      candidates: candidates.sort((a, b) => b.score - a.score),
      reason: `${selected.label} 具备 ${required.join(" + ")}，当前健康状态 ${selected.health.status}，综合得分 ${selected.score}`,
      fallbackUsed: Boolean(rule?.prefer?.[0] && selected.id !== rule.prefer[0]),
      preferredProvider: rule?.prefer?.[0] || null,
    };
  }
}
