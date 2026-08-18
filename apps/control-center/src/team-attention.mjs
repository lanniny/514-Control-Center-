import { ACTIVE_RUN_STATES } from "./collaboration-inbox.mjs";

export const TEAM_ATTENTION_SCHEMA = "514cc.team-attention/v1";
export const EXECUTING_RUN_STATES = new Set(
  [...ACTIVE_RUN_STATES].filter((status) => status !== "queued"),
);

const DEGRADED_HEALTH = new Set(["degraded", "warning", "external-unverified", "dormant"]);
const OFFLINE_HEALTH = new Set(["disabled", "missing", "offline", "error", "failed"]);
const READY_HEALTH = new Set(["ok", "online", "healthy", "ready", "active"]);
const GREEN_FORBIDDEN = new Set(["offline", "busy", "degraded", "unknown"]);

function shortId(value) {
  return String(value ?? "").trim();
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function matchingHealth(healthItems, memberId) {
  const needle = shortId(memberId).toLowerCase();
  if (!needle) return null;
  const items = Array.isArray(healthItems) ? healthItems : [];
  return items.find((item) => String(item?.id ?? "").toLowerCase() === needle)
    || items.find((item) => String(item?.name ?? "").toLowerCase() === needle)
    || null;
}

export function classifySeatPresence({ health = null, activeJobCount = 0 } = {}) {
  if (Number(activeJobCount) > 0) return "busy";
  const status = String(health?.rawStatus ?? health?.status ?? health?.state ?? "unknown").toLowerCase();
  if (DEGRADED_HEALTH.has(status)) return "degraded";
  if (health?.available === false || OFFLINE_HEALTH.has(status)) return "offline";
  if (READY_HEALTH.has(status) || health?.available === true) return "ready";
  return "unknown";
}

export function presenceTone(presence) {
  if (presence === "ready") return "ok";
  if (presence === "busy") return "live";
  if (presence === "degraded") return "warning";
  if (presence === "offline") return "error";
  return "neutral";
}

function teamRuns(teamId, runs) {
  const normalized = shortId(teamId);
  return (Array.isArray(runs) ? runs : []).filter((run) => (run?.teamId || "team-514cc") === normalized);
}

function seatActiveJobs(memberId, runs) {
  const id = shortId(memberId);
  return (Array.isArray(runs) ? runs : []).filter((run) => {
    if (!EXECUTING_RUN_STATES.has(String(run?.status ?? ""))) return false;
    const attempts = Array.isArray(run?.turnAttempts) ? run.turnAttempts : [];
    if (attempts.some((attempt) => attempt?.agentId === id)) return true;
    return !attempts.length && (run?.startAgentId === id);
  });
}

function rosterLastSeen(roster, memberId) {
  const agents = roster?.agents && typeof roster.agents === "object" ? roster.agents : {};
  return timestamp(agents[memberId]?.lastSeenAt || agents[memberId]?.seenAt);
}

export function collectTeamAttention({
  teamId,
  team,
  inbox,
  runs = [],
  healthItems = [],
  roster = {},
  now = new Date().toISOString(),
} = {}) {
  const normalizedTeamId = shortId(teamId || team?.id);
  if (!normalizedTeamId || !inbox || inbox.team?.id !== normalizedTeamId) {
    throw Object.assign(new Error("attention projection requires a matching team inbox"), {
      code: "VALIDATION_FAILED",
    });
  }
  const scoped = teamRuns(normalizedTeamId, runs);
  const queued = scoped.filter((run) => String(run?.status ?? "") === "queued").map((run) => ({
    id: shortId(run.id),
    title: String(run.title || run.prompt || run.id).slice(0, 180),
    status: run.status,
    updatedAt: timestamp(run.updatedAt || run.createdAt),
  }));
  const activeJobs = scoped.filter((run) => EXECUTING_RUN_STATES.has(String(run?.status ?? ""))).map((run) => ({
    id: shortId(run.id),
    title: String(run.title || run.prompt || run.id).slice(0, 180),
    status: run.status,
    updatedAt: timestamp(run.updatedAt || run.createdAt),
    agentId: run.startAgentId || run.coordinatorId || null,
  }));
  const members = Array.isArray(team?.members) ? [...new Set(team.members.map(shortId).filter(Boolean))] : [];
  const seats = members.map((id) => {
    const jobs = seatActiveJobs(id, scoped);
    const health = matchingHealth(healthItems, id);
    const presence = classifySeatPresence({ health, activeJobCount: jobs.length });
    return {
      id,
      presence,
      tone: presenceTone(presence),
      activeJobId: jobs[0]?.id || null,
      activeJobCount: jobs.length,
      lastSeen: rosterLastSeen(roster, id),
      healthStatus: String(health?.status ?? "unknown"),
    };
  });
  if (seats.some((seat) => GREEN_FORBIDDEN.has(seat.presence) && seat.tone === "ok")) {
    throw Object.assign(new Error("attention presence leaked a green tone"), { code: "ATTENTION_TONE_LEAK" });
  }
  const pendingAsks = Array.isArray(inbox.pendingAsks) ? inbox.pendingAsks : [];
  const blockedRuns = Array.isArray(inbox.blockedRuns) ? inbox.blockedRuns : [];
  const notifications = new Map();
  const remember = (runId, item) => {
    const key = runId || normalizedTeamId;
    const group = notifications.get(key) || { teamId: normalizedTeamId, runId: runId || null, items: [] };
    group.items.push(item);
    notifications.set(key, group);
  };
  for (const ask of pendingAsks) {
    remember(ask.runId, { kind: "ask", id: ask.id, text: ask.text, needsOperator: true });
  }
  for (const run of blockedRuns) {
    remember(run.id, { kind: "blocked", id: run.id, text: run.title, reason: run.status });
  }
  const generatedAt = timestamp(now) || new Date().toISOString();
  const counts = {
    queueDepth: queued.length,
    activeJobs: activeJobs.length,
    activeSeats: seats.filter((seat) => seat.presence === "busy").length,
    pendingAskCount: pendingAsks.length,
    blockedCount: blockedRuns.length,
  };
  if (counts.pendingAskCount !== (inbox.diagnostics?.pendingAskCount ?? pendingAsks.length)) {
    throw Object.assign(new Error("attention pendingAskCount drifted from inbox"), {
      code: "ATTENTION_COUNT_DRIFT",
    });
  }
  return {
    schema: TEAM_ATTENTION_SCHEMA,
    team: inbox.team,
    generatedAt,
    fetchSeq: Date.parse(generatedAt) || 0,
    inbox,
    queue: {
      pending: queued,
      activeJobs,
      activeJobId: activeJobs[0]?.id || null,
    },
    seats,
    notifications: [...notifications.values()],
    counts,
  };
}
