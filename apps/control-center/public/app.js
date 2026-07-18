import { renderMarkdown } from "./markdown.js";

const API = Object.freeze({
  bootstrap: "/api/bootstrap",
  health: "/api/health",
  sources: "/api/config/sources",
  runs: "/api/runs",
  routerPreview: "/api/router/preview",
  events: "/api/events",
  approvals: "/api/approvals",
  runtimeReload: "/api/runtime/reload",
  obsSummary: "/api/observability/summary",
  obsRouteGate: "/api/observability/routegate",
  obsDelta: "/api/observability/delta",
  obsHandoffs: "/api/observability/handoffs",
  obsDrift: "/api/observability/drift",
  sessions: "/api/sessions",
  sessionProjects: "/api/sessions/projects",
  teams: "/api/teams",
});

const TOKEN_KEY = "514cc-control-token";
let accessToken = "";

const VIEW_TITLES = Object.freeze({
  overview: "系统总览",
  workbench: "协作台",
  config: "配置中心",
  router: "模型路由",
  security: "安全诊断",
  observability: "体系观测",
  sessions: "会话聚合",
});

const ACTIVE_RUN_STATES = new Set([
  "queued",
  "waiting_agent",
  "waiting_approval",
  "planning",
  "waiting_for_approval",
  "executing",
  "integrating",
  "verifying",
  "active",
  "running",
  "recovery_required",
]);

const TERMINAL_RUN_STATES = new Set(["complete", "completed", "succeeded", "failed", "blocked", "cancelled", "canceled"]);

const DEFAULT_COMPONENTS = Object.freeze([
  { id: "control-api", name: "Control API", detail: "/api/bootstrap", status: "pending" },
  { id: "claude", name: "Claude 主脑", detail: "规划与统一编排", status: "unknown" },
  { id: "codex", name: "Codex 技术执行", detail: "实现、评审与验证", status: "unknown" },
  { id: "event-bus", name: "事件总线", detail: "SSE /api/events", status: "pending" },
]);

const DEFAULT_MODELS = Object.freeze([
  { role: "主脑", adapter: "Claude CLI", model: "运行时选择", strengths: ["规划", "编排", "综合"], status: "unknown" },
  { role: "技术", adapter: "Codex CLI", model: "运行时选择", strengths: ["实现", "代码评审", "验证"], status: "unknown" },
  { role: "搜索", adapter: "Grok Search", model: "运行时选择", strengths: ["当前资料", "快速检索"], status: "unknown" },
  { role: "快执行", adapter: "Grok Build", model: "grok-4.5", strengths: ["快执行", "快综合"], status: "unknown" },
  { role: "扩展", adapter: "Pi", model: "运行时选择", strengths: ["RPC", "工具编排"], status: "unknown" },
]);

const DEFAULT_POLICIES = Object.freeze([
  { name: "Plan / Review", detail: "只读模式", value: "禁止写入", status: "ok" },
  { name: "Build", detail: "授权工作区内写入", value: "按动作审批", status: "ok" },
  { name: "危险操作", detail: "删除、部署、密钥与系统配置", value: "二次确认", status: "warning" },
  { name: "保护路径", detail: ".env、凭据、.git 与系统目录", value: "默认拒绝", status: "ok" },
]);

const DEFAULT_SECRETS = Object.freeze([
  { name: "Claude Provider", reference: "secret reference", configured: null },
  { name: "Grok Search", reference: "secret reference", configured: null },
  { name: "MCP Connectors", reference: "environment references", configured: null },
]);

const state = {
  view: "workbench",
  bootstrap: {},
  health: null,
  components: [...DEFAULT_COMPONENTS],
  sources: [],
  sourceFilter: "",
  selectedSourceId: null,
  config: null,
  versions: [],
  pendingPlan: null,
  configBusy: false,
  runs: [],
  selectedRunId: null,
  events: [],
  routePreview: null,
  models: [...DEFAULT_MODELS],
  policies: [...DEFAULT_POLICIES],
  secrets: [...DEFAULT_SECRETS],
  approvals: [],
  diagnostics: [],
  diagnosticLog: [],
  apiState: "pending",
  eventState: "pending",
  eventController: null,
  lastEventSequence: 0,
  obsRouteGate: null,
  obsDelta: null,
  obsHandoffs: [],
  obsSummary: null,
  obsDrift: null,
  obsLoaded: false,
  sessionsData: null,
  sessionsError: null,
  projectsData: null,
  expandedProjects: new Set(),
  // 历史对话摘要默认关闭（烛 R5 致命1：summaries=1 固定开会绕过"摘要 opt-in"隐私纪律）；
  // opt-in 记在 sessionStorage——与访问 token 同生命周期，重开 Console 需重新选择
  projectSummaries: false,
  sessionPreview: null,
  previewSeq: 0,
  projectsSeq: 0,
  teams: [],
  selectedTeamId: "team-514cc",
  editingTeamId: null,
  // recovery 死路：确认恢复的 run id——下一次续聊自动带 acknowledgeRecovery:true（orchestrator 584-590）
  recoveryAckRunId: null,
};

const elements = {};
const byId = (id) => document.getElementById(id);

class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function cacheElements() {
  [
    "current-view-title",
    "api-connection-badge",
    "theme-toggle",
    "sidebar-status-dot",
    "sidebar-status-label",
    "sidebar-version",
    "refresh-button",
    "metric-services",
    "metric-services-detail",
    "metric-runs",
    "metric-runs-detail",
    "metric-sources",
    "metric-sources-detail",
    "metric-events",
    "metric-events-detail",
    "health-updated",
    "health-summary",
    "health-list",
    "overview-run-list",
    "overview-event-body",
    "event-sequence",
    "workbench-run-status",
    "run-count",
    "clear-runs-button",
    "workbench-run-list",
    "team-picker",
    "manage-teams-button",
    "team-dialog",
    "team-form",
    "team-dialog-title",
    "team-builtin-note",
    "team-new-button",
    "team-close-button",
    "team-name-input",
    "team-description-input",
    "team-prompt-input",
    "team-members-list",
    "team-skills-input",
    "team-mcp-input",
    "team-delete-button",
    "team-cancel-button",
    "team-save-button",
    "project-count",
    "project-summaries-toggle",
    "workbench-project-tree",
    "conversation-title",
    "conversation-meta",
    "cancel-run-button",
    "conversation-stream",
    "recovery-bar",
    "followup-agent",
    "followup-agent-pick",
    "task-form",
    "task-input",
    "task-current-source",
    "task-model",
    "task-model-pick",
    "composer-mode-hint",
    "composer-new-task",
    "composer-cwd",
    "new-session-button",
    "session-dialog",
    "session-form",
    "session-cwd-input",
    "session-cwd-hint",
    "session-close-button",
    "session-cancel-button",
    "session-browse-button",
    "project-paths",
    "rail-statusline",
    "submit-task-button",
    "route-decision",
    "session-topology",
    "event-live-state",
    "workbench-event-list",
    "config-global-status",
    "source-count",
    "source-filter",
    "source-list",
    "editor-title",
    "editor-path",
    "validate-config-button",
    "plan-config-button",
    "apply-config-button",
    "config-format",
    "config-scope",
    "config-sha",
    "config-edit-state",
    "readonly-banner",
    "readonly-title",
    "readonly-detail",
    "config-editor",
    "editor-cursor-status",
    "editor-validation-status",
    "version-list",
    "diff-summary",
    "diff-output",
    "router-status",
    "router-form",
    "router-prompt",
    "router-kind",
    "router-risk",
    "router-current-source",
    "route-result-meta",
    "router-primary-decision",
    "router-decision-facts",
    "router-reason-list",
    "router-candidate-body",
    "model-table-body",
    "security-summary",
    "policy-list",
    "secret-list",
    "approval-summary",
    "approval-list",
    "diagnostics-updated",
    "run-diagnostics-button",
    "reload-runtime-button",
    "diagnostics-table-body",
    "diagnostic-log",
    "copy-log-button",
    "action-dialog",
    "dialog-eyebrow",
    "dialog-title",
    "dialog-body",
    "dialog-confirm-button",
    "toast-region",
    "obs-refresh-button",
    "obs-routegate-count",
    "obs-routegate-detail",
    "obs-delta-count",
    "obs-delta-detail",
    "obs-fire-days",
    "obs-fire-detail",
    "obs-drift-status",
    "obs-drift-button",
    "obs-routegate-body",
    "obs-delta-body",
    "obs-drift-body",
    "obs-handoff-body",
    "obs-handoff-meta",
    "obs-handoff-content",
    "sessions-refresh-button",
    "sessions-summaries-toggle",
    "sessions-groups",
  ].forEach((id) => {
    elements[id] = byId(id);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function redact(value) {
  return String(value ?? "")
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/(basic\s+)[a-z0-9+/=]{12,}/gi, "$1[REDACTED]")
    .replace(/((?:api[-_]?key|access[-_]?key|secret|token|password|passwd|passphrase|auth(?:orization)?|credential|private[-_]?key|cookie)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-(?:proj-)?|xai-|gh[pousr]_|github_pat_)[a-z0-9_.-]{12,}\b/gi, "[REDACTED]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function unwrapList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of [...keys, "items", "data", "results"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function objectList(payload, keys = []) {
  const list = unwrapList(payload, keys);
  if (list.length) return list;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) {
    const value = payload[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.entries(value).map(([id, item]) =>
        item && typeof item === "object" ? { id, ...item } : { id, status: item },
      );
    }
  }
  return [];
}

function normalizeStatus(value) {
  if (value === true) return "ok";
  if (value === false) return "error";
  const raw = String(value ?? "unknown").toLowerCase().replaceAll("-", "_");
  if (["ok", "healthy", "ready", "connected", "online", "available", "consistent", "pass", "passed"].includes(raw)) return "ok";
  if (["warn", "warning", "degraded", "drift", "stale", "partial", "pending", "connecting", "external_unverified", "unconfigured", "disabled"].includes(raw)) return raw === "pending" || raw === "connecting" ? "pending" : "warning";
  if (["error", "failed", "down", "offline", "unavailable", "invalid", "blocked", "missing"].includes(raw)) return "error";
  return "unknown";
}

function statusText(value) {
  const status = normalizeStatus(value);
  return {
    ok: "正常",
    warning: "需关注",
    error: "异常",
    pending: "检查中",
    unknown: "未知",
  }[status];
}

function runStatusText(value) {
  const status = String(value ?? "unknown").toLowerCase().replaceAll("-", "_");
  return {
    planning: "规划中",
    waiting_for_approval: "等待审批",
    waiting_approval: "等待审批",
    waiting_agent: "等待 Agent",
    recovery_required: "需人工恢复",
    queued: "已排队",
    executing: "执行中",
    running: "执行中",
    active: "执行中",
    integrating: "综合中",
    verifying: "验证中",
    complete: "已完成",
    completed: "已完成",
    succeeded: "已完成",
    blocked: "已阻塞",
    failed: "失败",
    cancelled: "已取消",
    canceled: "已取消",
  }[status] ?? "未知";
}

function formatDate(value, fallback = "--") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatTime(value, fallback = "--") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const milliseconds = number > 0 && number < 20 ? number * 1000 : number;
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10000 ? 1 : 0)} s`;
}

function compactHash(value) {
  const hash = String(value ?? "").trim();
  if (!hash) return "--";
  return hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function getVersion() {
  return (
    state.bootstrap.version ??
    state.bootstrap.system?.version ??
    state.bootstrap.runtime?.version ??
    "514cc runtime"
  );
}

async function request(path, options = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  const init = { method, headers, signal: options.signal };
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    throw new ApiError(`无法连接控制面：${error?.message ?? error}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let payload = null;
  try {
    payload = contentType.includes("json") ? await response.json() : await response.text();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = payload && typeof payload === "object" ? payload.error : null;
    const detail =
      errorPayload && typeof errorPayload === "object"
        ? errorPayload.message ?? errorPayload.detail ?? errorPayload.code
        : errorPayload ?? (payload && typeof payload === "object" ? payload.message ?? payload.detail : payload);
    throw new ApiError(detail ? String(detail) : `${method} ${path} 返回 HTTP ${response.status}`, response.status, payload);
  }
  return payload;
}

function initializeAccessToken() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const fragmentToken = fragment.get("token")?.trim() ?? "";
  if (fragmentToken) {
    sessionStorage.setItem(TOKEN_KEY, fragmentToken);
    accessToken = fragmentToken;
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    return;
  }
  accessToken = sessionStorage.getItem(TOKEN_KEY) ?? "";
}

// ===== 主题：亮色暖纸 / 暗色暖墨 =====
// data-theme 首帧由 theme.js（<head> 同步脚本）落好；这里负责开关、持久化与系统偏好跟随
const THEME_KEY = "514cc-control-theme";
const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function applyTheme(theme, { persist = true } = {}) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {}
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#171512" : "#faf9f5");
  const toggle = elements["theme-toggle"];
  if (toggle) {
    toggle.querySelector("use")?.setAttribute("href", next === "dark" ? "#icon-sun" : "#icon-moon");
    toggle.title = next === "dark" ? "切换为浅色" : "切换为深色";
    toggle.setAttribute("aria-label", toggle.title);
  }
}

function initializeTheme() {
  // theme.js 已按存储值/系统偏好预设了 data-theme——此处补齐开关图标与 meta
  applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light", { persist: false });
  elements["theme-toggle"]?.addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  });
  themeMedia.addEventListener("change", (event) => {
    if (!readStoredTheme()) applyTheme(event.matches ? "dark" : "light", { persist: false }); // 未显式选择过才跟随系统
  });
}

function setApiState(next, detail = "") {
  state.apiState = next;
  const badge = elements["api-connection-badge"];
  const dot = badge.querySelector(".status-dot");
  const label = badge.querySelector("span:last-child");
  const normalized = normalizeStatus(next);
  badge.className = `connection-badge is-${normalized}`;
  dot.className = `status-dot is-${normalized}`;
  label.textContent = normalized === "ok" ? "API 已连接" : normalized === "error" ? "API 未连接" : "API 连接中";
  badge.title = detail || label.textContent;

  elements["sidebar-status-dot"].className = `status-dot is-${normalized}`;
  elements["sidebar-status-label"].textContent = label.textContent;
  elements["sidebar-version"].textContent = String(getVersion());
}

function setEventState(next) {
  state.eventState = next;
  const normalized = normalizeStatus(next);
  const connected = normalized === "ok";
  elements["metric-events"].textContent = connected ? "已连接" : normalized === "error" ? "已断开" : "连接中";
  elements["metric-events-detail"].textContent = connected ? `${state.events.length} 条会话事件` : "SSE /api/events";
  elements["event-live-state"].textContent = connected ? "实时" : normalized === "error" ? "重连中" : "连接中";
  elements["event-live-state"].className = `event-live-state is-${normalized}`;
}

function toast(message, type = "info", duration = 3600) {
  const item = document.createElement("div");
  item.className = `toast is-${type}`;
  item.textContent = redact(message);
  elements["toast-region"].append(item);
  window.setTimeout(() => item.remove(), duration);
}

function appendDiagnostic(message, level = "info") {
  const now = new Date().toISOString();
  state.diagnosticLog.unshift(`[${now}] [${level.toUpperCase()}] ${redact(message)}`);
  state.diagnosticLog = state.diagnosticLog.slice(0, 120);
  renderDiagnosticLog();
}

function normalizeSource(item, index) {
  const path = item.path ?? item.file ?? item.source_path ?? item.source ?? "";
  const id = String(item.id ?? item.key ?? item.source_id ?? path ?? `source-${index}`);
  const format = String(item.format ?? item.kind ?? item.type ?? path.split(".").pop() ?? "text").toLowerCase();
  const scope = String(item.scope ?? item.layer ?? item.zone ?? "source").toLowerCase();
  const secret = Boolean(item.secret ?? item.is_secret ?? (scope === "secret" || format === "secret"));
  const runtime = Boolean(item.runtime ?? item.is_runtime ?? (scope === "runtime" || scope === "generated"));
  const explicitReadOnly = item.read_only ?? item.readOnly ?? (item.writable === false ? true : null);
  const transactionBlocked = Boolean(item.transactionBlocked ?? item.transaction_blocked);
  return {
    ...item,
    id,
    name: String(item.name ?? item.label ?? path.split(/[\\/]/).pop() ?? id),
    path: String(path || id),
    format,
    scope,
    secret,
    runtime,
    transactionBlocked,
    readOnly: Boolean(explicitReadOnly ?? false) || secret || runtime || transactionBlocked,
    status: String(item.status ?? item.sync_status ?? item.state ?? "unknown").toLowerCase(),
    sha256: String(item.sha256 ?? item.sha ?? item.etag ?? ""),
  };
}

function normalizeRun(item, index) {
  const id = String(item.id ?? item.run_id ?? item.runId ?? `run-${index}`);
  const prompt = item.prompt ?? item.task ?? item.message ?? item.input ?? "";
  const route = item.route ?? item.routing ?? item.decision ?? null;
  const rawSessions = item.sessions ?? item.agents ?? [];
  const sessions = Array.isArray(rawSessions)
    ? rawSessions
    : rawSessions && typeof rawSessions === "object"
      ? Object.entries(rawSessions).map(([agentId, sessionId]) => ({ agentId, sessionId, name: agentId, role: agentId === "claude-fable" ? "orchestrator" : "worker" }))
      : [];
  return {
    ...item,
    id,
    title: String(item.title ?? item.name ?? String(prompt).slice(0, 60) ?? `任务 ${index + 1}`),
    prompt: String(prompt),
    status: String(item.status ?? item.state ?? "planning").toLowerCase().replaceAll("-", "_"),
    risk: String(item.risk_level ?? item.risk ?? "unknown"),
    createdAt: item.created_at ?? item.createdAt ?? item.started_at ?? item.startedAt ?? null,
    updatedAt: item.updated_at ?? item.updatedAt ?? item.finished_at ?? item.finishedAt ?? null,
    route,
    sessions,
    messages: unwrapList(item.messages ?? item.turns ?? [], ["messages", "turns"]),
  };
}

function normalizeComponent(item, index) {
  return {
    ...item,
    id: String(item.id ?? item.key ?? item.name ?? `component-${index}`),
    name: String(item.name ?? item.label ?? item.id ?? `组件 ${index + 1}`),
    detail: String(item.detail ?? item.description ?? item.message ?? item.version ?? ""),
    status: normalizeStatus(item.status ?? item.state ?? item.ok),
    latency: item.latency_ms ?? item.latency ?? item.duration_ms ?? null,
  };
}

function normalizeModel(item, index) {
  const capabilities = item.strengths ?? item.capabilities ?? item.roles ?? [];
  return {
    ...item,
    id: String(item.id ?? item.model_id ?? item.key ?? `model-${index}`),
    role: String(item.role ?? item.assignment ?? item.category ?? "候选"),
    adapter: String(item.adapter ?? item.provider ?? item.cli ?? "adapter"),
    model: String(item.model ?? item.model_id ?? item.name ?? item.label ?? item.id ?? "运行时选择"),
    strengths: Array.isArray(capabilities) ? capabilities.map(String) : [String(capabilities)],
    status: normalizeStatus(item.status ?? item.availability ?? item.available ?? item.enabled),
    verifiedAt:
      item.last_verified_at ??
      item.verified_at ??
      item.checked_at ??
      (Array.isArray(item.evidence) ? item.evidence.map((entry) => entry.verifiedAt ?? entry.verified_at).filter(Boolean).sort().at(-1) : null),
  };
}

function normalizeHealth(payload) {
  const components = objectList(payload, ["components", "services", "checks"]);
  if (components.length) return components.map(normalizeComponent);
  const status = normalizeStatus(payload?.status ?? payload?.state ?? payload?.ok);
  return DEFAULT_COMPONENTS.map((item) =>
    item.id === "control-api" ? { ...item, status: status === "unknown" ? "ok" : status } : { ...item },
  );
}

function normalizeRoute(payload) {
  const data = payload?.route ?? payload?.decision ?? payload ?? {};
  const primaryRaw = data.primary ?? data.selected ?? data.chosen ?? data.model ?? data.agent ?? {};
  const primary =
    typeof primaryRaw === "string"
      ? { name: primaryRaw, adapter: primaryRaw }
      : {
          ...primaryRaw,
          name: String(primaryRaw.label ?? primaryRaw.name ?? primaryRaw.model ?? primaryRaw.id ?? primaryRaw.agent ?? "未选择"),
          adapter: String(primaryRaw.adapter ?? primaryRaw.provider ?? primaryRaw.cli ?? primaryRaw.role ?? ""),
        };
  const reasonsRaw = data.reasons ?? data.reason ?? data.explanation ?? data.rationale ?? [];
  const reasons = Array.isArray(reasonsRaw) ? reasonsRaw.map(String) : reasonsRaw ? [String(reasonsRaw)] : [];
  const candidates = unwrapList(data.candidates ?? [], ["candidates"]);
  return {
    ...data,
    primary,
    reasons,
    candidates,
    confidence: data.confidence ?? data.score ?? "--",
    policy: data.policy ?? data.rule ?? data.route_gate ?? "--",
    verifier: data.independent ?? data.verifier ?? data.review_by ?? data.required_verifier ?? "--",
    createdAt: data.created_at ?? data.timestamp ?? new Date().toISOString(),
  };
}

function extractBootstrapData(payload) {
  if (!payload || typeof payload !== "object") return;
  state.bootstrap = payload;

  const models = objectList(payload, ["providers", "models", "model_registry", "adapters"]);
  if (models.length) state.models = models.map(normalizeModel);

  const policies = objectList(payload.permissions ?? payload.security ?? payload, ["permissions", "policies", "permission_policies", "modes"]);
  if (policies.length) {
    state.policies = policies.map((item, index) => ({
      name: String(item.name ?? item.label ?? item.id ?? `策略 ${index + 1}`),
      detail: String(item.detail ?? item.description ?? item.scope ?? ""),
      value: String(item.value ?? item.decision ?? item.mode ?? item.status ?? "已加载"),
      status: normalizeStatus(item.status ?? item.state ?? "ok"),
    }));
  }

  const secrets = objectList(payload.security ?? payload, ["secrets", "secret_refs", "credentials"]);
  if (secrets.length) {
    state.secrets = secrets.map((item, index) => ({
      name: String(item.name ?? item.label ?? item.id ?? `Secret ${index + 1}`),
      reference: String(item.reference ?? item.ref ?? item.provider ?? "secure reference"),
      configured: item.configured ?? item.available ?? item.present ?? null,
      fingerprint: item.fingerprint ?? item.last4 ?? "",
    }));
  }

  const sources = unwrapList(payload, ["sources", "config_sources"]);
  if (sources.length && !state.sources.length) state.sources = sources.map(normalizeSource);
  const runs = unwrapList(payload, ["runs", "active_runs"]);
  if (runs.length && !state.runs.length) state.runs = runs.map(normalizeRun);
  state.approvals = unwrapList(payload, ["approvals"]);
  if (payload.health) {
    state.health = payload.health;
    state.components = normalizeHealth(payload.health);
    applyHealthToModels(payload.health);
  }
  if (payload.routing && (payload.routing.primary || payload.routing.selected || payload.routing.decision)) {
    state.routePreview = normalizeRoute(payload.routing);
  }
}

function applyHealthToModels(healthPayload) {
  const healthItems = objectList(healthPayload, ["items", "components", "services", "checks"]);
  const byProvider = new Map(healthItems.map((item) => [String(item.id ?? item.key ?? item.name), item]));
  state.models = state.models.map((model) => {
    const health = byProvider.get(String(model.id));
    return health
      ? {
          ...model,
          status: normalizeStatus(health.status ?? health.available),
          verifiedAt: health.checked_at ?? health.timestamp ?? model.verifiedAt,
          version: health.version ?? model.version,
        }
      : model;
  });
}

async function loadBootstrap() {
  const payload = await request(API.bootstrap);
  extractBootstrapData(payload);
  elements["sidebar-version"].textContent = String(getVersion());
  renderModels();
  renderSecurity();
  return payload;
}

async function loadHealth() {
  const started = performance.now();
  try {
    const payload = await request(API.health);
    state.health = payload;
    state.components = normalizeHealth(payload);
    applyHealthToModels(payload);
    state.diagnostics = upsertDiagnostic(state.diagnostics, {
      path: API.health,
      method: "GET",
      status: "ok",
      latency: performance.now() - started,
      result: payload?.status ?? "响应正常",
    });
    return payload;
  } catch (error) {
    state.components = DEFAULT_COMPONENTS.map((item) =>
      item.id === "control-api" ? { ...item, status: "error", detail: error.message } : { ...item },
    );
    state.diagnostics = upsertDiagnostic(state.diagnostics, {
      path: API.health,
      method: "GET",
      status: "error",
      latency: performance.now() - started,
      result: error.message,
    });
    throw error;
  } finally {
    renderOverview();
    renderDiagnostics();
  }
}

async function loadSources({ preserveSelection = true } = {}) {
  const payload = await request(API.sources);
  state.sources = unwrapList(payload, ["sources", "config_sources"]).map(normalizeSource);
  if (!preserveSelection || !state.sources.some((item) => item.id === state.selectedSourceId)) {
    state.selectedSourceId = state.sources[0]?.id ?? null;
  }
  renderSources();
  renderOverview();
  return payload;
}

async function loadRuns() {
  const payload = await request(API.runs);
  state.runs = unwrapList(payload, ["runs"]).map(normalizeRun);
  if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId)) state.selectedRunId = null;
  if (!state.selectedRunId) {
    state.selectedRunId = state.runs.find((run) => ACTIVE_RUN_STATES.has(run.status))?.id ?? state.runs[0]?.id ?? null;
  }
  renderRuns();
  renderOverview();
  return payload;
}

async function loadApprovals() {
  const payload = await request(API.approvals);
  state.approvals = unwrapList(payload, ["approvals"]);
  renderApprovals();
  renderSelectedRun(); // 内联审批卡挂在协作台会话流末尾，与安全诊断列表同一份数据同步刷新
  return payload;
}

async function loadInitial() {
  setApiState("pending");
  appendDiagnostic("开始加载控制面 bootstrap、health、配置索引与任务列表");
  let earlySuccess = false;
  const track = (job) =>
    job.then((value) => {
      if (!earlySuccess) {
        earlySuccess = true;
        setApiState("ok");
      }
      return value;
    });
  const sourcesJob = loadSources().then(async (payload) => {
    if (state.selectedSourceId && !state.config) await loadSelectedConfig();
    return payload;
  });
  const jobs = [track(loadBootstrap()), track(loadHealth()), track(sourcesJob), track(loadRuns()), track(loadApprovals())];
  const settled = await Promise.allSettled(jobs);
  const successes = settled.filter((item) => item.status === "fulfilled").length;
  if (successes > 0) {
    setApiState("ok");
    appendDiagnostic(`控制面初始化完成：${successes}/${settled.length} 个端点成功`);
  } else {
    setApiState("error", "所有初始化端点均不可用");
    appendDiagnostic("控制面初始化失败：所有端点均不可用", "error");
  }

  settled.forEach((item) => {
    if (item.status === "rejected") appendDiagnostic(item.reason?.message ?? item.reason, "warning");
  });
  renderAll();
}

function setView(view, { updateHash = true, focus = true } = {}) {
  if (!VIEW_TITLES[view]) return;
  state.view = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  elements["current-view-title"].textContent = VIEW_TITLES[view];
  document.title = `${VIEW_TITLES[view]} · 514cc Control Center`;
  if (updateHash) history.replaceState(null, "", `#${view}`);
  if (focus) {
    const heading = byId(`view-${view}`)?.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1"); // h1 默认不可聚焦——切页焦点迁移需显式 tabindex（烛建议）
      heading.focus?.({ preventScroll: true });
    }
  }

  if (view === "security" && state.diagnostics.length === 0) void runDiagnostics();
  if (view === "observability" && !state.obsLoaded) void loadObservability();
  if (view === "sessions" && !state.sessionsData) void loadSessions();
  if (view === "workbench" && !state.projectsData) void loadProjects();
  if (view === "workbench" && !state.teams.length) void loadTeams();
}

async function loadObservability() {
  state.obsLoaded = true;
  try {
    const [summary, routeGate, delta, handoffs] = await Promise.all([
      request(API.obsSummary),
      request(API.obsRouteGate),
      request(API.obsDelta),
      request(API.obsHandoffs),
    ]);
    state.obsSummary = summary;
    state.obsRouteGate = routeGate;
    state.obsDelta = delta;
    state.obsHandoffs = handoffs.handoffs ?? [];
  } catch (error) {
    state.obsLoaded = false;
    const failRow = (cols) => `<tr><td colspan="${cols}" class="subtle">加载失败：${escapeHtml(error.message)} — 点击「刷新数据」重试</td></tr>`;
    elements["obs-routegate-body"].innerHTML = failRow(4);
    elements["obs-delta-body"].innerHTML = failRow(3);
    elements["obs-handoff-body"].innerHTML = failRow(4);
    toast(`体系观测数据加载失败：${error.message}`, "error");
    return; // 失败行不进 renderObservability——handoff 表会被空 state 无条件重绘成"暂无"，失败态要留住
  }
  renderObservability();
}

async function runDriftCheck() {
  elements["obs-drift-button"].disabled = true;
  elements["obs-drift-status"].textContent = "检查中…";
  try {
    state.obsDrift = await request(API.obsDrift, { method: "POST" });
  } catch (error) {
    state.obsDrift = null;
    elements["obs-drift-status"].textContent = "检查失败";
    elements["obs-drift-body"].innerHTML = `<tr><td colspan="2" class="subtle">检查失败：${escapeHtml(error.message)}</td></tr>`;
    toast(`漂移检查失败：${error.message}`, "error");
  } finally {
    elements["obs-drift-button"].disabled = false;
  }
  renderObservability();
}

function renderObservability() {
  const gate = state.obsRouteGate;
  if (gate) {
    elements["obs-routegate-count"].textContent = gate.available ? String(gate.total) : "无日志";
    elements["obs-routegate-detail"].textContent = gate.available
      ? `${gate.red} RED / ${gate.gray} gray`
      : "route-gate.log 不存在";
    elements["obs-routegate-body"].innerHTML = (gate.recent ?? [])
      .map(
        (row) => `<tr>
          <td class="mono">${escapeHtml(row.ts)}</td>
          <td><span class="status-label ${row.flag === "red" ? "is-error" : "is-neutral"}">${row.flag === "red" ? "RED" : "gray"}</span></td>
          <td class="mono">${escapeHtml(row.reason)}</td>
          <td>${escapeHtml(row.prompt)}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="4">近 7 天无记录</td></tr>`;
  }
  const delta = state.obsDelta;
  if (delta) {
    elements["obs-delta-count"].textContent = String(delta.total);
    elements["obs-delta-detail"].textContent = `白发 ${delta.byScore[0]} · 补强 ${delta.byScore[1]} · 推翻 ${delta.byScore[2]}`;
    elements["obs-delta-body"].innerHTML = (delta.recent ?? [])
      .map(
        (entry) => `<tr>
          <td>${escapeHtml(entry.agent)}</td>
          <td><span class="status-label ${entry.score === 2 ? "is-error" : entry.score === 1 ? "is-warning" : "is-neutral"}">${entry.score ?? "?"}</span></td>
          <td>${escapeHtml(entry.evidence)}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="3">账本为空</td></tr>`;
  }
  const summary = state.obsSummary;
  if (summary) {
    elements["obs-fire-days"].textContent =
      summary.handoffs.daysSinceLastFire === null ? "无记录" : `${summary.handoffs.daysSinceLastFire} 天`;
    elements["obs-fire-detail"].textContent = summary.handoffs.lastFire ?? "尚无外部发火 handoff";
  }
  const drift = state.obsDrift;
  if (drift) {
    // 空对账不冒充"全部一致"——0 对解析结果只可能是脚本/解析异常，如实标出
    const pairCount = (drift.pairs ?? []).length;
    elements["obs-drift-status"].textContent = drift.drifted ? `${drift.drifted} 对不一致` : pairCount ? "全部一致" : "无对账数据";
    elements["obs-drift-status"].classList.toggle("is-error", drift.drifted > 0 || !pairCount);
    // 漂移 pairs 明细三态（consistent/drift/missing，与 sync-runtime 同口径），异常行置顶
    const pairs = [...(drift.pairs ?? [])].sort((a, b) => (a.status !== "consistent" ? -1 : 0) - (b.status !== "consistent" ? -1 : 0));
    elements["obs-drift-body"].innerHTML = pairs
      .map((pair) => {
        const label = pair.status === "drift" ? "漂移" : pair.status === "missing" ? "缺失" : "一致";
        const tone = pair.status === "drift" ? "is-error" : pair.status === "missing" ? "is-warning" : "is-ok";
        return `<tr>
          <td class="mono">${escapeHtml(pair.name)}</td>
          <td><span class="status-label ${tone}">${label}</span></td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="2" class="subtle">漂移检查未返回配对明细。</td></tr>`;
  }
  elements["obs-handoff-body"].innerHTML = state.obsHandoffs
    .map(
      (item) => `<tr class="handoff-row" data-handoff="${escapeHtml(item.name)}" title="点击查看内容">
        <td class="mono">${escapeHtml(item.name)}</td>
        <td><span class="status-label ${item.direction === "external-fire" ? "is-warning" : "is-neutral"}">${escapeHtml(item.direction)}</span></td>
        <td>${(item.size / 1024).toFixed(1)} KB</td>
        <td class="mono">${escapeHtml(item.modifiedAt.slice(0, 16).replace("T", " "))}</td>
      </tr>`,
    )
    .join("") || `<tr><td colspan="4">暂无 handoff</td></tr>`;
  elements["obs-handoff-meta"].textContent = `${state.obsHandoffs.length} 个交接件 · 点击行查看内容`;
}

async function openHandoff(name) {
  try {
    const payload = await request(`${API.obsHandoffs}/${encodeURIComponent(name)}`);
    elements["obs-handoff-content"].hidden = false;
    elements["obs-handoff-content"].textContent = payload.content;
    elements["obs-handoff-content"].scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    toast(`读取 handoff 失败：${error.message}`, "error");
  }
}

async function loadSessions() {
  const withSummaries = elements["sessions-summaries-toggle"]?.checked;
  state.sessionsError = null;
  if (!state.sessionsData) renderSessions(); // 首次进视图先画加载态——扫描要数秒，不能白屏
  try {
    state.sessionsData = await request(`${API.sessions}${withSummaries ? "?summaries=1" : ""}`);
  } catch (error) {
    state.sessionsData = null;
    state.sessionsError = error.message;
  }
  renderSessions();
}

function renderSessions() {
  const container = elements["sessions-groups"];
  const data = state.sessionsData;
  if (!data) {
    container.innerHTML = state.sessionsError
      ? `<section class="content-section">${emptyMarkup("会话扫描失败", `${state.sessionsError} — 点击右上角「重新扫描」重试`)}</section>`
      : `<section class="content-section">${emptyMarkup("正在扫描本地会话…", "Claude Code / Codex / Grok 历史，通常几秒内完成")}</section>`;
    return;
  }
  container.innerHTML = data.sources
    .map((group) => {
      const rows = (group.sessions ?? [])
        .map(
          (item) => `<tr>
            <td class="mono" title="${escapeHtml(String(item.id))}">${escapeHtml(String(item.id).slice(0, 24))}…</td>
            <td class="mono">${escapeHtml(item.scope ?? "")}</td>
            <td>${item.summary ? escapeHtml(item.summary) : '<span class="subtle">—</span>'}</td>
            <td class="mono">${escapeHtml(item.modifiedAt ? String(item.modifiedAt).slice(0, 16).replace("T", " ") : "--")}</td>
          </tr>`,
        )
        .join("");
      return `<section class="content-section">
        <div class="section-heading">
          <div>
            <h2>${escapeHtml(group.label)}</h2>
            <p>${group.available ? `${group.sessions.length} 个会话` : `不可用：${escapeHtml(group.error ?? "未知")}`}</p>
          </div>
          <span class="status-label ${group.available ? "is-ok" : "is-neutral"}">${group.available ? "已扫描" : "未接入"}</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>会话 ID</th><th>范围</th><th>摘要</th><th>更新时间</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="4">无会话</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("");
}

function renderOverview() {
  const okCount = state.components.filter((item) => normalizeStatus(item.status) === "ok").length;
  const errorCount = state.components.filter((item) => normalizeStatus(item.status) === "error").length;
  const activeRuns = state.runs.filter((run) => ACTIVE_RUN_STATES.has(run.status));
  const driftSources = state.sources.filter((source) => ["drift", "warning", "stale"].includes(source.status));

  elements["metric-services"].textContent = state.components.length ? `${okCount}/${state.components.length}` : "--";
  elements["metric-services-detail"].textContent = errorCount ? `${errorCount} 个组件异常` : okCount ? "已响应组件 / 已登记组件" : "等待健康检查";
  elements["metric-runs"].textContent = String(activeRuns.length);
  elements["metric-runs-detail"].textContent = state.runs.length ? `${state.runs.length} 个任务已登记` : "暂无运行数据";
  elements["metric-sources"].textContent = state.sources.length ? String(state.sources.length) : "--";
  elements["metric-sources-detail"].textContent = driftSources.length ? `${driftSources.length} 项存在漂移` : state.sources.length ? "配置索引已加载" : "等待配置索引";
  setEventState(state.eventState);

  elements["health-updated"].textContent = state.health?.checked_at
    ? `检查于 ${formatDate(state.health.checked_at)}`
    : state.health
      ? `更新于 ${formatDate(new Date())}`
      : "尚未完成检查";
  const healthClass = errorCount ? "error" : okCount === state.components.length ? "ok" : "warning";
  elements["health-summary"].className = `status-label is-${healthClass}`;
  elements["health-summary"].textContent = errorCount ? "存在异常" : okCount === state.components.length ? "全部正常" : "状态不完整";

  elements["health-list"].innerHTML = state.components.length
    ? state.components
        .map((item) => {
          const status = normalizeStatus(item.status);
          return `
            <div class="health-row">
              <div class="health-main">
                <span class="status-dot is-${status}" aria-hidden="true"></span>
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.detail || statusText(status))}</span>
                </div>
              </div>
              <span class="health-latency">${item.latency == null ? statusText(status) : formatDuration(item.latency)}</span>
            </div>`;
        })
        .join("")
    : emptyMarkup("尚无组件数据", "健康端点未返回组件清单");

  const recentRuns = [...state.runs]
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0))
    .slice(0, 6);
  elements["overview-run-list"].innerHTML = recentRuns.length
    ? recentRuns.map((run) => runRowMarkup(run, true)).join("")
    : emptyMarkup("尚无任务", "从协作台发起第一项受控任务");

  const overviewEvents = state.events.slice(0, 8);
  elements["overview-event-body"].innerHTML = overviewEvents.length
    ? overviewEvents
        .map(
          (event) => `
          <tr>
            <td class="mono">${escapeHtml(formatTime(event.timestamp))}</td>
            <td>${escapeHtml(event.type)}</td>
            <td>${escapeHtml(event.agentId || event.sessionId || "control")}</td>
            <td title="${escapeHtml(event.summary)}">${escapeHtml(event.summary)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="subtle">等待标准化事件。</td></tr>`;
  elements["event-sequence"].textContent = `seq ${state.events[0]?.seq ?? "--"}`;
}

function emptyMarkup(title, detail = "") {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

// 配置源格式徽标：slice(0,4) 会截出 MARK/PYTH 这种残词，改用可读缩写表
const FORMAT_BADGES = {
  markdown: "MD",
  python: "PY",
  javascript: "JS",
  typescript: "TS",
  json: "JSON",
  jsonl: "JSONL",
  yaml: "YAML",
  toml: "TOML",
  xml: "XML",
  shell: "SH",
  text: "TXT",
};

function formatBadge(format) {
  const raw = String(format ?? "").trim();
  if (!raw) return "?";
  return FORMAT_BADGES[raw.toLowerCase()] ?? raw.slice(0, 4).toUpperCase();
}

function runRowMarkup(run, clickable = false) {
  const statusClass = run.status === "running" ? "executing" : run.status;
  return `
    <div class="run-row${clickable ? " is-clickable" : ""}" ${clickable ? `data-run-select="${escapeHtml(run.id)}" tabindex="0" role="button"` : ""}>
      <div class="run-main">
        <strong>${escapeHtml(run.title || "未命名任务")}</strong>
        <span>${escapeHtml(run.risk === "unknown" ? "风险未标注" : `${run.risk} risk`)} · ${escapeHtml(formatDate(run.updatedAt ?? run.createdAt))}</span>
      </div>
      <span class="run-status is-${escapeHtml(statusClass)}">${escapeHtml(runStatusText(run.status))}</span>
    </div>`;
}

function renderRuns() {
  elements["run-count"].textContent = String(state.runs.length);
  elements["workbench-run-list"].innerHTML = state.runs.length
    ? state.runs
        .map(
          (run) => `
          <button class="rail-run-button${run.id === state.selectedRunId ? " is-selected" : ""}" type="button" data-run-select="${escapeHtml(run.id)}">
            <strong>${escapeHtml(run.title)}</strong>
            <span>${escapeHtml(runStatusText(run.status))}${run.teamName ? ` · ${escapeHtml(run.teamName)}` : ""} · ${escapeHtml(formatDate(run.updatedAt ?? run.createdAt))}</span>
          </button>`,
        )
        .join("")
    : `<div class="empty-state"><span>暂无任务</span></div>`;
  renderSelectedRun();
}

const PROJECT_SUMMARIES_KEY = "514cc-project-summaries";

const FINISHED_RUN_STATES = new Set(["succeeded", "failed", "cancelled"]); // 与后端 orchestrator TERMINAL 同口径

// ===== 团队：会话级能力配比预设（内置 514cc 冻结，自定义可增改删） =====
const TEAM_KEY = "514cc-selected-team";
const BUILTIN_TEAM_ID = "team-514cc";
// 与后端 teams.mjs COORDINATOR_ELIGIBLE 同口径：具备真实 CLI 会话语义、可任主脑的 provider
const COORDINATOR_ELIGIBLE = new Set(["claude-fable", "codex-technical", "grok-build", "gemini-research", "pi-resident"]);

function currentTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0] ?? null;
}

async function loadTeams() {
  try {
    const payload = await request(API.teams);
    state.teams = payload.teams ?? [];
    if (payload.rejectedOnLoad?.length) {
      // 拒载必须可见——团队不能静默消失（烛 R12 建议）
      toast(`${payload.rejectedOnLoad.length} 个团队配置校验失败被拒载：${payload.rejectedOnLoad[0].reason}`, "warning", 8000);
    }
    // 只有成功响应确认所选团队不存在才回退——瞬时网络错误不清空、不改选择（烛 R10 建议）
    if (!state.teams.some((team) => team.id === state.selectedTeamId)) {
      state.selectedTeamId = BUILTIN_TEAM_ID;
      sessionStorage.setItem(TEAM_KEY, state.selectedTeamId);
    }
  } catch (error) {
    toast(`团队加载失败：${error.message}`, "error");
    if (!state.teams.length) {
      elements["team-picker"].innerHTML = emptyMarkup("团队加载失败", "点击刷新重试");
    }
    return; // 保留旧列表与选择
  }
  renderTeams();
}

function renderTeams() {
  const container = elements["team-picker"];
  if (!container) return;
  if (!state.teams.length) {
    container.innerHTML = emptyMarkup("暂无团队", "团队服务未就绪");
    return;
  }
  const focusWasInside = container.contains(document.activeElement);
  container.innerHTML = state.teams
    .map((team) => {
      const selected = team.id === state.selectedTeamId;
      return `<button class="team-option${selected ? " is-selected" : ""}" type="button"
        aria-pressed="${selected}" data-team-select="${escapeHtml(team.id)}"
        title="${escapeHtml(team.description || team.name)}">
        <span class="team-name">${escapeHtml(team.name)}</span>
        ${team.builtin ? `<span class="team-lock" title="内置团队，配置冻结" aria-label="内置团队，配置冻结">内置</span>` : ""}
        <span class="team-count">${(team.members ?? []).length} 成员</span>
      </button>`;
    })
    .join("");
  // 重绘会销毁旧焦点节点——焦点原在选择器内则落回选中项（烛 R10 建议）
  if (focusWasInside) container.querySelector(".team-option.is-selected")?.focus?.({ preventScroll: true });
  renderStatusline();
}

function selectTeam(id) {
  if (!state.teams.some((team) => team.id === id)) return;
  state.selectedTeamId = id;
  sessionStorage.setItem(TEAM_KEY, id);
  renderTeams();
}

function knownProviderOptions() {
  const providers = Array.isArray(state.bootstrap?.providers) ? state.bootstrap.providers : [];
  if (providers.length) return providers.map((profile) => ({ id: profile.id, label: profile.label || profile.id }));
  // bootstrap 未就绪时回退内置团队成员清单（服务端 knownProviders 必然包含）
  const builtin = state.teams.find((team) => team.builtin);
  return (builtin?.members ?? ["claude-fable"]).map((id) => ({ id, label: id }));
}

function fillTeamForm(team) {
  const readOnly = Boolean(team?.builtin);
  state.editingTeamId = team?.id ?? null;
  elements["team-dialog-title"].textContent = team ? (readOnly ? `查看团队 · ${team.name}` : `编辑团队 · ${team.name}`) : "新建团队";
  elements["team-builtin-note"].hidden = !readOnly;
  elements["team-name-input"].value = team?.name ?? "";
  elements["team-description-input"].value = team?.description ?? "";
  elements["team-prompt-input"].value = team?.systemPrompt ?? "";
  elements["team-skills-input"].value = (team?.skills ?? []).join(", ");
  elements["team-mcp-input"].value = (team?.mcp ?? []).join(", ");
  const members = new Set(team?.members ?? ["claude-fable"]);
  const activeCoordinator = team?.coordinator ?? "claude-fable";
  elements["team-form"].dataset.coordinator = activeCoordinator; // 保存时若无 radio 可选（bootstrap 未就绪）的回退锚点
  elements["team-members-list"].innerHTML = knownProviderOptions()
    .map(({ id, label }) => {
      const mandatory = id === "claude-fable"; // 主脑候补席位，始终在队
      const eligible = COORDINATOR_ELIGIBLE.has(id);
      return `<label class="team-member-option">
        <input type="checkbox" value="${escapeHtml(id)}" ${members.has(id) || mandatory ? "checked" : ""}
          ${mandatory || readOnly ? "disabled" : ""} />
        <span>${escapeHtml(label)}</span>
        ${eligible ? `<span class="coordinator-pick"><input type="radio" name="team-coordinator" value="${escapeHtml(id)}"
          ${id === activeCoordinator ? "checked" : ""} ${readOnly ? "disabled" : ""} aria-label="设为主脑" />主脑</span>` : ""}
      </label>`;
    })
    .join("");
  for (const field of ["team-name-input", "team-description-input", "team-prompt-input", "team-skills-input", "team-mcp-input"]) {
    elements[field].disabled = readOnly;
  }
  elements["team-save-button"].textContent = readOnly ? "另存为新团队" : "保存";
  elements["team-delete-button"].hidden = readOnly || !team;
}

function openTeamDialog(team) {
  fillTeamForm(team);
  const dialog = elements["team-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

function closeTeamDialog() {
  elements["team-dialog"].close();
  state.editingTeamId = null;
}

function splitList(value) {
  return String(value ?? "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectTeamForm() {
  const members = [...elements["team-members-list"].querySelectorAll("input[type=checkbox]")]
    .filter((input) => input.checked)
    .map((input) => input.value);
  if (!members.includes("claude-fable")) members.unshift("claude-fable");
  // 无 radio 选中（bootstrap 未就绪、coordinator 选项未渲染）时回退编辑前的原主脑，
  // 而非静默改成 claude-fable——防止保存其他字段时把主脑悄悄换掉（严禁 silent fallback）
  const checkedCoordinator = elements["team-members-list"].querySelector("input[name=team-coordinator]:checked")?.value;
  const coordinator = checkedCoordinator || elements["team-form"].dataset.coordinator || "claude-fable";
  if (!members.includes(coordinator)) members.push(coordinator); // 主脑必是成员
  return {
    name: elements["team-name-input"].value.trim(),
    description: elements["team-description-input"].value.trim(),
    systemPrompt: elements["team-prompt-input"].value.trim(),
    coordinator,
    members,
    skills: splitList(elements["team-skills-input"].value),
    mcp: splitList(elements["team-mcp-input"].value),
  };
}

async function saveTeamForm(event) {
  event.preventDefault();
  if (elements["team-save-button"].disabled) return;
  const editing = state.teams.find((team) => team.id === state.editingTeamId);
  const payload = collectTeamForm();
  if (!payload.name) {
    toast("团队名称不能为空", "error");
    return;
  }
  elements["team-save-button"].disabled = true; // 防双击并发提交（烛 R10 致命3 前端面）
  try {
    if (editing?.builtin) {
      // 内置团队只读——"另存为新团队"路径；重名时提示改名
      if (payload.name === editing.name) payload.name = `${editing.name} 副本`;
      const created = await request(API.teams, { method: "POST", body: payload });
      toast(`已基于 ${editing.name} 创建新团队`, "success");
      await loadTeams();
      selectTeam(created.id);
    } else if (editing) {
      await request(`${API.teams}/${encodeURIComponent(editing.id)}`, { method: "PUT", body: payload });
      toast("团队已保存", "success");
      await loadTeams();
    } else {
      const created = await request(API.teams, { method: "POST", body: payload });
      toast("团队已创建", "success");
      await loadTeams();
      selectTeam(created.id);
    }
    closeTeamDialog();
  } catch (error) {
    toast(`团队保存失败：${error.message}`, "error");
  } finally {
    elements["team-save-button"].disabled = false;
  }
}

async function deleteEditingTeam() {
  const team = state.teams.find((item) => item.id === state.editingTeamId);
  if (!team || team.builtin) return;
  const proceed = await confirmAction({
    eyebrow: "删除团队",
    title: `删除团队「${team.name}」？`,
    rows: [
      ["成员", `${(team.members ?? []).length} 个`],
      ["影响", "已创建的历史任务不受影响；当前选中团队将回退到 514cc"],
    ],
    warning: "团队配置将被删除，无法恢复。",
    confirmLabel: "删除",
    danger: true,
  });
  if (!proceed) return;
  try {
    await request(`${API.teams}/${encodeURIComponent(team.id)}`, { method: "DELETE" });
    toast(`团队「${team.name}」已删除`, "success");
    closeTeamDialog();
    await loadTeams();
  } catch (error) {
    toast(`删除失败：${error.message}`, "error");
  }
}

async function clearFinishedRuns() {
  const finished = state.runs.filter((run) => FINISHED_RUN_STATES.has(run.status));
  if (!finished.length) {
    toast("没有可清除的已结束任务", "success", 2200);
    return;
  }
  const proceed = await confirmAction({
    eyebrow: "清理会话列表",
    title: "清除已结束任务？",
    rows: [
      ["将清除", `${finished.length} 条（成功/失败/已取消）`],
      ["保留", "运行中与待恢复的任务"],
    ],
    warning: "任务记录与其持久化文件将被删除，无法恢复。",
    confirmLabel: "清除",
    danger: true,
  });
  if (!proceed) return;
  try {
    const result = await request("/api/runs/clear-finished", { method: "POST" });
    if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId && !FINISHED_RUN_STATES.has(run.status))) {
      state.selectedRunId = null;
    }
    await loadRuns();
    renderRuns();
    toast(`已清除 ${result.cleared} 条已结束任务`, "success");
  } catch (error) {
    toast(`清除失败：${error.message}`, "error");
  }
}

async function loadProjects() {
  // 请求序号防乱序倒灌（烛 R6 致命2）：快速开→关摘要时，慢的 summaries=1 响应不得覆盖已关闭状态
  const seq = ++state.projectsSeq;
  let data;
  try {
    // 摘要严格 opt-in（烛 R5 致命1）：默认只回元数据；用户勾选后才请求脱敏摘要
    data = await request(`${API.sessionProjects}${state.projectSummaries ? "?summaries=1" : ""}`);
  } catch (error) {
    if (seq !== state.projectsSeq) return;
    state.projectsData = { available: false, error: error.message, projects: [] };
    toast(`项目扫描失败：${error.message}`, "error");
    renderProjects();
    return;
  }
  if (seq !== state.projectsSeq) return; // 已有更新的请求在途/完成
  state.projectsData = data;
  renderProjects();
}

function initProjectSummariesToggle() {
  state.projectSummaries = sessionStorage.getItem(PROJECT_SUMMARIES_KEY) === "1";
  const toggle = elements["project-summaries-toggle"];
  if (!toggle) return;
  toggle.checked = state.projectSummaries;
  toggle.addEventListener("change", () => {
    state.projectSummaries = toggle.checked;
    sessionStorage.setItem(PROJECT_SUMMARIES_KEY, state.projectSummaries ? "1" : "0");
    if (!state.projectSummaries && state.projectsData?.projects) {
      // 关闭即时剥离已显示的摘要（烛 R6 致命2）——不等网络往返
      for (const project of state.projectsData.projects) {
        for (const session of project.sessions ?? []) session.summary = null;
      }
      renderProjects();
    }
    void loadProjects();
  });
}

function sessionDisplayTitle(session) {
  return session.summary || `会话 ${String(session.id).slice(0, 8)}`;
}

/** 侧栏用短时间：今天显示 HH:mm，更早显示 MM/DD。 */
function shortDate(value) {
  const date = new Date(value ?? 0);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function renderProjects() {
  const container = elements["workbench-project-tree"];
  const data = state.projectsData;
  if (!container) return;
  if (!data) {
    container.innerHTML = `<div class="empty-state compact-empty"><span>正在扫描本地项目…</span></div>`;
    return;
  }
  const projects = data.projects ?? [];
  elements["project-count"].textContent = String(projects.length);
  if (!data.available) {
    container.innerHTML = emptyMarkup("项目扫描不可用", data.error ?? "未知原因");
    return;
  }
  if (!projects.length) {
    container.innerHTML = emptyMarkup("暂无本地项目", "~/.claude/projects 目录为空");
    return;
  }
  container.innerHTML = projects
    .map((project, index) => {
      const expanded = state.expandedProjects.has(project.id);
      const sessionItems = (project.sessions ?? [])
        .map((session) => {
          const selected = state.sessionPreview?.projectId === project.id && state.sessionPreview?.sessionId === session.id;
          return `<li>
            <button class="session-link${selected ? " is-selected" : ""}" type="button"
              data-session-project="${escapeHtml(project.id)}" data-session-id="${escapeHtml(session.id)}"
              title="${escapeHtml(sessionDisplayTitle(session))}">
              <span class="session-title">${escapeHtml(sessionDisplayTitle(session))}</span>
              <span class="session-time">${escapeHtml(shortDate(session.modifiedAt))}</span>
            </button>
          </li>`;
        })
        .join("");
      return `<div class="project-node">
        <button class="project-toggle" type="button" data-project-toggle="${escapeHtml(project.id)}"
          aria-expanded="${expanded}" aria-controls="project-sessions-${index}"
          title="${escapeHtml(project.path ?? project.id)}">
          <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          <span class="project-name">${escapeHtml(project.label)}</span>
          <span class="project-badge">${Number(project.sessionCount) || 0}</span>
        </button>
        <ul class="project-sessions" id="project-sessions-${index}"${expanded ? "" : " hidden"}>
          ${sessionItems || `<li class="project-empty">无历史对话</li>`}
        </ul>
      </div>`;
    })
    .join("");
}

// 展开/收起用 DOM 手术而非全量重渲染——保住 toggle 按钮上的键盘焦点（烛 R3 焦点纪律）
function toggleProject(id, button) {
  const wasExpanded = state.expandedProjects.has(id);
  if (wasExpanded) state.expandedProjects.delete(id);
  else state.expandedProjects.add(id);
  button.setAttribute("aria-expanded", String(!wasExpanded));
  const list = byId(button.getAttribute("aria-controls"));
  if (list) list.hidden = wasExpanded;
}

function markSelectedSessionLink(projectId, sessionId) {
  document.querySelectorAll(".session-link.is-selected").forEach((node) => node.classList.remove("is-selected"));
  if (!projectId || !sessionId) return;
  document
    .querySelector(`[data-session-project="${CSS.escape(projectId)}"][data-session-id="${CSS.escape(sessionId)}"]`)
    ?.classList.add("is-selected");
}

async function openSessionPreview(projectId, sessionId) {
  const project = state.projectsData?.projects?.find((item) => item.id === projectId);
  const session = project?.sessions?.find((item) => item.id === sessionId);
  const key = `${projectId}::${sessionId}`;
  const seq = ++state.previewSeq; // key 相同的关闭-重开竞态用递增序号区分（烛 R5 建议）
  state.sessionPreview = {
    key,
    seq,
    projectId,
    sessionId,
    projectLabel: project?.label ?? projectId,
    title: session ? sessionDisplayTitle(session) : `会话 ${String(sessionId).slice(0, 8)}`,
    loading: true,
    error: null,
    data: null,
  };
  markSelectedSessionLink(projectId, sessionId);
  renderSelectedRun();
  try {
    const data = await request(`/api/sessions/claude/${encodeURIComponent(projectId)}/${encodeURIComponent(sessionId)}/preview`);
    if (state.sessionPreview?.seq !== seq) return; // 用户已切走或重开
    state.sessionPreview.loading = false;
    state.sessionPreview.data = data;
  } catch (error) {
    if (state.sessionPreview?.seq !== seq) return;
    state.sessionPreview.loading = false;
    state.sessionPreview.error = error.message;
  }
  renderSelectedRun();
  const heading = elements["conversation-title"];
  heading?.setAttribute("tabindex", "-1");
  heading?.focus?.({ preventScroll: true });
}

function closeSessionPreview({ restoreFocus = true } = {}) {
  const preview = state.sessionPreview;
  state.sessionPreview = null;
  markSelectedSessionLink(null, null);
  renderSelectedRun();
  if (restoreFocus && preview) {
    // 来源对话按钮可能已被收起/刷新——回退到项目 toggle，焦点不落空（烛 R5 建议）
    const link = document.querySelector(
      `[data-session-project="${CSS.escape(preview.projectId)}"][data-session-id="${CSS.escape(preview.sessionId)}"]`,
    );
    const target = link && link.offsetParent !== null
      ? link
      : document.querySelector(`[data-project-toggle="${CSS.escape(preview.projectId)}"]`);
    target?.focus?.({ preventScroll: true });
  }
}

function renderSessionPreview() {
  const preview = state.sessionPreview;
  elements["conversation-title"].textContent = preview.title;
  elements["conversation-meta"].textContent = `${preview.projectLabel} · 历史会话只读预览`;
  elements["workbench-run-status"].textContent = "历史预览";
  elements["workbench-run-status"].className = "status-label is-neutral";
  elements["cancel-run-button"].disabled = true;
  setComposerMode(null); // 历史预览下胶囊回新任务模式
  const stream = elements["conversation-stream"];
  stream.setAttribute("aria-live", "off"); // 一次插入几十条历史消息不该被 live region 整段朗读（烛 R5 建议）
  const renderedKey = `${preview.seq}|${preview.loading}|${preview.error ?? ""}`;
  // SSE 触发的重渲染不重写预览流——避免闪烁和滚动位置被拽回（内容只在加载状态变化时更新）
  if (stream.dataset.previewKey !== renderedKey) {
    const banner = `<div class="preview-banner" role="status">
      <span>只读预览 · ${escapeHtml(preview.projectLabel)}${preview.data?.truncated ? " · 仅显示最近消息" : ""}</span>
      <button class="text-button" type="button" data-preview-close>返回协作台</button>
    </div>`;
    let body;
    if (preview.loading) body = emptyMarkup("正在读取会话…", "从本地会话记录提取对话骨架");
    else if (preview.error) body = emptyMarkup("预览失败", preview.error);
    else if (!preview.data?.messages?.length) body = emptyMarkup("没有可预览的文本消息", "该会话只有工具事件或为空");
    else
      body = preview.data.messages
        .map((message) =>
          messageMarkup({
            role: message.role,
            author: message.role === "user" ? "LO" : "Claude",
            content: message.text,
            created_at: message.timestamp,
          }),
        )
        .join("");
    stream.innerHTML = banner + body;
    stream.dataset.previewKey = renderedKey;
    stream.scrollTop = stream.scrollHeight;
  }
  renderRouteDecision(null);
  renderTopology(null);
  renderWorkbenchEvents();
}

function selectedRun() {
  return state.runs.find((run) => run.id === state.selectedRunId) ?? null;
}

// ===== 新会话：项目地址（cwd）选择——地址即项目身份（claude 原生按 cwd 归属 ~/.claude/projects） =====
function knownProjectPaths() {
  const projects = state.projectsData?.projects ?? [];
  return [...new Set(projects.map((project) => project.path).filter(Boolean))];
}

function normalizePathKey(value) {
  return String(value ?? "").trim().replace(/[\\/]+$/, "").replaceAll("/", "\\").toLowerCase();
}

function matchExistingProject(path) {
  const key = normalizePathKey(path);
  if (!key) return null;
  const projects = state.projectsData?.projects ?? [];
  return projects.find((project) => normalizePathKey(project.path) === key) ?? null;
}

function updateSessionCwdHint() {
  const value = elements["session-cwd-input"].value.trim();
  const hint = elements["session-cwd-hint"];
  if (!value) {
    hint.textContent = "输入或选择目录：匹配下方已有项目则会话归属它；新地址将在首轮后自动创建为新项目。";
    hint.classList.remove("is-existing");
    return;
  }
  const existing = matchExistingProject(value);
  if (existing) {
    hint.textContent = `✓ 会话将归属已有项目「${existing.label}」（${existing.sessionCount} 个历史会话）。`;
    hint.classList.add("is-existing");
  } else {
    hint.textContent = "新地址：会话开始后将在此目录创建新项目（CLI 原生归属），并出现在下方项目列表。";
    hint.classList.remove("is-existing");
  }
}

async function openSessionDialog() {
  const fillPaths = () => {
    elements["project-paths"].innerHTML = knownProjectPaths()
      .map((path) => `<option value="${escapeHtml(path)}"></option>`)
      .join("");
  };
  fillPaths();
  elements["session-cwd-input"].value = state.pendingCwd || "";
  updateSessionCwdHint();
  const dialog = elements["session-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  elements["session-cwd-input"].focus();
  // 项目数据未就绪（刚进页面）时补拉一次，datalist 与归属判断都吃到完整清单
  if (!state.projectsData?.projects?.length) {
    await loadProjects().catch(() => {});
    fillPaths();
    updateSessionCwdHint();
  }
}

function confirmSessionDialog(event) {
  event.preventDefault();
  const value = elements["session-cwd-input"].value.trim();
  if (!value) {
    toast("项目地址必填", "error");
    return;
  }
  state.pendingCwd = value;
  const existing = matchExistingProject(value);
  elements["session-dialog"].close();
  // 开新会话：退出续聊模式，胶囊回新任务形态并带地址徽标
  state.selectedRunId = null;
  renderRuns();
  toast(existing ? `新会话将归属项目「${existing.label}」` : "新会话将在该地址创建新项目", "success");
  elements["task-input"].focus({ preventScroll: true });
}

// ===== ccline 式状态条：模型 · 📁目录 · 用量 · 团队（数据取真实 run 回执） =====
function renderStatusline() {
  const bar = elements["rail-statusline"];
  if (!bar) return;
  const run = selectedRun();
  // 模型：选中 run 最后一轮的实际生效模型 > /model 选择 > 默认 fable
  const lastTurn = run?.turns?.length ? run.turns[run.turns.length - 1] : null;
  const model = lastTurn?.effectiveModel || run?.modelOverride || elements["task-model"]?.value || "fable";
  const modelShort = String(model).replace(/^claude-/, "").replace(/-\d{8}$/, "");
  // 目录：续聊=run 地址；新任务=待选地址；默认控制面根
  const cwd = run?.cwd || state.pendingCwd || "I:\\514claude\\514cc";
  const cwdShort = String(cwd).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd;
  // 用量：选中 run 各轮累计 token（对 200k 上下文的百分比）+ 成本
  const totalTokens = (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.tokens) || 0), 0);
  const totalCost = (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.costUsd) || 0), 0);
  const tokensText = totalTokens
    ? `${((totalTokens / 200000) * 100).toFixed(1)}% · ${(totalTokens / 1000).toFixed(1)}k tokens${totalCost ? ` · $${totalCost.toFixed(2)}` : ""}`
    : "0 tokens";
  const team = currentTeam();
  bar.innerHTML = [
    `<span class="sl-seg"><span class="sl-icon">◆</span>${escapeHtml(modelShort)}</span>`,
    `<span class="sl-seg"><span class="sl-icon">📁</span>${escapeHtml(cwdShort)}</span>`,
    `<span class="sl-seg"><span class="sl-icon">∑</span><span class="sl-dim">${escapeHtml(tokensText)}</span></span>`,
    `<span class="sl-seg"><span class="sl-icon">◈</span>${escapeHtml(team?.name ?? "514cc")}</span>`,
  ].join("");
  bar.title = `模型 ${model} · 地址 ${cwd} · 团队 ${team?.name ?? "514cc"}`;
}

// ===== 协作台会话流增强：内联审批卡 / 恢复条 / 终态原因 =====

// 内联审批倒计时：每秒只刷新时间文本、不重渲会话流（避免滚动位置与 <details> 展开态被打断）；无卡片时自停
let approvalCountdownTimer = 0;

function approvalCountdownText(expiresAt) {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(remaining)) return "--:--";
  if (remaining <= 0) return "00:00";
  const total = Math.ceil(remaining / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function ensureApprovalCountdown() {
  if (approvalCountdownTimer || !document.querySelector("[data-approval-expires]")) return;
  approvalCountdownTimer = window.setInterval(() => {
    const nodes = document.querySelectorAll("[data-approval-expires]");
    if (!nodes.length) {
      window.clearInterval(approvalCountdownTimer);
      approvalCountdownTimer = 0;
      return;
    }
    nodes.forEach((node) => {
      node.textContent = approvalCountdownText(node.dataset.approvalExpires);
    });
  }, 1000);
}

// fileChange 审批的路径提取：兼容 paths/files/changes（数组或 path→变更 映射）与单 path 字段
function approvalFilePaths(params) {
  for (const list of [params.paths, params.files, params.changes]) {
    if (Array.isArray(list) && list.length) {
      return list.map((entry) => String(typeof entry === "string" ? entry : entry?.path ?? entry?.file ?? entry?.filename ?? entry?.name ?? entry));
    }
    if (list && typeof list === "object") {
      const keys = Object.keys(list);
      if (keys.length) return keys;
    }
  }
  return typeof params.path === "string" && params.path ? [params.path] : [];
}

// key/value 表的值：原子值直显，嵌套结构压缩单行截断（不脱敏前不落 DOM）
function approvalValueText(value) {
  if (value == null || value === "") return "--";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = redact(typeof value === "string" ? value : JSON.stringify(value));
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

// 审批参数结构化呈现：commandExecution→mono 命令块；fileChange→路径列表；其余→key/value 表（不塞原始 JSON）
function approvalParamsMarkup(item) {
  const method = String(item.method ?? "");
  const params = item.params && typeof item.params === "object" ? item.params : {};
  if (method.includes("commandExecution") || method === "execCommandApproval") {
    const raw = params.command ?? params.cmd ?? params.argv ?? "";
    const command = Array.isArray(raw) ? raw.join(" ") : String(raw || "");
    const cwd = params.cwd ?? params.workingDirectory ?? "";
    return `
      <pre class="approval-command">${escapeHtml(redact(command || "（未公开命令内容）"))}</pre>
      ${cwd ? `<div class="approval-kv"><span>工作目录</span><code>${escapeHtml(redact(String(cwd)))}</code></div>` : ""}`;
  }
  if (method.includes("fileChange") || method === "applyPatchApproval") {
    const paths = approvalFilePaths(params);
    return paths.length
      ? `<ul class="approval-paths">${paths.map((path) => `<li><code>${escapeHtml(redact(path))}</code></li>`).join("")}</ul>`
      : `<div class="approval-kv"><span>变更路径</span><code>未公开</code></div>`;
  }
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  return entries.length
    ? `<div class="approval-kv-list">${entries.map(([key, value]) => `<div class="approval-kv"><span>${escapeHtml(key)}</span><code>${escapeHtml(approvalValueText(value))}</code></div>`).join("")}</div>`
    : `<div class="approval-kv"><span>参数</span><code>无公开参数</code></div>`;
}

// 内联审批卡：方法 + 结构化参数 + 截断哈希 + 到期倒计时 + 批准/拒绝（哈希随决议回传校验，故跳过二次弹窗）
function approvalCardMarkup(item) {
  const method = String(item.method ?? "unknown");
  const broadPermission = method === "item/permissions/requestApproval"; // v1 不支持广域授权——与安全诊断页同口径禁批
  return `
    <article class="approval-inline">
      <div class="approval-inline-head">
        <strong>动作审批</strong>
        <span class="approval-inline-method">${escapeHtml(method)}</span>
        <span class="approval-inline-countdown">剩余 <time data-approval-expires="${escapeHtml(item.expiresAt ?? "")}">${approvalCountdownText(item.expiresAt)}</time></span>
      </div>
      ${approvalParamsMarkup(item)}
      <div class="approval-inline-hash">动作哈希 <code title="${escapeHtml(item.actionSha256 ?? "")}">${escapeHtml(compactHash(item.actionSha256))}</code></div>
      <div class="approval-inline-actions">
        <button class="button secondary" type="button" data-inline-approval-id="${escapeHtml(item.id)}" data-inline-approval-decision="deny">拒绝</button>
        <button class="button primary" type="button" data-inline-approval-id="${escapeHtml(item.id)}" data-inline-approval-decision="approve"${broadPermission ? " disabled title=\"v1 不支持广域权限授权\"" : ""}>批准</button>
      </div>
    </article>`;
}

// 内联决议结果：approvalId → { runId, decision }——决议后卡片折叠为"已批准/已拒绝"一行留在会话流里
const inlineApprovalOutcomes = new Map();

function inlineApprovalsMarkup(run) {
  const resolved = [...inlineApprovalOutcomes.values()]
    .filter((entry) => entry.runId === run.id)
    .map((entry) => {
      const approved = entry.decision === "approve";
      return `<div class="approval-resolved-line ${approved ? "is-approved" : "is-denied"}">${approved ? "✓ 已批准该动作" : "✕ 已拒绝该动作"}</div>`;
    });
  // 等待审批（run build 授权）与轮中审批（codex command/file 请求）都挂在会话流末尾
  const pending = state.approvals.filter((item) => item.runId === run.id && (item.status ?? "pending") === "pending");
  return [...resolved, ...pending.map(approvalCardMarkup)].join("");
}

// 内联审批决议：跳过 confirmAction 二次弹窗——actionSha256 随请求回传、服务端哈希校验已是防误触护栏
async function resolveInlineApproval(id, decision) {
  const item = state.approvals.find((approval) => approval.id === id);
  if (!item) return;
  const buttons = [...document.querySelectorAll(`[data-inline-approval-id="${CSS.escape(id)}"]`)];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await request(`${API.approvals}/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { decision, actionSha256: item.actionSha256, actor: "control-center" },
    });
    inlineApprovalOutcomes.set(id, { runId: item.runId, decision });
    toast(decision === "approve" ? "动作已批准" : "动作已拒绝", decision === "approve" ? "success" : "warning");
    appendDiagnostic(`内联审批 ${decision} ${id}`);
    await loadApprovals();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`内联审批处理失败 ${id}: ${error.message}`, "error");
    buttons.forEach((button) => { button.disabled = false; });
    await loadApprovals().catch(() => {});
  }
}

// recovery 死路恢复条：composer 上方显示 recoveryNote；确认后下一次续聊带 acknowledgeRecovery:true
function renderRecoveryBar(run) {
  const bar = elements["recovery-bar"];
  if (!bar) return;
  if (!run || run.status !== "recovery_required") {
    if (run && state.recoveryAckRunId === run.id) state.recoveryAckRunId = null; // 状态已翻页，确认标记失效
    bar.hidden = true;
    bar.innerHTML = "";
    return;
  }
  const note = String(run.recoveryNote ?? "").trim() || "上一轮原生会话提交状态不明确，自动重放已被阻止。";
  const acked = state.recoveryAckRunId === run.id;
  bar.hidden = false;
  bar.innerHTML = `
    <span class="recovery-note">${escapeHtml(redact(note))}</span>
    ${acked
      ? `<span class="recovery-acked">✓ 已确认——下次发送将自动继续</span>`
      : `<button class="button secondary" type="button" data-recovery-ack>确认恢复并继续</button>`}`;
}

function acknowledgeRecovery() {
  const run = selectedRun();
  if (!run || run.status !== "recovery_required") return;
  state.recoveryAckRunId = run.id;
  appendDiagnostic(`恢复确认 ${run.id}：下一次续聊携带 acknowledgeRecovery`);
  renderRecoveryBar(run);
  elements["task-input"].focus({ preventScroll: true });
}

// 终态原因：failed/cancelled 时把 run.error / run.recoveryNote 挂到会话流末尾（normalizeRun ...item 已透传）
function runFailureMarkup(run) {
  if (!["failed", "cancelled", "canceled"].includes(run.status)) return "";
  const reasons = [...new Set([run.error, run.recoveryNote].map((text) => String(text ?? "").trim()).filter(Boolean))];
  if (!reasons.length) return "";
  const failed = run.status === "failed";
  return `
    <div class="run-end-note ${failed ? "is-failed" : "is-cancelled"}">
      <strong>${failed ? "任务失败" : "任务已取消"}</strong>
      ${reasons.map((reason) => `<span>${escapeHtml(redact(reason))}</span>`).join("")}
    </div>`;
}

// 胶囊 composer 双模式：run=null → 新任务；run → 续聊当前原生会话（一个输入框，语义随上下文切换）
function setComposerMode(run, { waitingApproval = false } = {}) {
  const continuing = Boolean(run);
  elements["composer-mode-hint"].textContent = continuing ? "续聊当前会话" : "任务内容";
  elements["composer-new-task"].hidden = !continuing;
  // 项目地址徽标：新任务模式显示当前会话地址（点击可换）；续聊模式显示所属 run 的地址（只读信息）
  const cwdShown = continuing ? run.cwd : state.pendingCwd;
  elements["composer-cwd"].hidden = !cwdShown;
  if (cwdShown) {
    const short = String(cwdShown).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwdShown;
    elements["composer-cwd"].textContent = `📁 ${short}`;
    elements["composer-cwd"].title = `会话项目地址：${cwdShown}${continuing ? "" : "（点击更换）"}`;
    elements["composer-cwd"].disabled = continuing;
  }
  elements["task-model-pick"].hidden = continuing; // /model 只在新任务时可选（run 已固化 modelOverride）
  elements["followup-agent-pick"].hidden = !continuing;
  // 轮间插话可用性前置告知：run 活跃时发送不打断当前轮，排队到轮边界送达（后端 pendingSteer FIFO）
  const steering = continuing && ACTIVE_RUN_STATES.has(run.status);
  elements["task-input"].placeholder = steering
    ? "会话进行中——发送将作为轮间插话，当前轮结束后送达"
    : continuing ? "补充要求、质疑证据或继续执行" : "描述要规划、实现、审查或调研的目标";
  elements["task-input"].disabled = waitingApproval;
  elements["submit-task-button"].disabled = waitingApproval;
  elements["followup-agent"].disabled = waitingApproval;
  if (continuing && elements["followup-agent"].dataset.runId !== run.id) {
    // 发送给下拉按团队成员过滤（服务端已强制隔离）+ 预选主脑；仅切 run 时重建
    const members = Array.isArray(run.teamMembers) && run.teamMembers.length
      ? run.teamMembers
      : ["claude-fable", "codex-technical", "grok-search", "grok-build", "gemini-research", "pi-resident"];
    elements["followup-agent"].innerHTML = members
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(agentLabel(id))}${id === run.coordinatorId ? "（主脑）" : ""}</option>`)
      .join("");
    elements["followup-agent"].value = run.coordinatorId || members[0];
    elements["followup-agent"].dataset.runId = run.id;
  }
}

function renderSelectedRun() {
  if (state.sessionPreview) {
    renderRecoveryBar(null); // 历史预览与 run 上下文无关，恢复条一并收起
    renderSessionPreview();
    return;
  }
  delete elements["conversation-stream"].dataset.previewKey;
  elements["conversation-stream"].setAttribute("aria-live", "polite"); // 退出预览恢复实时播报
  const run = selectedRun();
  if (!run) {
    elements["conversation-title"].textContent = "新任务";
    elements["conversation-meta"].textContent = "等待输入";
    elements["workbench-run-status"].textContent = "未选择任务";
    elements["workbench-run-status"].className = "status-label is-neutral";
    elements["cancel-run-button"].disabled = true;
    setComposerMode(null);
    renderRecoveryBar(null);
    elements["conversation-stream"].innerHTML = emptyMarkup("准备接收任务", "任务创建后，路由、会话与工具事件会在此汇合。");
    renderRouteDecision(null);
    renderTopology(null);
    renderWorkbenchEvents();
    renderStatusline();
    return;
  }

  elements["conversation-title"].textContent = run.title;
  elements["conversation-meta"].textContent = `run ${run.id} · ${formatDate(run.createdAt)}`;
  elements["workbench-run-status"].textContent = runStatusText(run.status);
  const successful = ["complete", "completed", "succeeded"].includes(run.status);
  elements["workbench-run-status"].className = `status-label is-${TERMINAL_RUN_STATES.has(run.status) ? (successful ? "ok" : "error") : "warning"}`;
  elements["cancel-run-button"].disabled = !ACTIVE_RUN_STATES.has(run.status);
  const waitingApproval = run.status === "waiting_approval" || run.buildApproval?.status === "pending";
  setComposerMode(run, { waitingApproval });
  renderRecoveryBar(run);

  const stream = elements["conversation-stream"];
  // 仅当用户已在底部时才自动滚底——上滚查看历史/展开工具结果时，后续 SSE 帧不把视图拽回底部
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
  const messages = normalizeRunMessages(run);
  // 会话流尾部增强：内联审批卡（等待/轮中审批）+ 终态失败/取消原因
  const tailMarkup = inlineApprovalsMarkup(run) + runFailureMarkup(run);
  stream.innerHTML = (messages.length
    ? messages.map(messageMarkup).join("")
    : emptyMarkup("任务已创建", "等待主脑计划或 Agent 事件。")) + tailMarkup;
  ensureApprovalCountdown();
  if (atBottom) stream.scrollTop = stream.scrollHeight;
  renderRouteDecision(run.route ? normalizeRoute(run.route) : state.routePreview);
  renderTopology(run);
  renderWorkbenchEvents();
  renderStatusline();
}

// provider id → 用户友好显示名（对话归属不显示内部 id，如 claude-fable → Claude）
const AGENT_LABELS = {
  "claude-fable": "Claude",
  "codex-technical": "Codex",
  "grok-search": "Grok 搜索",
  "grok-build": "Grok Build",
  "gemini-research": "Gemini",
  "pi-resident": "Pi",
};
function agentLabel(id) {
  return AGENT_LABELS[id] || id || "Agent";
}

// CLI 式工具调用行："⏺ Bash(cat foo.txt)" + 可折叠结果——与正常 CLI 呈现对齐。
// 入参先 redact 再截断：Bash 命令行入参最可能带赋值式密钥（PASSWORD=xxx），与工具结果同等脱敏，
// 否则密钥在调用行明文进 DOM/截图（工具结果脱敏了、调用行漏了会形成不对称泄漏）。
function toolCallMarkup(tool) {
  const full = redact(String(tool.input ?? "")).replace(/\s+/g, " ");
  const shown = full.slice(0, 160) + (full.length > 160 ? "…" : "");
  const title = full.length > 160 ? ` title="${escapeHtml(full.slice(0, 600))}"` : "";
  return `<div class="tool-call"><span class="tool-dot" aria-hidden="true">⏺</span><strong>${escapeHtml(tool.name || "tool")}</strong><span class="tool-args"${title}>${escapeHtml(full ? `(${shown})` : "")}</span></div>`;
}

function toolResultMarkup(result) {
  const text = redact(String(result.text ?? ""));
  const lineCount = text ? text.split("\n").length : 0;
  return `<details class="tool-result${result.isError ? " is-error" : ""}">
    <summary>${result.isError ? "⚠ 工具错误" : "工具结果"} · ${lineCount} 行</summary>
    <pre>${escapeHtml(text) || "(空)"}</pre>
  </details>`;
}

// 治理事件 → 会话流系统注记：编排/适配器护栏信号不静默吞掉（玫瑰=警示 / 琥珀=提示，样式克制）
const GOVERNANCE_EVENTS = {
  "run.coordinator_write_skipped": { tone: "rose", text: (data) => data.note || "主脑兼任执行者，本轮仅规划不落盘" },
  "adapter.fallback": { tone: "amber", text: (data) => `适配器降级：${data.from || "?"} → ${data.to || "?"}${data.reason ? `（${data.reason}）` : ""}` },
  "adapter.replay_blocked": { tone: "rose", text: (data) => `已阻止不安全的原生轮重放：${data.reason || "提交状态不明确"}` },
  "run.authorization_revoked": { tone: "rose", text: (data) => `Build 授权已撤销：${data.reason || "运行时策略变更"}` },
  "agent.turn_checkpoint": { tone: "amber", text: (data, event) => `轮次检查点 · 第 ${data.round ?? "?"} 轮 ${agentLabel(data.agentId ?? event.agentId ?? "")} · ${data.phase || "?"}` },
  "run.steer_queued": { tone: "amber", text: (data) => `轮间插话已排队（第 ${data.depth ?? "?"} 位）· 当前轮结束后送达 ${agentLabel(data.agentId || "")}` },
  // 先脱敏后截断（与 toolCallMarkup 同序）：截断可把密钥模式切半使 redact 失配；旧持久化队列的
  // prompt 不再过 continue 入口的密钥门，此处是最后一道
  "run.steer_dropped": { tone: "rose", text: (data) => { const safe = redact(String(data.text || "")); return `轮间插话被丢弃（${data.reason === "ROUND_LIMIT" ? "已达最大协作轮次" : data.reason || "未知原因"}）：${safe.slice(0, 60)}${safe.length > 60 ? "…" : ""}`; } },
};

// 轮次统计行文案：第 N 轮 · Agent · 模型 · tokens · 成本（缺哪项省哪项，旧事件无 tokens 也能渲）
function turnMetaText(data, event) {
  const parts = [`第 ${data.round ?? "?"} 轮完成`, agentLabel(data.agentId ?? event.agentId ?? "")];
  if (data.effectiveModel) parts.push(String(data.effectiveModel));
  // 空/空白串先挡（Number("")===Number(" ")===0 会伪造 "0 tokens"/"$0.00"）——缺哪项省哪项
  if (data.tokens != null && String(data.tokens).trim() !== "" && Number.isFinite(Number(data.tokens))) {
    const tokens = Number(data.tokens);
    parts.push(tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`);
  }
  if (data.costUsd != null && String(data.costUsd).trim() !== "" && Number.isFinite(Number(data.costUsd))) parts.push(`$${Number(data.costUsd).toFixed(2)}`);
  return parts.filter(Boolean).join(" · ");
}

function normalizeRunMessages(run) {
  // 以事件流为一等来源重建完整 CLI 对话（文本 + 工具调用 + 工具结果 + 轮次分隔）。
  // 载荷读 event.data（normalizeEvent 已从 envelope.data 挂出）、去重键用 event.id，含 seq 供同毫秒 tie-break。
  const items = [];
  const seenEventIds = new Set();
  // 历史全量（per-run 磁盘回放，不受 160 条窗口限制）+ 实时 SSE，按 event.id 去重合并——长会话/重启后完整
  const historical = (state.runEvents && state.runEvents[run.id]) || [];
  const sourceEvents = [...historical, ...state.events.filter((event) => event.runId === run.id)];
  for (const event of sourceEvents) {
    if (event.runId !== run.id) continue;
    if (event.id && seenEventIds.has(event.id)) continue;
    if (event.id) seenEventIds.add(event.id);
    const data = event.data || {};
    const seq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : 0;
    if (event.type === "assistant.message" && (data.text || data.tools?.length)) {
      items.push({ kind: "assistant", author: event.agentId || "Agent", text: data.text || "", tools: data.tools || [], created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "tool.result" && data.results?.length) {
      items.push({ kind: "tool-result", results: data.results, created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "agent.turn_started") {
      items.push({ kind: "divider", text: `第 ${data.round ?? "?"} 轮 · ${agentLabel(data.agentId ?? event.agentId ?? "")}`, created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "agent.turn_completed") {
      // 消息级 token/成本徽标：轮次收尾的统计行（模型/tokens/成本来自适配器回执）
      items.push({ kind: "turn-meta", text: turnMetaText(data, event), created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "tool.event") {
      // codex/pi/gemini/grok-search 适配器发的工具活动——渲染成 CLI 式工具调用行，非 Claude 主脑也可见
      const label = data.command || (data.tool ? `${data.tool}${data.status ? ` · ${data.status}` : ""}` : data.status || "工具");
      items.push({ kind: "assistant", author: event.agentId || "Agent", text: "", tools: [{ name: data.tool || "tool", input: label }], created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "agent.error" || event.type === "adapter.parse_error" || event.type === "adapter.stderr") {
      // 中途失败不静默消失：以错误块呈现在对话里（严禁 silent fallback 的 UI 侧兑现）
      items.push({ kind: "tool-result", results: [{ isError: true, text: data.message || event.content || event.type }], created_at: event.timestamp, seq, key: event.id });
    } else if (event.type === "user.message" && data.text) {
      items.push({ kind: "user", author: "LO", text: data.text, created_at: event.timestamp, seq, key: event.id }); // 续聊的用户追问
    } else if (GOVERNANCE_EVENTS[event.type]) {
      // 治理事件以系统注记进会话流（与 user.message 同列）——写入跳过/降级/重放阻断/授权撤销/轮次检查点
      const governance = GOVERNANCE_EVENTS[event.type];
      items.push({ kind: "governance", tone: governance.tone, text: redact(String(governance.text(data, event))), created_at: event.timestamp, seq, key: event.id });
    }
  }
  // 事件流是一等来源；仅当无实时事件（重启后事件已滚出回放窗口）才用 run.turns 兜底，避免与事件双份。
  // created_at 兜底 run.createdAt，防止 turns 缺时间戳时排序落 epoch-0 把历史轮次倒置到 prompt 之前。
  const fallback = items.length
    ? []
    : Array.isArray(run.messages)
      ? run.messages.map((message, index) => ({
          kind: message.role === "user" ? "user" : "assistant",
          author: message.author ?? message.agentId ?? message.agent_id ?? "Agent",
          text: message.content ?? message.text ?? "",
          created_at: message.createdAt ?? message.created_at ?? message.timestamp ?? run.createdAt,
          seq: index,
          key: String(message.id ?? `base-${index}`),
        }))
      : [];
  const keyed = new Map();
  for (const item of [...fallback, ...items]) keyed.set(item.key, item);
  const all = [...keyed.values()];
  if (run.prompt && !all.some((item) => item.kind === "user" && item.text === run.prompt)) {
    all.push({ kind: "user", author: "LO", text: run.prompt, created_at: run.createdAt, seq: -1, key: "initial-prompt" });
  }
  return all.sort((a, b) => {
    const ta = new Date(a.created_at ?? 0).getTime();
    const tb = new Date(b.created_at ?? 0).getTime();
    return ta !== tb ? ta - tb : (a.seq ?? 0) - (b.seq ?? 0);
  });
}

function messageMarkup(message) {
  // 兼容两代形态：旧 {role, content}（历史预览）与新 {kind, text, tools}（事件流重建）
  const kind = message.kind ?? String(message.role ?? "assistant").toLowerCase();
  if (kind === "divider") {
    return `<div class="turn-divider"><span>${escapeHtml(message.text ?? "")}</span></div>`;
  }
  if (kind === "turn-meta") {
    return `<div class="turn-meta"><span>${escapeHtml(message.text ?? "")}</span><time>${escapeHtml(formatTime(message.created_at))}</time></div>`;
  }
  if (kind === "tool-result") {
    return `<div class="message-row is-tool-result">${(message.results ?? []).map(toolResultMarkup).join("")}</div>`;
  }
  if (kind === "governance") {
    // 治理注记：无头像、竖条 + 小号字（样式在 styles.css 末尾"协作台会话流增强"区块）
    return `<div class="gov-note is-${escapeHtml(message.tone ?? "amber")}"><span>${escapeHtml(message.text ?? "")}</span><time>${escapeHtml(formatTime(message.created_at))}</time></div>`;
  }
  const role = kind === "user" ? "user" : kind === "tool" ? "tool" : "assistant";
  const rawAuthor = message.author ?? message.agent_name ?? message.agentId ?? (role === "user" ? "LO" : role === "tool" ? "工具" : "Agent");
  const author = role === "assistant" ? agentLabel(String(rawAuthor)) : String(rawAuthor);
  const content = message.text ?? message.content ?? message.message ?? message.summary ?? "";
  const avatar = role === "user" ? "LO" : role === "tool" ? "T" : author.slice(0, 2).toUpperCase();
  const className = role === "tool" ? " is-tool" : role === "system" ? " is-system" : "";
  // assistant 输出走 markdown 渲染（用户友好）；用户输入保持原文换行（所见即所输）
  const body = role === "user"
    ? `<p class="message-body">${escapeHtml(redact(String(content)))}</p>`
    : `<div class="message-body md-body">${renderMarkdown(String(content), redact)}</div>`;
  const toolCalls = (message.tools ?? []).map(toolCallMarkup).join("");
  return `
    <article class="message-row${className}">
      <div class="message-avatar" aria-hidden="true">${escapeHtml(avatar)}</div>
      <div class="message-content">
        <div class="message-head"><strong>${escapeHtml(author)}</strong><time>${escapeHtml(formatTime(message.created_at ?? message.timestamp))}</time></div>
        ${body}${toolCalls}
      </div>
    </article>`;
}

function renderRouteDecision(route) {
  if (!route) {
    elements["route-decision"].innerHTML = `<span class="route-model">尚未路由</span><p>任务提交后显示候选模型、能力匹配和守卫条件。</p>`;
    return;
  }
  const name = route.primary?.name || "未选择";
  const reason = route.reasons?.[0] || `策略 ${route.policy || "未标注"}`;
  elements["route-decision"].innerHTML = `<span class="route-model">${escapeHtml(name)}</span><p>${escapeHtml(reason)}</p>`;
}

function renderTopology(run) {
  if (!run) {
    elements["session-topology"].innerHTML = `<div class="empty-state"><span>暂无会话</span></div>`;
    return;
  }
  const sessions = Array.isArray(run.sessions) ? run.sessions : [];
  const root = sessions.find((session) => session.parent_session_id == null || session.role === "orchestrator") ?? {
    name: "Claude 主脑",
    role: "orchestrator",
    status: run.status,
  };
  const children = sessions.filter((session) => session !== root).slice(0, 5);
  const nodes = [root, ...children];
  elements["session-topology"].innerHTML = nodes
    .map((session, index) => {
      const name = session.name ?? session.agent_name ?? session.agent_id ?? session.adapter ?? (index === 0 ? "Claude 主脑" : `Agent ${index}`);
      const role = session.role ?? session.kind ?? (index === 0 ? "orchestrator" : "worker");
      const status = session.status ?? session.state ?? run.status;
      return `<div class="topology-node"><span class="status-dot is-${normalizeStatus(status === "complete" ? "ok" : ACTIVE_RUN_STATES.has(String(status)) ? "pending" : status)}"></span><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role)} · ${escapeHtml(runStatusText(status))}</span></div></div>`;
    })
    .join("");
}

function renderWorkbenchEvents() {
  const run = selectedRun();
  const events = state.events.filter((event) => !run || event.runId === run.id).slice(0, 30);
  elements["workbench-event-list"].innerHTML = events.length
    ? events
        .map(
          (event) => `
          <li class="timeline-item">
            <strong>${escapeHtml(event.type)}</strong>
            <span>${escapeHtml(event.summary)}</span>
            <time>${escapeHtml(formatTime(event.timestamp))}</time>
          </li>`,
        )
        .join("")
    : `<li class="timeline-item"><strong>等待事件</strong><span>SSE 建立后自动刷新</span></li>`;
}

function renderSources() {
  const filter = state.sourceFilter.trim().toLowerCase();
  const filtered = state.sources.filter((source) =>
    [source.name, source.path, source.scope, source.format].some((value) => String(value).toLowerCase().includes(filter)),
  );
  elements["source-count"].textContent = `${filtered.length}/${state.sources.length}`;
  elements["source-list"].innerHTML = filtered.length
    ? filtered
        .map(
          (source) => `
          <button class="source-item${source.id === state.selectedSourceId ? " is-selected" : ""}" type="button" data-source-id="${escapeHtml(source.id)}">
            <span class="source-icon">${escapeHtml(formatBadge(source.format))}</span>
            <span class="source-main">
              <strong>${escapeHtml(source.name)}</strong>
              <span>${escapeHtml(source.path)}</span>
            </span>
            <span class="source-state-icon is-${escapeHtml(source.status)}" title="${escapeHtml(source.status)}"></span>
          </button>`,
        )
        .join("")
    : emptyMarkup("没有匹配项", filter ? "调整筛选条件" : "配置索引尚未加载");
}

async function selectSource(id) {
  if (!id || id === state.selectedSourceId && state.config) return;
  if (configIsDirty()) {
    const proceed = await confirmAction({
      eyebrow: "未保存变更",
      title: "放弃当前编辑？",
      rows: [
        ["当前配置", state.config?.path ?? state.config?.name ?? "--"],
        ["状态", "原文已修改但尚未保存"],
      ],
      warning: "切换配置源会丢弃当前未保存内容。",
      confirmLabel: "放弃并切换",
      danger: true,
    });
    if (!proceed) return;
  }
  state.selectedSourceId = id;
  state.config = null;
  state.versions = [];
  state.pendingPlan = null;
  renderSources();
  renderConfig();
  await loadSelectedConfig();
}

async function loadSelectedConfig() {
  const source = state.sources.find((item) => item.id === state.selectedSourceId);
  if (!source) return;
  setConfigBusy(true);
  try {
    const encoded = encodeURIComponent(source.id);
    const [detailResult, versionsResult] = await Promise.allSettled([
      request(`/api/config/${encoded}`),
      request(`/api/config/${encoded}/versions`),
    ]);
    if (detailResult.status === "rejected") throw detailResult.reason;
    const raw = detailResult.value?.config ?? detailResult.value?.source ?? detailResult.value ?? {};
    const content = typeof raw === "string" ? raw : raw.content ?? raw.raw ?? raw.text ?? raw.value ?? "";
    const serverReadOnly = raw.read_only ?? raw.readOnly ?? (raw.writable === false ? true : null);
    state.config = {
      ...source,
      ...raw,
      id: source.id,
      name: String(raw.name ?? raw.label ?? source.name),
      path: String(raw.path ?? raw.file ?? source.path),
      format: String(raw.format ?? raw.kind ?? source.format),
      scope: String(raw.scope ?? raw.layer ?? source.scope),
      content: String(content),
      baselineContent: String(content),
      sha256: String(raw.sha256 ?? raw.sha ?? raw.etag ?? source.sha256 ?? ""),
      readOnly: source.readOnly || Boolean(serverReadOnly ?? false),
      runtime: source.runtime || Boolean(raw.runtime ?? raw.is_runtime ?? false),
      secret: source.secret || Boolean(raw.secret ?? raw.is_secret ?? false),
      transactionBlocked: source.transactionBlocked || Boolean(raw.transactionBlocked ?? raw.transaction_blocked),
      critical: Boolean(raw.critical ?? source.critical ?? false),
    };
    state.versions =
      versionsResult.status === "fulfilled"
        ? unwrapList(versionsResult.value, ["versions", "snapshots", "history"])
        : [];
    if (versionsResult.status === "rejected") appendDiagnostic(`版本列表读取失败：${versionsResult.reason?.message}`, "warning");
    setValidationStatus("尚未校验", "neutral");
  } catch (error) {
    state.config = null;
    toast(error.message, "error");
    appendDiagnostic(`配置读取失败 ${source.id}: ${error.message}`, "error");
  } finally {
    setConfigBusy(false);
    renderSources();
    renderConfig();
  }
}

function renderConfig() {
  const config = state.config;
  if (!config) {
    elements["editor-title"].textContent = state.selectedSourceId ? "正在加载" : "未选择配置";
    elements["editor-path"].textContent = "--";
    elements["config-format"].textContent = "--";
    elements["config-scope"].textContent = "--";
    elements["config-sha"].textContent = "--";
    elements["config-sha"].title = "";
    elements["config-edit-state"].textContent = "未加载";
    elements["config-editor"].value = "";
    elements["config-editor"].disabled = true;
    elements["readonly-banner"].hidden = true;
    elements["version-list"].innerHTML = emptyMarkup("暂无版本", "选择配置后加载快照");
    elements["config-global-status"].textContent = "等待选择";
    elements["config-global-status"].className = "status-label is-neutral";
    updateConfigControls();
    updateEditorMetrics();
    return;
  }

  elements["editor-title"].textContent = config.name;
  elements["editor-path"].textContent = config.path;
  elements["editor-path"].title = config.path;
  elements["config-format"].textContent = config.format.toUpperCase();
  elements["config-scope"].textContent = config.scope;
  elements["config-sha"].textContent = compactHash(config.sha256);
  elements["config-sha"].title = config.sha256;
  elements["config-editor"].value = config.content;
  elements["config-editor"].disabled = config.readOnly || state.configBusy;

  const restricted = config.readOnly || config.runtime || config.secret;
  elements["config-edit-state"].textContent = restricted ? "只读" : configIsDirty() ? "已修改" : "无变更";
  elements["readonly-banner"].hidden = !restricted && !config.critical;
  if (restricted || config.critical) {
    if (config.transactionBlocked) {
      elements["readonly-title"].textContent = "事务状态不一致，写入已阻断";
      elements["readonly-detail"].textContent = "当前内容仍可检查；请核对事务 manifest 与源文件哈希后再解除阻断。";
    } else if (config.secret) {
      elements["readonly-title"].textContent = "Secret 不在前端回显或直接写入";
      elements["readonly-detail"].textContent = "此处仅显示引用状态，密钥值由受控 Secret 接口管理。";
    } else if (config.runtime) {
      elements["readonly-title"].textContent = "运行时配置不可直接修改";
      elements["readonly-detail"].textContent = "请修改仓库真源，并通过 runtime sync 部署。";
    } else if (config.critical) {
      elements["readonly-title"].textContent = "关键配置需要显式确认";
      elements["readonly-detail"].textContent = "控制面会在写入前展示 Diff、基准 SHA 与回滚策略。";
    } else {
      elements["readonly-title"].textContent = "此配置受保护";
      elements["readonly-detail"].textContent = "控制面策略禁止直接写入。";
    }
  }
  elements["config-global-status"].textContent = restricted ? "只读" : configIsDirty() ? "有未保存变更" : "已加载";
  elements["config-global-status"].className = `status-label is-${restricted ? "warning" : configIsDirty() ? "warning" : "ok"}`;
  renderVersions();
  updateConfigControls();
  updateEditorMetrics();
}

function renderVersions() {
  elements["version-list"].innerHTML = state.versions.length
    ? state.versions
        .map((version, index) => {
          const id = String(version.versionId ?? version.id ?? version.version_id ?? version.snapshot_id ?? version.sha256 ?? index);
          const hash = String(version.fromSha256 ?? version.sha256 ?? version.sha ?? version.after_sha256 ?? id);
          const created = version.createdAt ?? version.created_at ?? version.timestamp ?? version.at;
          const reason = version.reason ?? version.message ?? version.actor ?? "配置快照";
          return `
            <div class="version-row">
              <div class="version-main">
                <strong title="${escapeHtml(hash)}">${escapeHtml(compactHash(hash))}</strong>
                <span>${escapeHtml(formatDate(created))} · ${escapeHtml(reason)}</span>
              </div>
              <button class="rollback-button" type="button" data-version-id="${escapeHtml(id)}" title="回滚到此版本" aria-label="回滚到 ${escapeHtml(compactHash(hash))}" ${state.config?.readOnly ? "disabled" : ""}>
                <svg class="icon"><use href="#icon-history"></use></svg>
              </button>
            </div>`;
        })
        .join("")
    : emptyMarkup("暂无版本", "保存后会生成可回滚快照");
}

function configIsDirty() {
  if (!state.config) return false;
  return elements["config-editor"].value !== state.config.baselineContent;
}

function updateEditorFromInput() {
  if (!state.config) return;
  state.config.content = elements["config-editor"].value;
  state.pendingPlan = null;
  elements["diff-summary"].textContent = "预览已失效";
  elements["diff-output"].textContent = "原文发生变化，请重新预览。";
  setValidationStatus("内容已修改，等待校验", "warning");
  elements["config-edit-state"].textContent = configIsDirty() ? "已修改" : "无变更";
  elements["config-global-status"].textContent = configIsDirty() ? "有未保存变更" : "已加载";
  elements["config-global-status"].className = `status-label is-${configIsDirty() ? "warning" : "ok"}`;
  updateEditorMetrics();
  updateConfigControls();
}

function updateEditorMetrics() {
  const value = elements["config-editor"].value ?? "";
  const lineCount = value ? value.split(/\r?\n/).length : 0;
  elements["editor-cursor-status"].textContent = `${lineCount} 行 · ${value.length} 字符`;
}

function setValidationStatus(text, status = "neutral") {
  elements["editor-validation-status"].textContent = text;
  elements["editor-validation-status"].className = status === "neutral" ? "" : `is-${status}`;
}

function setConfigBusy(busy) {
  state.configBusy = busy;
  updateConfigControls();
}

function updateConfigControls() {
  const hasConfig = Boolean(state.config);
  const writable = hasConfig && !state.config.readOnly && !state.config.runtime && !state.config.secret;
  const dirty = writable && configIsDirty();
  elements["validate-config-button"].disabled = !hasConfig || state.configBusy;
  elements["plan-config-button"].disabled = !dirty || state.configBusy;
  elements["apply-config-button"].disabled = !dirty || state.configBusy;
  elements["config-editor"].disabled = !writable || state.configBusy;
}

function configPayload() {
  return {
    content: elements["config-editor"].value,
    baseSha256: state.config?.sha256 ?? "",
    source: "control-center",
  };
}

async function configAction(action, body = configPayload()) {
  if (!state.config) throw new Error("未选择配置");
  const headers = {};
  if (state.config.sha256) headers["If-Match"] = state.config.sha256;
  return request(`/api/config/${encodeURIComponent(state.config.id)}/${action}`, {
    method: "POST",
    headers,
    body,
  });
}

async function validateConfig() {
  if (!state.config) return;
  setConfigBusy(true);
  setValidationStatus("正在校验", "warning");
  try {
    const result = await configAction("validate");
    const valid = result?.valid ?? result?.ok ?? result?.status === "valid" ?? true;
    const diagnostics = unwrapList(result, ["diagnostics", "errors", "issues"]);
    if (valid && diagnostics.filter((item) => (item.severity ?? item.level) === "error").length === 0) {
      setValidationStatus("校验通过", "ok");
      toast("配置校验通过", "success");
    } else {
      const first = diagnostics[0]?.message ?? result?.message ?? "配置校验失败";
      setValidationStatus(String(first), "error");
      toast(first, "error");
    }
    appendDiagnostic(`配置校验 ${state.config.id}: ${valid ? "valid" : "invalid"}`);
    return result;
  } catch (error) {
    setValidationStatus(error.message, "error");
    toast(error.message, "error");
    appendDiagnostic(`配置校验失败 ${state.config.id}: ${error.message}`, "error");
    throw error;
  } finally {
    setConfigBusy(false);
  }
}

async function planConfig() {
  if (!state.config || !configIsDirty()) return null;
  setConfigBusy(true);
  try {
    const result = await configAction("plan");
    const planValid = result?.validation?.valid ?? result?.valid ?? true;
    state.pendingPlan = planValid ? (result ?? {}) : null;
    const diff = extractDiff(result) || createLocalDiff(state.config.baselineContent, elements["config-editor"].value);
    renderDiff(diff);
    const count = result?.change_count ?? result?.changes?.length ?? countDiffChanges(diff);
    elements["diff-summary"].textContent = `${count} 处变更`;
    setValidationStatus(planValid ? "变更计划已生成" : "计划校验失败", planValid ? "ok" : "error");
    toast(planValid ? "变更计划已生成" : "候选配置未通过校验", planValid ? "success" : "error");
    appendDiagnostic(`配置计划 ${state.config.id}: ${count} 处变更`);
    return result;
  } catch (error) {
    state.pendingPlan = null;
    elements["diff-summary"].textContent = "计划失败";
    elements["diff-output"].textContent = redact(error.message);
    setValidationStatus(error.message, "error");
    toast(error.message, "error");
    appendDiagnostic(`配置计划失败 ${state.config.id}: ${error.message}`, "error");
    throw error;
  } finally {
    setConfigBusy(false);
  }
}

function extractDiff(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.diff === "string") return result.diff;
  if (result.diff && typeof result.diff === "object") {
    const lines = Array.isArray(result.diff.lines) ? result.diff.lines : [];
    if (lines.length) {
      return lines
        .map((line) => {
          if (typeof line === "string") return line;
          const kind = String(line.type ?? line.kind ?? line.operation ?? "context").toLowerCase();
          const prefix = kind === "add" || kind === "added" || kind === "insert" ? "+ " : kind === "remove" || kind === "removed" || kind === "delete" ? "- " : "  ";
          return `${prefix}${line.content ?? line.text ?? line.value ?? ""}`;
        })
        .join("\n");
    }
    if (result.diff.summary) return String(result.diff.summary);
  }
  if (typeof result.patch === "string") return result.patch;
  if (Array.isArray(result.changes)) {
    return result.changes
      .map((change) => {
        if (typeof change === "string") return change;
        const path = change.path ?? change.pointer ?? change.field ?? "value";
        return `- ${path}: ${JSON.stringify(change.before ?? change.old ?? null)}\n+ ${path}: ${JSON.stringify(change.after ?? change.new ?? null)}`;
      })
      .join("\n");
  }
  return "";
}

function createLocalDiff(before, after) {
  if (before === after) return "无变更";
  const left = String(before).split(/\r?\n/);
  const right = String(after).split(/\r?\n/);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const removed = left.slice(prefix, left.length - suffix);
  const added = right.slice(prefix, right.length - suffix);
  const contextBefore = left.slice(Math.max(0, prefix - 2), prefix);
  const contextAfter = suffix ? left.slice(left.length - suffix, Math.min(left.length, left.length - suffix + 2)) : [];
  return [
    `@@ line ${prefix + 1} @@`,
    ...contextBefore.map((line) => `  ${line}`),
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
    ...contextAfter.map((line) => `  ${line}`),
  ].join("\n");
}

function countDiffChanges(diff) {
  return String(diff)
    .split(/\r?\n/)
    .filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || (line.startsWith("-") && !line.startsWith("---"))).length;
}

function renderDiff(diff) {
  elements["diff-output"].innerHTML = String(diff)
    .split(/\r?\n/)
    .map((line) => {
      const className = line.startsWith("+") && !line.startsWith("+++") ? "diff-line-add" : line.startsWith("-") && !line.startsWith("---") ? "diff-line-remove" : "";
      return `<span class="${className}">${escapeHtml(line)}</span>`;
    })
    .join("\n");
}

async function applyConfig() {
  if (!state.config || !configIsDirty()) return;
  if (!state.pendingPlan) {
    try {
      await planConfig();
    } catch {
      return;
    }
    if (!state.pendingPlan) return;
  }
  const diff = extractDiff(state.pendingPlan) || createLocalDiff(state.config.baselineContent, elements["config-editor"].value);
  const confirmed = await confirmAction({
    eyebrow: "配置事务",
    title: "确认保存配置？",
    rows: [
      ["配置源", state.config.path],
      ["基准 SHA", compactHash(state.config.sha256)],
      ["变更数量", String(countDiffChanges(diff))],
      ["写入方式", "备份后原子替换"],
    ],
    warning: state.config.critical
      ? "这是关键配置。保存仅修改仓库真源，并会生成审计快照；运行时部署仍需单独审批。"
      : "保存仅修改仓库真源。运行时部署应由后端按审批策略单独执行。",
    confirmLabel: "确认保存",
  });
  if (!confirmed) return;

  setConfigBusy(true);
  try {
    const planId = state.pendingPlan?.plan_id ?? state.pendingPlan?.planId ?? state.pendingPlan?.id ?? null;
    if (!planId) throw new Error("变更计划缺少 planId，请重新预览后再保存");
    const confirmation = state.config.critical ? state.config.id : null;
    const result = await configAction("apply", { ...configPayload(), planId, confirmation });
    if (result?.auditDegraded) {
      toast("配置已提交，但审计日志降级；请检查事务 manifest", "error", 7000);
      appendDiagnostic(`配置已提交但审计降级 ${state.config.id}: ${result.auditError ?? "unknown"}`, "error");
    } else {
      const activation = result?.activation;
      if (activation?.status === "reloaded") {
        toast(`配置已保存并热重载（generation ${activation.generation}）`, "success");
      } else if (activation?.status === "restart-required") {
        toast(`配置已保存；${activation.reason}`, "warning", 7000);
      } else {
        toast("配置已保存并生成版本快照", "success");
      }
      appendDiagnostic(`配置应用完成 ${state.config.id}`);
    }
    state.pendingPlan = null;
    await loadSources();
    await loadSelectedConfig();
    const applied = result?.config ?? result;
    if (applied?.sha256) elements["config-sha"].textContent = compactHash(applied.sha256);
  } catch (error) {
    if (error.status === 409 || error.status === 412) {
      toast("配置已被其他会话修改，请刷新后重新计划", "warning", 5200);
      setValidationStatus("SHA 冲突，请刷新", "error");
    } else {
      toast(error.message, "error");
      setValidationStatus(error.message, "error");
    }
    appendDiagnostic(`配置应用失败 ${state.config.id}: ${error.message}`, "error");
  } finally {
    setConfigBusy(false);
  }
}

async function rollbackConfig(versionId) {
  if (!state.config || state.config.readOnly) return;
  const version = state.versions.find(
    (item, index) => String(item.versionId ?? item.id ?? item.version_id ?? item.snapshot_id ?? item.sha256 ?? index) === String(versionId),
  );
  const hash = version?.fromSha256 ?? version?.sha256 ?? version?.sha ?? version?.after_sha256 ?? versionId;
  const confirmed = await confirmAction({
    eyebrow: "版本回滚",
    title: "确认创建回滚事务？",
    rows: [
      ["配置源", state.config.path],
      ["目标版本", compactHash(hash)],
      ["当前 SHA", compactHash(state.config.sha256)],
      ["策略", "以新事务恢复，不删除历史"],
    ],
    warning: "回滚会替换当前真源内容，并生成新的审计版本。",
    confirmLabel: "确认回滚",
    danger: true,
  });
  if (!confirmed) return;

  setConfigBusy(true);
  try {
    await configAction("rollback", {
      versionId,
      baseSha256: state.config.sha256,
      confirmation: state.config.id,
      source: "control-center",
    });
    toast("回滚事务已完成", "success");
    appendDiagnostic(`配置回滚完成 ${state.config.id} -> ${versionId}`);
    await loadSources();
    await loadSelectedConfig();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`配置回滚失败 ${state.config.id}: ${error.message}`, "error");
  } finally {
    setConfigBusy(false);
  }
}

function renderRouter() {
  const route = state.routePreview;
  if (!route) {
    elements["router-status"].textContent = "等待预览";
    elements["router-status"].className = "status-label is-neutral";
    elements["route-result-meta"].textContent = "尚无路由记录";
    elements["router-primary-decision"].innerHTML = `<span class="agent-avatar">--</span><div><span>主执行</span><strong>等待任务画像</strong></div>`;
    elements["router-decision-facts"].innerHTML = "";
    elements["router-reason-list"].innerHTML = "";
    elements["router-candidate-body"].innerHTML = `<tr><td colspan="5" class="subtle">生成路由预览后显示全部候选与排除原因。</td></tr>`;
    return;
  }
  const primary = route.primary ?? { name: "未选择", adapter: "" };
  elements["router-status"].textContent = "预览完成";
  elements["router-status"].className = "status-label is-ok";
  elements["route-result-meta"].textContent = `生成于 ${formatDate(route.createdAt)}`;
  const avatar = (primary.name || primary.adapter || "--").slice(0, 2).toUpperCase();
  elements["router-primary-decision"].innerHTML = `
    <span class="agent-avatar">${escapeHtml(avatar)}</span>
    <div><span>主执行 · ${escapeHtml(primary.adapter || "adapter 未标注")}</span><strong>${escapeHtml(primary.name)}</strong></div>`;
  elements["router-decision-facts"].innerHTML = [
    ["置信度", route.confidence],
    ["命中策略", route.policy],
    ["独立验证", typeof route.verifier === "object" ? route.verifier.name ?? route.verifier.id : route.verifier],
  ]
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "--")}</dd></div>`)
    .join("");
  const reasons = route.reasons?.length ? route.reasons : ["控制面未返回详细路由依据。"];
  elements["router-reason-list"].innerHTML = reasons
    .map((reason, index) => `<div class="reason-row"><span class="reason-index">${index + 1}</span><p>${escapeHtml(reason)}</p></div>`)
    .join("");
  // 候选评分全表：入选/排除都如实呈现（排除原因来自 router 的 excludedReasons，不吞）
  const selectedId = route.selected?.id ?? route.primary?.id ?? null;
  elements["router-candidate-body"].innerHTML = (route.candidates ?? [])
    .map((candidate) => {
      const isSelected = candidate.id === selectedId;
      const healthStatus = candidate.health?.status ?? "unknown";
      const verdict = candidate.excluded
        ? (candidate.excludedReasons ?? []).join("、") || "已排除"
        : isSelected ? "已选主执行" : "备选";
      return `<tr class="${candidate.excluded ? "is-excluded" : isSelected ? "is-selected" : ""}">
        <td><strong>${escapeHtml(candidate.label ?? candidate.id ?? "?")}</strong><br><span class="subtle mono">${escapeHtml(candidate.id ?? "")}</span></td>
        <td class="mono">${escapeHtml(String(candidate.score ?? "--"))}</td>
        <td class="mono">${escapeHtml(String(candidate.capabilityMatch ?? "--"))}</td>
        <td><span class="status-label is-${healthStatus === "online" ? "ok" : healthStatus === "degraded" ? "warning" : "error"}">${escapeHtml(healthStatus)}</span></td>
        <td>${escapeHtml(redact(verdict))}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="5" class="subtle">路由结果未携带候选明细。</td></tr>`;
}

function renderModels() {
  elements["model-table-body"].innerHTML = state.models.length
    ? state.models
        .map((model) => {
          const status = normalizeStatus(model.status);
          return `
            <tr>
              <td><span class="model-role">${escapeHtml(model.role)}</span></td>
              <td><strong>${escapeHtml(model.adapter)}</strong><br><span class="subtle">${escapeHtml(model.model)}</span></td>
              <td>${escapeHtml(model.strengths.join(" · "))}</td>
              <td><span class="status-label is-${status}">${escapeHtml(statusText(status))}</span></td>
              <td>${escapeHtml(formatDate(model.verifiedAt, "未验证"))}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="subtle">模型注册表尚未加载。</td></tr>`;
}

async function previewRoute(prompt, kind, risk, currentSource) {
  const taskType = kind === "auto" ? undefined : kind;
  const payload = await request(API.routerPreview, {
    method: "POST",
    body: {
      prompt,
      taskType,
      risk,
      needsCurrentSource: Boolean(currentSource),
      teamId: state.selectedTeamId, // 预览与正式路由同一团队契约（烛 R10 致命2）
    },
  });
  state.routePreview = normalizeRoute(payload);
  const models = objectList(payload, ["models", "candidates"]);
  if (models.length && payload.models) state.models = models.map(normalizeModel);
  renderRouter();
  renderModels();
  renderRouteDecision(state.routePreview);
  return state.routePreview;
}

async function handleRouterSubmit(event) {
  event.preventDefault();
  const prompt = elements["router-prompt"].value.trim();
  if (!prompt) return;
  const button = elements["router-form"].querySelector("button[type='submit']");
  button.disabled = true;
  elements["router-status"].textContent = "路由中";
  elements["router-status"].className = "status-label is-pending";
  try {
    await previewRoute(prompt, elements["router-kind"].value, elements["router-risk"].value, elements["router-current-source"].checked);
    toast("路由预览已生成", "success");
    appendDiagnostic(`路由预览完成：${state.routePreview.primary?.name ?? "未选择"}`);
  } catch (error) {
    elements["router-status"].textContent = "预览失败";
    elements["router-status"].className = "status-label is-error";
    toast(error.message, "error");
    appendDiagnostic(`路由预览失败：${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function createRun(event) {
  event.preventDefault();
  // 胶囊双模式分流：选中任务且非历史预览 → 续聊当前原生会话；否则新建任务
  if (selectedRun() && !state.sessionPreview) return continueSelectedRun(event);
  const prompt = elements["task-input"].value.trim();
  if (!prompt) return;
  const risk = new FormData(elements["task-form"]).get("risk") ?? "medium";
  const needsCurrentSource = elements["task-current-source"].checked;
  const permissionMode = String(new FormData(elements["task-form"]).get("permissionMode") ?? "plan");
  elements["submit-task-button"].disabled = true;

  let route = null;
  try {
    route = await previewRoute(prompt, "auto", String(risk), needsCurrentSource);
  } catch (error) {
    appendDiagnostic(`任务预路由不可用，将由运行时最终路由：${error.message}`, "warning");
  }

  try {
    const payload = await request(API.runs, {
      method: "POST",
      body: {
        prompt,
        taskType: undefined,
        risk,
        execute: true,
        collaborationMode: "deep",
        permissionMode,
        needsCurrentSource,
        teamId: state.selectedTeamId, // 会话按所选团队隔离能力配比
        maxBudgetUsdPerTurn: 2, // 真实 CLI 带工具轮，0.75 默认必超线；用满 policy 上限（permissions.json 可调）
        model: elements["task-model"]?.value || undefined, // /model：本会话 claude 主脑模型（空=profile 默认 fable）
        cwd: state.pendingCwd || undefined, // 会话项目地址（空=控制面默认 repoRoot）
      },
    });
    const raw = payload?.run ?? payload;
    const run = normalizeRun(raw ?? { prompt, risk, status: "planning" }, 0);
    state.runs = [run, ...state.runs.filter((item) => item.id !== run.id)];
    if (state.sessionPreview) closeSessionPreview({ restoreFocus: false }); // 新任务落地即退出历史预览（烛 R5 致命2）
    state.selectedRunId = run.id;
    elements["task-input"].value = "";
    toast("任务已交给控制面", "success");
    appendDiagnostic(`任务创建 ${run.id}: ${prompt.slice(0, 80)}`);
    renderRuns();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`任务创建失败：${error.message}`, "error");
  } finally {
    elements["submit-task-button"].disabled = false;
  }
}

async function continueSelectedRun(event) {
  event.preventDefault();
  const run = selectedRun();
  const prompt = elements["task-input"].value.trim();
  if (!run || !prompt) return;
  const button = elements["submit-task-button"];
  button.disabled = true;
  try {
    // 恢复条确认后，本次续聊带服务端要求的 acknowledgeRecovery:true（orchestrator 584-590 的消费点）
    const acknowledge = state.recoveryAckRunId === run.id;
    const payload = await request(`/api/runs/${encodeURIComponent(run.id)}/messages`, {
      method: "POST",
      body: { prompt, agentId: elements["followup-agent"].value, ...(acknowledge ? { acknowledgeRecovery: true } : {}) },
    });
    const updated = normalizeRun(payload?.run ?? payload, 0);
    state.runs = [updated, ...state.runs.filter((item) => item.id !== updated.id)];
    state.recoveryAckRunId = null; // 确认标记一次性消费
    elements["task-input"].value = "";
    // 排队与即时送达如实区分：活跃 run 的 continue 进 pendingSteer，不是"已完成"
    const queuedDepth = Array.isArray(updated.pendingSteer) ? updated.pendingSteer.length : 0;
    toast(queuedDepth ? `轮间插话已排队（第 ${queuedDepth} 位），当前轮结束后送达` : "续接消息已完成", "success");
    renderRuns();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`会话续接失败 ${run.id}: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

async function cancelSelectedRun() {
  const run = selectedRun();
  if (!run || !ACTIVE_RUN_STATES.has(run.status)) return;
  const confirmed = await confirmAction({
    eyebrow: "任务控制",
    title: "取消当前任务？",
    rows: [
      ["任务", run.title],
      ["Run ID", run.id],
      ["当前状态", runStatusText(run.status)],
    ],
    warning: "控制面将终止本任务仍在运行的 Agent 子进程。已生成的事件和产物会保留。",
    confirmLabel: "确认取消",
    danger: true,
  });
  if (!confirmed) return;
  elements["cancel-run-button"].disabled = true;
  try {
    await request(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST", body: { source: "control-center" } });
    run.status = "cancelled";
    toast("取消请求已提交", "success");
    appendDiagnostic(`任务取消 ${run.id}`);
    renderRuns();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`任务取消失败 ${run.id}: ${error.message}`, "error");
    elements["cancel-run-button"].disabled = false;
  }
}

function normalizeEvent(raw, eventName = "message") {
  const envelope = raw?.event ?? raw ?? {};
  const payloadRaw = envelope.data ?? envelope.payload ?? {};
  const payload = payloadRaw && typeof payloadRaw === "object" ? payloadRaw : {};
  const type = String(envelope.type ?? envelope.event_type ?? eventName ?? "message");
  const isPrivateReasoning = /thinking|reasoning/i.test(type);
  let content =
    envelope.content ??
    envelope.message ??
    envelope.summary ??
    payload.text ??
    payload.message ??
    payload.summary ??
    payload.delta ??
    payload.reason ??
    payload.status ??
    payload.code ??
    "";
  if (isPrivateReasoning) content = "模型推理状态已更新";
  if (!content) content = type;
  return {
    id: String(envelope.eventId ?? envelope.event_id ?? envelope.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type,
    timestamp: envelope.occurred_at ?? envelope.timestamp ?? envelope.created_at ?? new Date().toISOString(),
    seq: envelope.sequence ?? envelope.seq ?? "--",
    runId: String(envelope.runId ?? envelope.run_id ?? payload.runId ?? payload.run_id ?? ""),
    sessionId: String(envelope.sessionId ?? envelope.session_id ?? payload.sessionId ?? payload.session_id ?? ""),
    agentId: String(envelope.agentId ?? envelope.agent_id ?? payload.agentId ?? payload.agent_id ?? ""),
    correlationId: String(envelope.correlationId ?? envelope.correlation_id ?? ""),
    summary: redact(String(content)).slice(0, 500),
    content: redact(String(content)),
    data: payload, // 结构化载荷（assistant text+tools / tool.result results / turn round）——对话重建一等来源
    raw: envelope,
  };
}

function pushEvent(event) {
  const sequence = Number(event.seq);
  if (Number.isSafeInteger(sequence)) state.lastEventSequence = Math.max(state.lastEventSequence, sequence);
  const previous = state.events[0];
  if (
    previous &&
    /\.delta$/.test(event.type) &&
    previous.type === event.type &&
    previous.runId === event.runId &&
    previous.sessionId === event.sessionId &&
    previous.correlationId === event.correlationId
  ) {
    previous.summary = `${previous.summary}${event.summary}`.slice(-500);
    previous.content = `${previous.content}${event.content}`.slice(-4000);
    previous.timestamp = event.timestamp;
    previous.seq = event.seq;
  } else if (!state.events.some((item) => item.id === event.id)) {
    state.events.unshift(event);
    state.events = state.events.slice(0, 160);
  }
  if (/run\.|task\.|session\.|message|tool|route|approval|config\./i.test(event.type)) {
    appendDiagnostic(`${event.type} ${event.summary}`);
  }
  renderOverview();
  // 只有属于当前选中 run（或全局事件）才重写对话流；无关 run 的事件仅更新事件列表，避免整屏重渲染闪烁
  if (!state.selectedRunId || !event.runId || event.runId === state.selectedRunId || state.sessionPreview) renderSelectedRun();
  else renderWorkbenchEvents();
  if (/run\.(created|updated|completed|failed|cancelled|steer_queued|steer_dropped)|task\.|agent\.turn_completed|assistant\.message/i.test(event.type)) scheduleRunsReload();
  if (/config\.(changed|applied|rolled_back|updated)/i.test(event.type)) scheduleSourcesReload();
  if (/approval\.(pending|resolved|expired)/i.test(event.type)) void loadApprovals().catch(() => {});
}

let runsReloadTimer = 0;
let sourcesReloadTimer = 0;
function scheduleRunsReload() {
  window.clearTimeout(runsReloadTimer);
  runsReloadTimer = window.setTimeout(() => void loadRuns().catch(() => {}), 450);
}
function scheduleSourcesReload() {
  window.clearTimeout(sourcesReloadTimer);
  sourcesReloadTimer = window.setTimeout(() => void loadSources().catch(() => {}), 450);
}

function parseSseFrame(frame) {
  let eventName = "message";
  let id = "";
  const data = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue;
    const separator = rawLine.indexOf(":");
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator);
    const value = separator < 0 ? "" : rawLine.slice(separator + 1).replace(/^ /, "");
    if (field === "event") eventName = value;
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }
  if (!data.length || eventName === "ready") return;
  const parsed = JSON.parse(data.join("\n"));
  const event = normalizeEvent(parsed, eventName);
  if (id && event.seq === "--") event.seq = Number(id) || id;
  pushEvent(event);
}

async function consumeEvents(controller) {
  let retryMs = 1200;
  while (!controller.signal.aborted) {
    try {
      const headers = { Accept: "text/event-stream" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetch(`${API.events}?after=${state.lastEventSequence}`, { headers, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`事件通道返回 HTTP ${response.status}`);
      setEventState("ok");
      const component = state.components.find((item) => item.id === "event-bus");
      if (component) component.status = "ok";
      renderOverview();
      appendDiagnostic("SSE 事件通道已连接");
      retryMs = 1200;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const match = /\r?\n\r?\n/.exec(buffer);
          if (!match) break;
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          try { parseSseFrame(frame); } catch (error) { appendDiagnostic(`事件解析失败：${error.message}`, "warning"); }
        }
      }
      if (!controller.signal.aborted) throw new Error("事件通道已关闭");
    } catch (error) {
      if (controller.signal.aborted) return;
      setEventState("error");
      const component = state.components.find((item) => item.id === "event-bus");
      if (component) component.status = "warning";
      renderOverview();
      appendDiagnostic(`SSE 重连：${error.message}`, "warning");
      await new Promise((resolve) => window.setTimeout(resolve, retryMs));
      retryMs = Math.min(retryMs * 2, 10_000);
    }
  }
}

function connectEvents() {
  state.eventController?.abort();
  setEventState("pending");
  const controller = new AbortController();
  state.eventController = controller;
  void consumeEvents(controller);
}

function renderApprovals() {
  const pending = state.approvals.filter((item) => (item.status ?? "pending") === "pending");
  elements["approval-summary"].textContent = `${pending.length} 项待处理`;
  elements["approval-summary"].className = `status-label is-${pending.length ? "warning" : "ok"}`;
  elements["approval-list"].innerHTML = pending.length
    ? pending
        .map((item) => {
          const method = String(item.method ?? "unknown");
          const broadPermission = method === "item/permissions/requestApproval";
          const params = redact(JSON.stringify(item.params ?? {}, null, 2));
          return `
            <article class="approval-row">
              <div class="approval-main">
                <strong>${escapeHtml(method)}</strong>
                <span>Run ${escapeHtml(item.runId ?? "--")} · 到期 ${escapeHtml(formatDate(item.expiresAt))}</span>
                <code>${escapeHtml(item.actionSha256 ?? "--")}</code>
                <pre class="approval-params">${escapeHtml(params || "无公开参数")}</pre>
              </div>
              <div class="approval-actions">
                <button class="button secondary" type="button" data-approval-id="${escapeHtml(item.id)}" data-approval-decision="deny">拒绝</button>
                <button class="button primary" type="button" data-approval-id="${escapeHtml(item.id)}" data-approval-decision="approve"${broadPermission ? " disabled title=\"v1 不支持广域权限授权\"" : ""}>批准</button>
              </div>
            </article>`;
        })
        .join("")
    : emptyMarkup("暂无待处理审批", "权限请求会在这里等待显式决定");
}

async function resolveApproval(id, decision) {
  const item = state.approvals.find((approval) => approval.id === id);
  if (!item) return;
  const approved = decision === "approve";
  const confirmed = await confirmAction({
    eyebrow: "动作审批",
    title: approved ? "批准此动作？" : "拒绝此动作？",
    rows: [
      ["方法", item.method],
      ["Run ID", item.runId ?? "--"],
      ["动作哈希", item.actionSha256 ?? "--"],
      ["决定", approved ? "approve" : "deny"],
    ],
    warning: approved ? "批准只对当前动作哈希生效，不会创建持续授权。" : "拒绝后 Agent 会收到 fail-closed 响应。",
    confirmLabel: approved ? "确认批准" : "确认拒绝",
    danger: !approved,
  });
  if (!confirmed) return;
  const buttons = [...elements["approval-list"].querySelectorAll(`[data-approval-id="${CSS.escape(id)}"]`)];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await request(`${API.approvals}/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { decision, actionSha256: item.actionSha256, actor: "control-center" },
    });
    toast(approved ? "动作已批准" : "动作已拒绝", approved ? "success" : "warning");
    await loadApprovals();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`审批处理失败 ${id}: ${error.message}`, "error");
    await loadApprovals().catch(() => {});
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function renderSecurity() {
  elements["policy-list"].innerHTML = state.policies
    .map(
      (policy) => `
      <div class="policy-row">
        <div class="policy-main"><strong>${escapeHtml(policy.name)}</strong><span>${escapeHtml(policy.detail)}</span></div>
        <span class="policy-value">${escapeHtml(policy.value)}</span>
      </div>`,
    )
    .join("");
  elements["secret-list"].innerHTML = state.secrets
    .map((secret) => {
      const text = secret.configured === true ? "已配置" : secret.configured === false ? "未配置" : "状态未知";
      const detail = secret.fingerprint ? `${secret.reference} · ${secret.fingerprint}` : secret.reference;
      return `
        <div class="secret-row">
          <div class="secret-main"><strong>${escapeHtml(secret.name)}</strong><span>${escapeHtml(detail)}</span></div>
          <span class="secret-value">${escapeHtml(text)}</span>
        </div>`;
    })
    .join("");
  renderApprovals();

  const healthErrors = state.components.filter((item) => normalizeStatus(item.status) === "error").length;
  elements["security-summary"].textContent = healthErrors ? `${healthErrors} 项异常` : state.apiState === "ok" ? "门禁已加载" : "检查中";
  elements["security-summary"].className = `status-label is-${healthErrors ? "error" : state.apiState === "ok" ? "ok" : "pending"}`;
}

function upsertDiagnostic(list, item) {
  const key = `${item.method}:${item.path}`;
  return [item, ...list.filter((existing) => `${existing.method}:${existing.path}` !== key)];
}

async function probe(path, method = "GET") {
  const started = performance.now();
  try {
    const payload = await request(path, { method });
    return {
      path,
      method,
      status: "ok",
      latency: performance.now() - started,
      result: payload?.status ?? payload?.ok ?? "响应正常",
    };
  } catch (error) {
    return {
      path,
      method,
      status: "error",
      latency: performance.now() - started,
      result: error.message,
    };
  }
}

async function runDiagnostics() {
  elements["run-diagnostics-button"].disabled = true;
  elements["diagnostics-updated"].textContent = "正在探测";
  const safeEndpoints = [API.bootstrap, API.health, API.sources, API.runs];
  const results = await Promise.all(safeEndpoints.map((path) => probe(path)));
  state.diagnostics = results;
  state.diagnostics.push({
    path: API.events,
    method: "SSE",
    status: state.eventState === "ok" ? "ok" : state.eventState === "error" ? "warning" : "pending",
    latency: null,
    result: state.eventState === "ok" ? "事件流已建立" : "等待或正在重连",
  });
  elements["diagnostics-updated"].textContent = `检查于 ${formatDate(new Date())}`;
  elements["run-diagnostics-button"].disabled = false;
  const failures = results.filter((item) => item.status === "error").length;
  appendDiagnostic(`端点诊断完成：${results.length - failures}/${results.length} 正常`, failures ? "warning" : "info");
  renderDiagnostics();
  renderSecurity();
}

async function reloadRuntime() {
  elements["reload-runtime-button"].disabled = true;
  try {
    const result = await request(API.runtimeReload, { method: "POST", body: {} });
    if (result?.status === "reloaded") {
      toast(`运行策略已重载（generation ${result.generation}）`, "success");
      appendDiagnostic(`控制面运行策略重载成功 generation=${result.generation}`);
      await loadBootstrap();
    } else {
      toast(result?.reason || "当前状态需要重启控制面", "warning", 7000);
      appendDiagnostic(`控制面未热重载: ${result?.reason || result?.status}`, "warning");
    }
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`控制面重载失败: ${error.message}`, "error");
  } finally {
    elements["reload-runtime-button"].disabled = false;
  }
}

function renderDiagnostics() {
  elements["diagnostics-table-body"].innerHTML = state.diagnostics.length
    ? state.diagnostics
        .map((item) => {
          const status = normalizeStatus(item.status);
          return `
            <tr>
              <td class="mono">${escapeHtml(item.path)}</td>
              <td>${escapeHtml(item.method)}</td>
              <td><span class="status-label is-${status}">${escapeHtml(statusText(status))}</span></td>
              <td>${item.latency == null ? "--" : escapeHtml(formatDuration(item.latency))}</td>
              <td>${escapeHtml(redact(item.result))}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" class="subtle">尚未执行端点诊断。</td></tr>`;
}

function renderDiagnosticLog() {
  if (!elements["diagnostic-log"]) return;
  elements["diagnostic-log"].textContent = state.diagnosticLog.length ? state.diagnosticLog.join("\n") : "等待控制面事件。";
}

function renderAll() {
  renderOverview();
  renderRuns();
  renderSources();
  renderConfig();
  renderRouter();
  renderModels();
  renderSecurity();
  renderDiagnostics();
  renderDiagnosticLog();
}

async function refreshCurrentView() {
  elements["refresh-button"].disabled = true;
  const jobs = [];
  if (state.view === "overview") jobs.push(loadHealth(), loadRuns(), loadSources());
  if (state.view === "workbench") jobs.push(loadRuns(), loadProjects(), loadTeams());
  if (state.view === "config") {
    jobs.push(loadSources());
    if (state.selectedSourceId && !configIsDirty()) jobs.push(loadSelectedConfig());
  }
  if (state.view === "router") jobs.push(loadBootstrap());
  if (state.view === "security") jobs.push(runDiagnostics(), loadBootstrap(), loadApprovals());
  if (state.view === "observability") { state.obsLoaded = false; jobs.push(loadObservability()); }
  if (state.view === "sessions") jobs.push(loadSessions());
  const settled = await Promise.allSettled(jobs);
  const failures = settled.filter((item) => item.status === "rejected");
  if (failures.length) toast(`${failures.length} 项刷新失败`, "warning");
  else toast("数据已刷新", "success", 2200);
  elements["refresh-button"].disabled = false;
  renderAll();
}

function confirmAction({ eyebrow, title, rows = [], warning = "", confirmLabel = "确认", danger = false }) {
  return new Promise((resolve) => {
    const dialog = elements["action-dialog"];
    elements["dialog-eyebrow"].textContent = eyebrow;
    elements["dialog-title"].textContent = title;
    elements["dialog-body"].innerHTML = `
      <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
      ${warning ? `<div class="dialog-warning">${escapeHtml(warning)}</div>` : ""}`;
    elements["dialog-confirm-button"].textContent = confirmLabel;
    elements["dialog-confirm-button"].className = `button ${danger ? "danger" : "primary"}`;
    elements["dialog-confirm-button"].value = "confirm";
    const closeHandler = () => resolve(dialog.returnValue === "confirm");
    dialog.addEventListener("close", closeHandler, { once: true });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else resolve(window.confirm(title));
  });
}

async function fetchRunEvents(runId) {
  if (!runId) return;
  state.runEvents = state.runEvents || {};
  try {
    const payload = await request(`/api/runs/${encodeURIComponent(runId)}/events`);
    state.runEvents[runId] = (payload.events || []).map((raw) => normalizeEvent(raw));
    if (state.selectedRunId === runId) renderSelectedRun();
  } catch {
    // per-run 历史回放失败不阻塞实时视图（实时 SSE 仍工作）
  }
}

function selectRun(id) {
  if (!id) return;
  state.sessionPreview = null; // 选任务即离开历史预览
  markSelectedSessionLink(null, null);
  state.selectedRunId = id;
  renderRuns();
  if (state.view !== "workbench") setView("workbench");
  void fetchRunEvents(id); // 拉 per-run 完整历史事件（不受全局最近窗口限制）
}

const NAV_MOBILE_QUERY = window.matchMedia("(max-width: 820px)");

// 抽屉可访问性（烛 R2）：离屏侧栏关闭时必须移出 Tab 顺序与 a11y 树（inert），
// 否则移动键盘用户会聚焦到不可见控件。桌面态侧栏常显——永不 inert。
function syncNavAccessibility() {
  const sidebar = byId("sidebar");
  if (!sidebar) return;
  const isOpen = document.querySelector(".app-shell")?.classList.contains("nav-open");
  const shouldHide = NAV_MOBILE_QUERY.matches && !isOpen;
  sidebar.inert = shouldHide;
  sidebar.setAttribute("aria-hidden", String(shouldHide));
}

function navDrawerOpen() {
  return Boolean(document.querySelector(".app-shell")?.classList.contains("nav-open"));
}

// restoreFocus（烛 R3）：Esc/backdrop 关闭时把焦点还给汉堡；但"选视图后关闭"不抢焦点——
// 让 setView 已迁到新视图 h1 的焦点保留，否则焦点会被拽回汉堡。
function setNavDrawer(open, { restoreFocus = true } = {}) {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;
  shell.classList.toggle("nav-open", open);
  const backdrop = byId("nav-backdrop");
  if (backdrop) backdrop.hidden = !open;
  byId("mobile-menu-button")?.setAttribute("aria-expanded", String(open));
  syncNavAccessibility();
  if (open) {
    byId("sidebar")?.querySelector(".nav-item")?.focus?.({ preventScroll: true });
  } else if (restoreFocus && NAV_MOBILE_QUERY.matches) {
    byId("mobile-menu-button")?.focus?.({ preventScroll: true });
  }
}

function bindEvents() {
  byId("mobile-menu-button")?.addEventListener("click", () => setNavDrawer(!navDrawerOpen()));
  byId("nav-backdrop")?.addEventListener("click", () => setNavDrawer(false));
  NAV_MOBILE_QUERY.addEventListener("change", (event) => {
    if (!event.matches && navDrawerOpen()) {
      // 抽屉开着跨到桌面断点：侧栏即将 display:none，焦点会随之消失——
      // 关抽屉并把焦点迁到顶栏当前导航项（烛 R8 建议）
      setNavDrawer(false, { restoreFocus: false });
      document.querySelector(".topbar-nav .topnav-item.is-active")?.focus?.({ preventScroll: true });
    } else if (event.matches && document.activeElement?.closest(".topbar-nav")) {
      // 反向：焦点在即将隐藏的顶栏导航上缩到移动断点——迁到汉堡（烛 R9 建议）
      byId("mobile-menu-button")?.focus?.({ preventScroll: true });
    }
    syncNavAccessibility();
  });
  syncNavAccessibility();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navDrawerOpen()) setNavDrawer(false); // 仅抽屉打开时响应 Esc（烛 R3）
  });

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      if (navDrawerOpen()) setNavDrawer(false, { restoreFocus: false }); // 选视图后收起抽屉，但保留 h1 焦点
    }
    const jump = event.target.closest("[data-view-jump]");
    if (jump) setView(jump.dataset.viewJump);
    const run = event.target.closest("[data-run-select]");
    if (run) selectRun(run.dataset.runSelect);
    const teamOption = event.target.closest("[data-team-select]");
    if (teamOption) selectTeam(teamOption.dataset.teamSelect);
    const projectToggle = event.target.closest("[data-project-toggle]");
    if (projectToggle) toggleProject(projectToggle.dataset.projectToggle, projectToggle);
    const sessionLink = event.target.closest("[data-session-project][data-session-id]");
    if (sessionLink) void openSessionPreview(sessionLink.dataset.sessionProject, sessionLink.dataset.sessionId);
    const previewClose = event.target.closest("[data-preview-close]");
    if (previewClose) closeSessionPreview();
    const source = event.target.closest("[data-source-id]");
    if (source) void selectSource(source.dataset.sourceId);
    const rollback = event.target.closest("[data-version-id]");
    if (rollback) void rollbackConfig(rollback.dataset.versionId);
    const approval = event.target.closest("[data-approval-id][data-approval-decision]");
    if (approval) void resolveApproval(approval.dataset.approvalId, approval.dataset.approvalDecision);
    // 协作台会话流内联审批：跳过二次弹窗，哈希随决议回传校验
    const inlineApproval = event.target.closest("[data-inline-approval-id][data-inline-approval-decision]");
    if (inlineApproval) void resolveInlineApproval(inlineApproval.dataset.inlineApprovalId, inlineApproval.dataset.inlineApprovalDecision);
    const recoveryAck = event.target.closest("[data-recovery-ack]");
    if (recoveryAck) acknowledgeRecovery();
  });

  document.addEventListener("keydown", (event) => {
    const row = event.target.closest("[data-run-select][role='button']");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectRun(row.dataset.runSelect);
    }
  });

  window.addEventListener("hashchange", () => {
    const view = location.hash.slice(1);
    if (VIEW_TITLES[view]) setView(view, { updateHash: false, focus: false });
  });

  elements["refresh-button"].addEventListener("click", () => void refreshCurrentView());
  elements["task-form"].addEventListener("submit", createRun);
  elements["composer-new-task"].addEventListener("click", () => {
    // 退出续聊模式：取消选中任务，胶囊回到新任务形态
    state.selectedRunId = null;
    elements["task-input"].value = "";
    renderRuns();
    elements["task-input"].focus({ preventScroll: true });
  });
  elements["new-session-button"].addEventListener("click", openSessionDialog);
  elements["composer-cwd"].addEventListener("click", () => {
    if (!elements["composer-cwd"].disabled) openSessionDialog();
  });
  elements["session-form"].addEventListener("submit", confirmSessionDialog);
  elements["session-cwd-input"].addEventListener("input", updateSessionCwdHint);
  elements["session-close-button"].addEventListener("click", () => elements["session-dialog"].close());
  elements["session-cancel-button"].addEventListener("click", () => elements["session-dialog"].close());
  elements["session-browse-button"].addEventListener("click", async () => {
    // 弹本机资源管理器目录选择框（服务端原生对话框，可拿绝对路径）
    const button = elements["session-browse-button"];
    button.disabled = true;
    button.textContent = "选择中…";
    try {
      const result = await request("/api/system/pick-directory", { method: "POST" });
      if (result.path) {
        elements["session-cwd-input"].value = result.path;
        updateSessionCwdHint();
      }
    } catch (error) {
      toast(`目录选择失败：${error.message}`, "error");
    } finally {
      button.disabled = false;
      button.textContent = "浏览…";
    }
  });
  elements["task-model"]?.addEventListener("change", renderStatusline);
  elements["cancel-run-button"].addEventListener("click", cancelSelectedRun);
  elements["router-form"].addEventListener("submit", handleRouterSubmit);
  elements["source-filter"].addEventListener("input", (event) => {
    state.sourceFilter = event.target.value;
    renderSources();
  });
  elements["config-editor"].addEventListener("input", updateEditorFromInput);
  elements["config-editor"].addEventListener("keyup", updateEditorMetrics);
  elements["config-editor"].addEventListener("click", updateEditorMetrics);
  elements["validate-config-button"].addEventListener("click", () => void validateConfig());
  elements["plan-config-button"].addEventListener("click", () => void planConfig());
  elements["apply-config-button"].addEventListener("click", () => void applyConfig());
  elements["run-diagnostics-button"].addEventListener("click", () => void runDiagnostics());
  elements["reload-runtime-button"].addEventListener("click", () => void reloadRuntime());
  elements["obs-refresh-button"].addEventListener("click", () => {
    state.obsLoaded = false;
    void loadObservability();
  });
  elements["obs-drift-button"].addEventListener("click", () => void runDriftCheck());
  elements["sessions-refresh-button"].addEventListener("click", () => void loadSessions());
  elements["sessions-summaries-toggle"].addEventListener("change", () => void loadSessions());
  elements["clear-runs-button"]?.addEventListener("click", () => void clearFinishedRuns());
  elements["manage-teams-button"]?.addEventListener("click", () => openTeamDialog(currentTeam()));
  elements["team-new-button"]?.addEventListener("click", () => fillTeamForm(null));
  elements["team-close-button"]?.addEventListener("click", closeTeamDialog);
  elements["team-cancel-button"]?.addEventListener("click", closeTeamDialog);
  elements["team-form"]?.addEventListener("submit", (event) => void saveTeamForm(event));
  elements["team-delete-button"]?.addEventListener("click", () => void deleteEditingTeam());
  state.selectedTeamId = sessionStorage.getItem(TEAM_KEY) || BUILTIN_TEAM_ID;
  initProjectSummariesToggle();
  elements["obs-handoff-body"].addEventListener("click", (event) => {
    const row = event.target.closest("[data-handoff]");
    if (row) void openHandoff(row.dataset.handoff);
  });
  elements["copy-log-button"].addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(elements["diagnostic-log"].textContent ?? "");
      toast("诊断日志已复制", "success", 2200);
    } catch (error) {
      toast(`复制失败：${error.message}`, "error");
    }
  });

  window.addEventListener("beforeunload", (event) => {
    state.eventController?.abort();
    if (!configIsDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function start() {
  initializeAccessToken();
  cacheElements();
  initializeTheme();
  bindEvents();
  const initialView = location.hash.slice(1);
  setView(VIEW_TITLES[initialView] ? initialView : "workbench", { updateHash: false, focus: false });
  renderAll();
  connectEvents();
  await loadInitial();
  if (state.selectedSourceId && !state.config) await loadSelectedConfig();
  window.setInterval(() => {
    void loadHealth().catch(() => {});
  }, 30_000);
}

void start().catch((error) => {
  console.error(error);
  if (elements["toast-region"]) toast(`控制台启动失败：${error.message}`, "error", 8000);
});
