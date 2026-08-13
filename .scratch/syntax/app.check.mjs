import { renderMarkdown } from "./markdown.js";
import { createMissionControlDock } from "./mission-control.js";
import { createWorkbenchEnvironmentPanel } from "./environment-panel.js";
import { createRailTools } from "./rail-tools.js";
import { createRailPanels } from "./modules/rail-panels.js";
import { normalizePathKey } from "./path-key.js";
import { lucideIcon, mountLucideSprite, remapLegacyIconUses } from "./lucide.js";
import {
  nextStreamEpochState,
  readStreamEpochFromHeaders,
  readStreamEpochFromReadyPayload,
} from "./modules/stream-epoch.js";
import { welcomeTipMarkup as buildWelcomeTipMarkup } from "./modules/welcome-tips.js";
import { resumeHintsFromSessions, resumeHintsMarkup } from "./modules/resume-hints.js";
import { AGENT_ROLE_BLURB as MODULE_AGENT_ROLE_BLURB, roleBlurbFor } from "./modules/agent-roles.js";
import { mountCcSwitchPanel } from "./modules/ccswitch-panel.js";
import { attachJsonEditor } from "./modules/json-editor.js";
import { createMemberLibrary } from "./modules/member-library.js";
import { createRuntimeSeatManager } from "./modules/runtime-seat-manager.js";
import { renderRichContent } from "./rich-render.js";
import { initCommandPalette as initCmdPalette, openCommandPalette as openForgePalette } from "./command-palette.js";
import {
  buildTeamPanelData,
  initTeamPanel,
  normalizeRunSessions,
  profileRolePresentation,
  resolveCatalogBrand,
  selectPipelineRoot,
  sessionAgentId,
  sessionAgentIds,
  updateTeamData,
  PROFILE_META,
} from "./team-panel.js";
import { refreshCollabFlow } from "./collab-flow.js";
import {
  TEAM_PRESETS,
  presetById,
  resolvePreset,
  buildTeamPack,
  parseTeamPack,
  planMemberResolution,
  remappedTeamPayload,
} from "./modules/team-config-kit.js";
import { initDeltaTimeline, refreshDeltaTimeline } from "./delta-timeline.js";
import { initProjectBootstrapper } from "./project-bootstrapper.js";
import {
  escapeHtml, redact, formatDate, formatTime, formatRelative, formatDuration,
  compactHash, normalizeStatus, statusText, runStatusText, unwrapList, objectList,
} from "./utils.js";
import {
  API, TOKEN_KEY, ApiError, request as apiRequest, getAccessToken, setAccessToken,
  initializeAccessToken as initToken,
} from "./api.js";
import {
  state, ACTIVE_RUN_STATES, TERMINAL_RUN_STATES, VIEW_TITLES,
  DEFAULT_COMPONENTS, DEFAULT_MODELS, DEFAULT_POLICIES, DEFAULT_SECRETS,
  MAX_REQUESTED_AGENTS, addRequestedAgentId, pruneRequestedAgentIds, removeRequestedAgentMention,
} from "./state.js";

// 兼容层：旧代码中的 request() 和 accessToken 引用
const request = apiRequest;

// v4.0 Forge 路由白名单本地扩展：团队协作视图由本波次新增，state.js 的 VIEW_TITLES
// 属并行波次文件——在此合并放开，state.js 后续补上同键时语义一致（团队协作）。
const FORGE_VIEW_TITLES = Object.freeze({ ...VIEW_TITLES, team: "团队协作" });

// 面包屑分组：与侧栏 nav-group 的 IA 五组对齐（协作/创建/观测/资源/系统）
const FORGE_VIEW_GROUPS = Object.freeze({
  workbench: "协作",
  team: "协作",
  channels: "协作",
  bootstrapper: "创建",
  office: "创建",
  terminal: "创建",
  overview: "观测",
  observability: "观测",
  sessions: "观测",
  hero: "观测",
  market: "资源",
  hosts: "资源",
  config: "系统",
  router: "系统",
  security: "系统",
});

const CONFIG_SURFACES = Object.freeze(["providers", "capabilities", "sources"]);
const CONFIG_SURFACE_SET = new Set(CONFIG_SURFACES);

function cleanForgeRouteId(value) {
  const id = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) ? id : null;
}

function configRouteHash(surface, { memberId = null, runtimeProfileId = null } = {}) {
  const next = CONFIG_SURFACE_SET.has(surface) ? surface : "providers";
  const query = new URLSearchParams();
  const member = cleanForgeRouteId(memberId);
  const runtime = cleanForgeRouteId(runtimeProfileId);
  if (member) query.set("member", member);
  if (runtime) query.set("runtime", runtime);
  return `#config/${next}${query.size ? `?${query}` : ""}`;
}

function successfulLoadResult(data = null, details = {}) {
  return { __forgeLoadResult: true, ok: true, data, ...details };
}

function failedLoadResult(error) {
  return { __forgeLoadResult: true, ok: false, error };
}

function loadResultFailed(value) {
  return value?.__forgeLoadResult === true && value.ok === false;
}

function shouldHydrateTeamFormAfterLoad(result, { initialized, dirty, busy }) {
  return !loadResultFailed(result) && result?.stale !== true && !initialized && !dirty && !busy;
}

function parseForgeRoute(hashValue = location.hash) {
  const raw = String(hashValue).replace(/^#/, "");
  const [path, queryString = ""] = raw.split("?", 2);
  const query = new URLSearchParams(queryString);
  const memberId = cleanForgeRouteId(query.get("member"));
  const runtimeProfileId = cleanForgeRouteId(query.get("runtime"));
  if (path === "capabilities") {
    return { view: "config", configSurface: "capabilities", memberId, runtimeProfileId };
  }
  const [view, candidateSurface] = path.split("/", 2);
  if (view === "config") {
    return {
      view,
      configSurface: CONFIG_SURFACE_SET.has(candidateSurface) ? candidateSurface : "providers",
      memberId,
      runtimeProfileId,
    };
  }
  return {
    view,
    configSurface: null,
    memberId: null,
    runtimeProfileId: null,
  };
}

// API, TOKEN_KEY, state, VIEW_TITLES 等已迁移至 api.js / state.js / utils.js

// TOKEN_KEY, accessToken, VIEW_TITLES, ACTIVE_RUN_STATES, TERMINAL_RUN_STATES,
// DEFAULT_COMPONENTS, DEFAULT_MODELS, DEFAULT_POLICIES, DEFAULT_SECRETS,
// escapeHtml, redact, formatDate, formatTime, formatRelative, formatDuration,
// compactHash, normalizeStatus, statusText, runStatusText, unwrapList, objectList
// → 已从 api.js / state.js / utils.js 导入

// state 对象已迁移至 state.js（通过 import 导入）

const elements = {};
const byId = (id) => document.getElementById(id);
let missionControlDock = null;
let workbenchEnvironmentPanel = null;
let railTools = null;
let railPanels = null;
let memberLibrary = null;
let runtimeSeatManager = null;
let memberConfigTargetEpoch = 0;

function clearMemberConfigTarget({ cancelPending = true } = {}) {
  state.configMemberFocusId = null;
  state.configRuntimeFocusId = null;
  if (cancelPending) memberConfigTargetEpoch += 1;
}

// 高频 rail/tree 渲染先比较应用自己上次提交的模板。状态未变时不触碰 DOM，
// 避免 renderRuns/renderProjects 连续到达时重复销毁焦点、布局与可访问树。
const committedMarkup = new WeakMap();
function commitMarkup(element, markup) {
  if (!element || committedMarkup.get(element) === markup) return false;
  element.innerHTML = markup;
  committedMarkup.set(element, markup);
  return true;
}

// ApiError 已迁移至 api.js（通过 import 导入）

function cacheElements() {
  [
    "current-view-title",
    "current-view-group",
    "api-connection-badge",
    "theme-toggle",
    "sidebar-status-dot",
    "sidebar-status-label",
    "sidebar-version",
    "global-status-dot",
    "global-status-label",
    "global-status-version",
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
    "composer-team",
    "start-agent",
    "manage-teams-button",
    "team-settings-panel",
    "team-form",
    "team-form-title",
    "team-form-status",
    "team-switch-select",
    "team-active-status",
    "team-activate-button",
    "team-activate-label",
    "team-apply-providers-button",
    "team-edit-button",
    "team-runtime-team-name",
    "team-builtin-note",
    "team-new-button",
    "team-preset-select",
    "team-import-button",
    "team-import-file",
    "team-export-button",
    "team-name-input",
    "team-description-input",
    "team-prompt-input",
    "team-roster-summary",
    "team-members-search",
    "team-member-create-button",
    "team-members-list",
    "team-skills-chips",
    "team-mcp-chips",
    "team-delete-button",
    "team-cancel-button",
    "team-save-button",
    "team-save-label",
    "project-count",
    "project-summaries-toggle",
    "subagents-toggle",
    "show-hidden-toggle",
    "recent-only-toggle",
    "workbench-project-tree",
    "conversation-title",
    "conversation-meta",
    "cancel-run-button",
    "conversation-stream",
    "conversation-live-status",
    "recovery-bar",
    "followup-agent",
    "task-form",
    "task-input",
    "task-effort",
    "task-permission",
    "task-permission-pick",
    "permission-pill",
    "permission-pill-label",
    "permission-menu",
    "composer-cli-console",
    "composer-cli-console-toggle",
    "composer-cli-console-panel",
    "composer-cli-console-title",
    "composer-cli-console-summary",
    "composer-cli-console-state",
    "composer-cli-command-list",
    "composer-cli-command-note",
    "composer-cli-default-model",
    "composer-cli-default-effort",
    "composer-cli-default-permission",
    "composer-cli-default-save",
    "composer-cli-command-value",
    "composer-cli-open-seat",
    "composer-cli-open-capabilities",
    "composer-cli-open-connection",
    "composer-cli-connection-copy",
    "composer-cli-diagnostic-actions",
    "composer-cli-diagnostic-output",
    "attach-button",
    "attach-chips",
    "rail-working",
    "working-run-list",
    "working-count",
    "rail-pinned",
    "pinned-run-list",
    "pinned-count",
    "rail-archived",
    "archived-toggle",
    "archived-run-list",
    "archived-count",
    "rail-automations",
    "automations-list",
    "automations-count",
    "save-automation-button",
    "context-menu",
    "input-dialog",
    "input-dialog-eyebrow",
    "input-dialog-title",
    "input-dialog-value",
    "input-dialog-confirm",
    "input-dialog-cancel",
    "task-model",
    "task-model-pick",
    "task-effort-pick",
    "composer-mode-hint",
    "composer-new-task",
    "composer-cwd",
    "new-session-button",
    "new-task-row",
    "team-newsession-button",
    "rail-search-row",
    "team-tree-toggle",
    "team-rail-title",
    "session-dialog",
    "session-form",
    "session-cwd-input",
    "session-cwd-hint",
    "session-close-button",
    "session-cancel-button",
    "session-step-type",
    "session-step-info",
    "session-prev-button",
    "session-next-button",
    "session-submit-button",
    "session-dirpick",
    "session-name-input",
    "session-dialog-title",
    "session-local-fields",
    "session-remote-fields",
    "session-remote-badge",
    "session-remote-host",
    "session-remote-path",
    "session-remote-name",
    "session-remote-up",
    "session-remote-browser",
    "session-remote-hint",
    "project-paths",
    "rail-statusline",
    "submit-task-button",
    "route-decision",
    "session-topology",
    "event-live-state",
    "workbench-event-list",
    "config-workspace-status",
    "config-global-status",
    "config-topology-tabs",
    "config-host-bar",
    "config-topology-nav",
    "config-surface-remote",
    "config-topology-provider-count",
    "config-topology-capability-count",
    "config-topology-source-count",
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
    "provider-columns",
    "provider-add-button",
    "provider-team-select",
    "provider-apply-team-button",
    "provider-dialog",
    "provider-form",
    "provider-dialog-title",
    "provider-name-input",
    "provider-baseurl-input",
    "provider-key-input",
    "provider-website-input",
    "provider-notes-input",
    "provider-app-claude",
    "provider-app-claude-desktop",
    "provider-app-codex",
    "provider-app-gemini",
    "provider-app-grokbuild",
    "provider-app-kimi",
    "provider-app-opencode",
    "provider-app-openclaw",
    "provider-app-hermes",
    "provider-models-claude",
    "provider-models-claude-desktop",
    "provider-models-codex",
    "provider-models-gemini",
    "provider-models-grokbuild",
    "provider-models-kimi",
    "provider-models-opencode",
    "provider-models-openclaw",
    "provider-models-hermes",
    "provider-claude-model",
    "provider-claude-haiku",
    "provider-claude-sonnet",
    "provider-claude-opus",
    "provider-claude-fable",
    "provider-claude-subagent",
    "provider-claude-sonnet-name",
    "provider-claude-opus-name",
    "provider-claude-fable-name",
    "provider-claude-haiku-name",
    "provider-claude-model-1m",
    "provider-claude-sonnet-1m",
    "provider-claude-opus-1m",
    "provider-claude-fable-1m",
    "provider-claude-haiku-1m",
    "provider-claude-subagent-1m",
    "provider-api-format",
    "provider-proxy-ua",
    "provider-proxy-headers",
    "provider-proxy-body",
    "provider-codex-model",
    "provider-codex-effort",
    "provider-gemini-model",
    "provider-claude-desktop-model",
    "provider-grokbuild-model",
    "provider-kimi-model",
    "provider-opencode-model",
    "provider-openclaw-model",
    "provider-hermes-model",
    "provider-delete-button",
    "provider-save-button",
    "provider-cancel-button",
    "provider-close-button",
    "provider-sort-button",
    "provider-import-button",
    "provider-export-button",
    "provider-deeplink-button",
    "provider-envcheck-button",
    "provider-endpoint-list",
    "provider-endpoint-input",
    "provider-endpoint-add-button",
    "provider-endpoint-test-button",
    "provider-endpoint-autoselect",
    "provider-usage-enabled",
    "provider-usage-template",
    "provider-usage-timeout",
    "provider-usage-interval",
    "provider-usage-userid",
    "provider-usage-apikey",
    "provider-usage-baseurl",
    "provider-usage-token",
    "provider-usage-code",
    "provider-usage-test-button",
    "provider-usage-test-result",
    "provider-proxy-enabled",
    "provider-proxy-type",
    "provider-proxy-host",
    "provider-proxy-port",
    "provider-proxy-username",
    "provider-proxy-password",
    "provider-test-timeout",
    "provider-test-retries",
    "provider-test-degraded",
    "provider-test-model",
    "provider-test-prompt",
    "provider-model-test-button",
    "provider-model-test-result",
    "provider-category",
    "provider-apikey-field",
    "provider-cost-multiplier",
    "provider-limit-daily",
    "provider-limit-monthly",
    "provider-preset-block",
    "provider-preset-search",
    "provider-preset-grid",
    "provider-preset-hint",
    "provider-catalog-list",
    "provider-app-bar",
    "provider-baseurl-hint",
    "provider-config-json-block",
    "provider-preview-tabs",
    "provider-preview-reset-button",
    "provider-common-json",
    "provider-common-json-editor",
    "provider-edit-common-button",
    "common-config-claude-editor",
    "provider-common-config-button",
    "common-config-dialog",
    "common-config-form",
    "common-config-close-button",
    "common-config-cancel-button",
    "common-config-save-button",
    "common-config-claude",
    "common-config-codex",
    "common-config-gemini",
    "common-config-grokbuild",
    "common-config-kimi",
    "common-config-opencode",
    "common-config-openclaw",
    "common-config-hermes",
    "common-toggle-attribution",
    "common-toggle-teams",
    "common-toggle-toolsearch",
    "common-toggle-effort",
    "common-toggle-autoupdate",
    "team-provider-claude",
    "team-provider-claude-desktop",
    "team-provider-codex",
    "team-provider-gemini",
    "team-provider-grokbuild",
    "team-provider-kimi",
    "team-provider-opencode",
    "team-provider-openclaw",
    "team-provider-hermes",
    "provider-deeplink-dialog",
    "provider-deeplink-form",
    "provider-deeplink-input",
    "provider-deeplink-preview",
    "provider-deeplink-preview-button",
    "provider-deeplink-import-button",
    "provider-deeplink-close-button",
    "provider-deeplink-cancel-button",
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
    "diagnostic-log-filter",
    "copy-log-button",
    "cap-agents-grid",
    "cap-skills-head",
    "cap-skills-body",
    "cap-skills-summary",
    "cap-skills-ghosts",
    "cap-mcp-body",
    "cap-mcp-summary",
    "cap-mcp-map",
    "capabilities-refresh-button",
    "conv-tabs",
    "member-strip",
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

// escapeHtml, redact, unwrapList, objectList, normalizeStatus, statusText,
// runStatusText, formatDate, formatTime, formatRelative, formatDuration, compactHash
// → 已迁移至 utils.js（通过 import 导入）

function getVersion() {
  return (
    state.bootstrap.version ??
    state.bootstrap.system?.version ??
    state.bootstrap.runtime?.version ??
    "514cc runtime"
  );
}

// request() 和 ApiError 已迁移至 api.js（通过 import 导入）

async function initializeAccessToken() {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const fragmentToken = fragment.get("token")?.trim() ?? "";
  const deepLinkRun = fragment.get("run")?.trim() ?? "";
  if (deepLinkRun) state.deepLinkRunId = deepLinkRun;
  const deepLinkSession = fragment.get("session")?.trim() ?? "";
  if (deepLinkSession) {
    const parts = deepLinkSession.split("::").filter(Boolean);
    if (parts.length === 3) state.deepLinkSession = { cli: parts[0], projectId: parts[1], sessionId: parts[2] };
    else if (parts.length === 2) state.deepLinkSession = { cli: "claude", projectId: parts[0], sessionId: parts[1] };
  }
  const deepLinkProject = fragment.get("project")?.trim() ?? "";
  if (deepLinkProject) state.deepLinkProjectId = deepLinkProject;
  const bootstrapNonce = fragment.get("bootstrap")?.trim() ?? "";
  if (bootstrapNonce) {
    let response;
    try {
      response = await fetch("/auth/bootstrap", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ nonce: bootstrapNonce }),
      });
      const payload = await response.json().catch(() => null);
      const issuedToken = typeof payload?.token === "string" ? payload.token.trim() : "";
      if (!response.ok || !issuedToken) {
        const detail = payload?.error?.message ?? payload?.error ?? payload?.message ?? `HTTP ${response.status}`;
        throw new ApiError(`启动登录凭据兑换失败：${detail}`, response.status, payload);
      }
      sessionStorage.setItem(TOKEN_KEY, issuedToken);
      setAccessToken(issuedToken);
    } finally {
      history.replaceState(null, "", `${url.pathname}${url.search}`);
    }
    return;
  }
  if (fragmentToken) {
    sessionStorage.setItem(TOKEN_KEY, fragmentToken);
    setAccessToken(fragmentToken);
    history.replaceState(null, "", `${url.pathname}${url.search}`);
    return;
  }
  setAccessToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#15171a" : "#f5f6f8");
  const toggle = elements["theme-toggle"];
  if (toggle) {
    toggle.querySelector("use")?.setAttribute("href", next === "dark" ? "#lucide-sun" : "#lucide-moon");
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
  elements["global-status-dot"].className = `status-dot is-${normalized}`;
  elements["global-status-label"].textContent = label.textContent;
  elements["global-status-version"].textContent = String(getVersion());
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

function compactToastRegion() {
  const region = elements["toast-region"];
  if (!region) return;
  const seen = new Set();
  for (const item of [...region.children].reverse()) {
    const key = `${item.dataset.toastType || "info"}\u0000${item.textContent || ""}`;
    if (seen.has(key)) item.remove();
    else seen.add(key);
  }
  const limit = window.matchMedia?.("(max-width: 680px)").matches ? 2 : 4;
  while (region.childElementCount > limit) region.firstElementChild?.remove();
}

function toast(message, type = "info", duration = 3600) {
  const item = document.createElement("div");
  item.className = `toast is-${type}`;
  item.dataset.toastType = type;
  item.textContent = redact(message);
  elements["toast-region"].append(item);
  compactToastRegion();
  window.setTimeout(() => item.remove(), duration);
}

window.addEventListener("resize", compactToastRegion, { passive: true });

function appendDiagnostic(message, level = "info", { render = true } = {}) {
  const now = new Date().toISOString();
  state.diagnosticLog.unshift(`[${now}] [${level.toUpperCase()}] ${redact(message)}`);
  state.diagnosticLog = state.diagnosticLog.slice(0, 120);
  if (render) renderDiagnosticLog();
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
  const coordinatorId = String(item.coordinatorId ?? item.coordinator_id ?? "");
  const startAgentId = String(item.startAgentId ?? item.start_agent_id ?? "");
  const executionOwnerId = String(item.executionOwnerId ?? item.execution_owner_id ?? startAgentId);
  const rawSessions = item.sessions ?? item.agents ?? [];
  const sessions = normalizeRunSessions(rawSessions, coordinatorId);
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
    coordinatorId: coordinatorId || null,
    startAgentId: startAgentId || null,
    executionOwnerId: executionOwnerId || null,
    sessions,
    messages: unwrapList(item.messages ?? item.turns ?? [], ["messages", "turns"]),
  };
}

function normalizeComponent(item, index) {
  const rawStatus = item.status ?? item.state ?? item.ok;
  return {
    ...item,
    id: String(item.id ?? item.key ?? item.name ?? `component-${index}`),
    name: String(item.name ?? item.label ?? item.id ?? `组件 ${index + 1}`),
    // detail 兜底链补 reason：dormant/missing 等状态的解释在 reason 字段（version 只有在线组件有）
    detail: String(item.detail ?? item.description ?? item.message ?? item.version ?? item.reason ?? ""),
    status: normalizeStatus(rawStatus),
    rawStatus, // 原始态供 statusText 出专属文案（待命/未安装/未配置——normalize 会压扁语义）
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
  state.memberCatalog = Array.isArray(payload.memberCatalog)
    ? payload.memberCatalog
    : Array.isArray(payload.teamCatalog) ? payload.teamCatalog : [];
  state.runtimeCatalog = Array.isArray(payload.runtimeCatalog) ? payload.runtimeCatalog : [];
  memberLibrary?.syncBootstrap();
  runtimeSeatManager?.refreshBindings?.(); // bootstrap 慢聚合晚到时，席位绑定区块从「未绑定」旧空态自愈
  syncModelPick(); // providers（含 modelOptions）就绪后立刻联动 /model 目录——renderTeams 可能已先跑过

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
  const previousTeamCatalog = teamCatalogSignature();
  const payload = await request(API.bootstrap);
  extractBootstrapData(payload);
  elements["sidebar-version"].textContent = String(getVersion());
  renderModels();
  renderSecurity();
  reconcileTeamFormCatalog(previousTeamCatalog);
  refreshTeamData();
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
    renderTeamPulse();
    refreshTeamData();
    missionControlDock?.refreshIdle?.();
  }
}

async function loadSources({ preserveSelection = true } = {}) {
  const previousSelection = state.selectedSourceId;
  const payload = await request(API.sources);
  state.sources = unwrapList(payload, ["sources", "config_sources"]).map(normalizeSource);
  const selectedSourceExists = state.sources.some((item) => item.id === previousSelection);
  const preserveDirtyDraft = Boolean(previousSelection) && !selectedSourceExists && configIsDirty();
  if (preserveDirtyDraft) {
    appendDiagnostic(`配置源 ${previousSelection} 已不在索引中；保留未保存草稿与原选择`, "warning");
    toast("当前配置源已从索引移除；未保存草稿仍保留，请确认后再切换", "warning", 7000);
  } else if (!preserveSelection || !selectedSourceExists) {
    state.selectedSourceId = state.sources[0]?.id ?? null;
  }
  if (state.selectedSourceId !== previousSelection) {
    state.config = null;
    state.versions = [];
    state.pendingPlan = null;
    renderConfig();
  }
  renderSources();
  renderConfigTopology();
  renderOverview();
  return payload;
}

async function loadRuns() {
  const payload = await request(API.runs);
  state.runs = unwrapList(payload, ["runs"]).map(normalizeRun);
  // 深度链接一次性消费：#run=<id> 指定的任务优先选中
  if (state.deepLinkRunId) {
    if (state.runs.some((run) => run.id === state.deepLinkRunId)) {
      state.selectedRunId = state.deepLinkRunId;
      state.selectionClearedByUser = false;
    }
    else {
      toast("深度链接指向的任务不存在（可能已被清除）", "warning");
      state.deepLinkRunId = null;
    }
  }
  if (state.selectedRunId && !state.runs.some((run) => run.id === state.selectedRunId)) {
    state.selectedRunId = null;
    state.selectionClearedByUser = false; // 选中失效非用户意图，允许下方自动接力
  }
  // 自动选择只补「从未选过」的位：用户显式切新任务模式（selectionClearedByUser）时不得回盖——
  // 否则笔按钮/新任务后下一次 loadRuns 轮询把旧 run 重新刷回会话区（LO 2026-08-11）
  if (!state.selectedRunId && !state.selectionClearedByUser) {
    state.selectedRunId = state.runs.find((run) => ACTIVE_RUN_STATES.has(run.status))?.id ?? state.runs[0]?.id ?? null;
  }
  renderRuns();
  renderOverview();
  // 状态翻页必须连会话视图一起刷：loadRuns 是 run.completed/failed 等纯状态事件的唯一通道
  // （它们不在 conversationEvent 白名单）——不补这刀，停止键/composer 禁用态/恢复条停在旧快照
  renderSelectedRun();
  const run = selectedRun();
  missionControlDock?.selectRun(run?.id ?? null, run ? `${run.updatedAt ?? run.createdAt ?? ""}:${run.status}:${run.round ?? 0}` : null);
  syncRailToActiveRun();
  refreshTeamData();
  return payload;
}

async function loadApprovals() {
  const [payload, leasePayload] = await Promise.all([
    request(API.approvals),
    request(API.leases),
  ]);
  state.approvals = unwrapList(payload, ["approvals"]);
  state.leases = unwrapList(leasePayload, ["leases"]);
  renderApprovals();
  renderSelectedRun(); // 内联审批卡挂在协作台会话流末尾，与安全诊断列表同一份数据同步刷新
  missionControlDock?.refresh();
  return payload;
}

async function loadInitial() {
  setApiState("pending");
  appendDiagnostic("开始加载控制面 bootstrap、health、配置索引与任务列表");
  let earlySuccess = false;
  const track = (job) =>
    job.then((value) => {
      if (!earlySuccess && !loadResultFailed(value)) {
        earlySuccess = true;
        setApiState("ok");
      }
      return value;
    });
  const sourcesJob = loadSources().then(async (payload) => {
    if (state.selectedSourceId && !state.config) {
      const detailResult = await loadSelectedConfig();
      if (loadResultFailed(detailResult)) return detailResult;
    }
    return payload;
  });
  const jobs = [track(loadBootstrap()), track(loadHealth()), track(sourcesJob), track(loadRuns()), track(loadApprovals()), track(loadAutomations()), track(loadTeams())];
  const settled = await Promise.allSettled(jobs);
  const successes = settled.filter((item) => item.status === "fulfilled" && !loadResultFailed(item.value)).length;
  if (successes > 0) {
    setApiState("ok");
    appendDiagnostic(`控制面初始化完成：${successes}/${settled.length} 个端点成功`);
  } else {
    setApiState("error", "所有初始化端点均不可用");
    appendDiagnostic("控制面初始化失败：所有端点均不可用", "error");
  }

  settled.forEach((item) => {
    if (item.status === "rejected") appendDiagnostic(item.reason?.message ?? item.reason, "warning");
    else if (loadResultFailed(item.value)) appendDiagnostic(item.value.error?.message ?? item.value.error, "warning");
  });
  renderAll();
}

function setConfigSurface(surface, { updateHash = true, focus = false, preserveMemberTarget = false } = {}) {
  const next = CONFIG_SURFACE_SET.has(surface) ? surface : "providers";
  if (!preserveMemberTarget) clearMemberConfigTarget();
  state.configSurface = next;
  document.querySelectorAll("[data-config-surface-panel]").forEach((panel) => {
    const active = panel.dataset.configSurfacePanel === next;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  document.querySelectorAll("[data-config-surface]").forEach((button) => {
    const active = button.dataset.configSurface === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  if (state.view === "config" && updateHash) {
    history.replaceState(null, "", configRouteHash(next, {
      memberId: state.configMemberFocusId,
      runtimeProfileId: state.configRuntimeFocusId,
    }));
  }
  renderConfigTopology();
  // 远程配置目标生效期间，程序化 surface 切换不得把本机三面图谱重新放出来
  if (state.configHostId) syncConfigHostView();
  if (next === "providers" && !state.providersData) void loadTeams().then(() => loadProviders());
  if (next === "capabilities" && !state.capabilitiesData) void loadCapabilities();
  if (next === "capabilities" && state.capabilitiesData) renderCapabilities();
  if (next === "sources") runtimeSeatManager?.setMode(state.runtimeWorkspaceMode, { focus: false });
  if (focus) {
    const heading = byId(`config-surface-${next}`)?.querySelector("h2");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      requestAnimationFrame(() => heading.focus({ preventScroll: true }));
    }
  }
}

function setView(view, {
  updateHash = true,
  focus = true,
  configSurface = null,
  preserveMemberTarget = false,
} = {}) {
  if (view === "capabilities") {
    view = "config";
    configSurface = "capabilities";
  }
  if (!FORGE_VIEW_TITLES[view]) return;
  if (view !== "config") clearMemberConfigTarget();
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
  elements["current-view-title"].textContent = FORGE_VIEW_TITLES[view];
  if (elements["current-view-group"]) {
    elements["current-view-group"].textContent = FORGE_VIEW_GROUPS[view] ?? "";
  }
  document.title = `${FORGE_VIEW_TITLES[view]} · 514 Forge`;
  if (view === "config") {
    setConfigSurface(configSurface ?? state.configSurface, {
      updateHash: false,
      focus: false,
      preserveMemberTarget,
    });
  }
  if (updateHash) {
    history.replaceState(null, "", view === "config"
      ? configRouteHash(state.configSurface, {
          memberId: state.configMemberFocusId,
          runtimeProfileId: state.configRuntimeFocusId,
        })
      : `#${view}`);
  }
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
  // 统一配置图谱每次进入都回读供应商、能力和真源摘要；三个配置面共用同一份状态。
  if (view === "config") {
    void loadTeams().then(() => loadProviders());
    if (!state.capabilitiesData) void loadCapabilities();
    if (state.configSurface === "sources") void runtimeSeatManager?.load();
    void loadConfigHosts({ force: true }); // 配置目标台账每进刷新（远程主机视图里增删过也能跟上）
    if (state.configHostId) syncConfigHostView(); // 带着远程目标回到本视图时恢复面板显隐
  }
  if (view === "workbench" && !state.projectsData) void loadProjects();
  if (view === "workbench" && !state.teams.length) void loadTeams();
  if (view === "team") {
    if (!state.teams.length) {
      void loadTeams().then((result) => {
        if (shouldHydrateTeamFormAfterLoad(result, {
          initialized: teamFormInitialized,
          dirty: teamFormDirty,
          busy: teamFormBusy,
        })) fillTeamForm(currentTeam());
      });
    } else if (!teamFormInitialized) {
      fillTeamForm(currentTeam());
    }
    refreshTeamData();
    void refreshCollabFlow();
  }
  // 隐藏视图的数据只落 state；切到该视图时再消费，避免 SSE/轮询持续改写屏外 DOM。
  if (view === "overview") renderOverview();
  if (view === "workbench") {
    renderRuns();
    if (state.projectsData) renderProjects();
  }
}

function renderConfigTopology() {
  const providers = state.providersData?.providers ?? [];
  const runtimeSeats = state.runtimeSeatsData?.seats ?? [];
  const adapterTemplates = state.adapterTemplatesData?.templates ?? [];
  const runtimeError = state.runtimeSeatsData?.error;
  const providerError = state.providersData?.error;
  const providerBlocked = state.providersData?.storeStatus?.state === "blocked";
  const skills = state.capabilitiesData?.skills;
  const mcp = state.capabilitiesData?.mcp;
  const capabilityStatus = skills?.configurationStatus ?? {};
  const mcpStatus = mcp?.configurationStatus ?? {};
  const driftCount = state.sources.filter((source) => ["drift", "warning", "stale"].includes(source.status)).length;

  if (elements["config-topology-provider-count"]) {
    elements["config-topology-provider-count"].textContent = providerError
      ? "读取失败"
      : state.providersData
        ? `${providers.length} 档案 · ${PROVIDER_APPS.length} 应用`
        : "读取中";
  }
  if (elements["config-topology-capability-count"]) {
    elements["config-topology-capability-count"].textContent = state.capabilitiesError
      ? "扫描失败"
      : skills && mcp
        ? `${skills.agents?.length ?? 0} Agent · ${skills.items?.length ?? 0} Skill · ${mcp.servers?.length ?? 0} MCP`
        : "扫描中";
  }
  if (elements["config-topology-source-count"]) {
    elements["config-topology-source-count"].textContent = runtimeError
      ? "席位读取失败"
      : state.runtimeSeatsData
        ? `${runtimeSeats.length} 席位 · ${adapterTemplates.length} Adapter`
        : "读取中";
  }

  const providerNode = byId("config-topology-providers");
  const capabilityNode = byId("config-topology-capabilities");
  const sourceNode = byId("config-topology-sources");
  providerNode?.classList.toggle("is-error", Boolean(providerError));
  providerNode?.classList.toggle("is-warning", !providerError && providerBlocked);
  capabilityNode?.classList.toggle("is-error", Boolean(state.capabilitiesError || capabilityStatus.failClosed || mcpStatus.failClosed));
  sourceNode?.classList.toggle("is-warning", driftCount > 0);
  sourceNode?.classList.toggle("is-error", Boolean(runtimeError));

  const workspaceStatus = elements["config-workspace-status"];
  if (!workspaceStatus) return;
  let tone = "neutral";
  let label = "正在汇总";
  if (state.configSurface === "providers") {
    if (providerError) { tone = "error"; label = "供应商读取失败"; }
    else if (providerBlocked) { tone = "warning"; label = "供应商已冻结"; }
    else if (state.providersData) { tone = "ok"; label = `${providers.length} 个供应商档案`; }
  } else if (state.configSurface === "capabilities") {
    if (state.capabilitiesError) { tone = "error"; label = "能力配置读取失败"; }
    else if (capabilityStatus.failClosed && mcpStatus.failClosed) { tone = "error"; label = "Skill 与 MCP 配置已降级"; }
    else if (capabilityStatus.failClosed) { tone = "error"; label = "Skill 配置已降级"; }
    else if (mcpStatus.failClosed) { tone = "error"; label = "MCP 配置已降级"; }
    else if (skills && mcp) { tone = "ok"; label = `${skills.items?.length ?? 0} Skill · ${mcp.servers?.length ?? 0} MCP`; }
    else { label = "正在扫描能力"; }
  } else if (state.configSurface === "sources") {
    if (state.runtimeWorkspaceMode === "seats") {
      if (runtimeError) { tone = "error"; label = "运行席位读取失败"; }
      else if (runtimeSeatManager?.isDirty()) { tone = "warning"; label = "运行席位有未保存变更"; }
      else if (state.runtimeSeatsLoading || !state.runtimeSeatsData) { label = "正在读取运行席位"; }
      else if (state.runtimeSeatsData?.runtime?.activation === "restart-required") {
        tone = "warning";
        label = `${runtimeSeats.length} 个席位 · 待重载`;
      } else { tone = "ok"; label = `${runtimeSeats.length} 个运行席位`; }
    } else if (!state.sources.length) label = "正在读取真源";
    else if (state.config?.transactionBlocked) { tone = "error"; label = "事务写入已阻断"; }
    else if (configIsDirty()) { tone = "warning"; label = "有未保存变更"; }
    else if (driftCount) { tone = "warning"; label = `${driftCount} 项配置漂移`; }
    else { tone = "ok"; label = `${state.sources.length} 个真源已索引`; }
  }
  workspaceStatus.textContent = label;
  workspaceStatus.className = `status-label is-${tone}`;
}

/* ===== 配置目标主机切换（v41 波四，LO「配置图谱里直接配置远程主机」） =====
 * 默认配本机（三面图谱照旧）；切到 SSH 台账主机后，三面图谱（本机概念）与拓扑导航让位给
 * 远程配置面板——探测/装 CLI/同步本机配置全走波一 remote-ops 端点，与远程主机视图同源。 */

async function loadConfigHosts({ force = false } = {}) {
  if (state.configHosts && !force) {
    renderConfigHostBar();
    return;
  }
  try {
    state.configHosts = (await request("/api/ssh/hosts"))?.hosts ?? [];
    state.configHostsError = null;
  } catch (error) {
    // 门闸未开/台账故障：只留本机 chip 并如实提示，不拖垮配置图谱
    state.configHosts = [];
    state.configHostsError = error.message;
  }
  const alive = new Set(state.configHosts.map((host) => host.id));
  for (const id of [...state.configHostProbes.keys()]) if (!alive.has(id)) state.configHostProbes.delete(id);
  if (state.configHostId && !alive.has(state.configHostId)) {
    state.configHostId = null; // 台账里被删掉的主机自动回落本机
    syncConfigHostView();
  }
  renderConfigHostBar();
}

function renderConfigHostBar() {
  const bar = elements["config-host-bar"];
  if (!bar) return;
  const chip = (id, label, dotCls, title) => `<button type="button" class="config-host-chip${state.configHostId === id ? " is-active" : ""}"
    data-config-host="${escapeHtml(id ?? "")}" title="${escapeHtml(title)}">
    ${dotCls == null ? "" : `<i class="remote-dot ${dotCls}"></i>`}${escapeHtml(label)}</button>`;
  bar.innerHTML = `<span class="config-host-bar-label">配置目标</span>`
    + chip(null, "本机", null, "本机配置图谱（供应商 / Agent·Skill·MCP / 运行席位与真源）")
    + (state.configHosts ?? []).map((host) => {
      const disabled = host.enabled === false;
      const dotCls = disabled ? "is-off" : host.trusted ? "is-ok" : "";
      const status = disabled ? "已停用" : host.trusted ? "已连接" : "待确认指纹";
      return chip(host.id, host.name ?? host.id, dotCls, `${host.user ?? ""}@${host.host ?? ""}:${host.port ?? ""} · ${status}`);
    }).join("")
    + (state.configHostsError ? `<span class="subtle config-host-bar-hint">主机台账不可用：${escapeHtml(state.configHostsError)}</span>` : "")
    + `<button type="button" class="text-button config-host-manage" data-config-host-manage title="在远程主机视图添加 / 编辑 / 删除连接">管理主机…</button>`;
}

function selectConfigHost(id) {
  state.configHostId = id || null;
  syncConfigHostView();
  renderConfigHostBar();
  if (state.configHostId) {
    renderConfigRemotePanel();
    if (!state.configHostProbes.has(state.configHostId)) void probeConfigHost(state.configHostId);
  }
}

// 远程目标选中：三面图谱（本机概念）与拓扑导航让位给远程面板；回本机按当前 surface 恢复显隐
function syncConfigHostView() {
  const remote = Boolean(state.configHostId);
  const nav = byId("config-topology-nav");
  if (nav) nav.hidden = remote;
  const panel = byId("config-surface-remote");
  if (remote) {
    document.querySelectorAll("[data-config-surface-panel]").forEach((item) => {
      item.hidden = true;
      item.classList.remove("is-active");
    });
    if (panel) panel.hidden = false;
  } else {
    if (panel) panel.hidden = true;
    setConfigSurface(state.configSurface, { updateHash: false });
  }
}

function configRemoteHost() {
  return (state.configHosts ?? []).find((entry) => entry.id === state.configHostId) ?? null;
}

// 面板内联结果区（安装/同步回报落这里，不哑弹）
function configRemoteResult(html) {
  const box = byId("config-surface-remote")?.querySelector(".config-remote-result");
  if (box) box.innerHTML = html;
}

function renderConfigRemotePanel() {
  const panel = byId("config-surface-remote");
  if (!panel || !state.configHostId) return;
  const host = configRemoteHost();
  if (!host) {
    panel.innerHTML = `<p class="subtle">该主机已不在 SSH 台账。</p>`;
    return;
  }
  const probe = state.configHostProbes.get(host.id);
  let envBody;
  if (!probe || probe.status === "loading") {
    envBody = `<p class="subtle">正在探测远程环境（OS / Shell / CLI 矩阵）…</p>`;
  } else if (probe.status === "error") {
    envBody = `<p class="subtle">探测失败：${escapeHtml(probe.error)}</p>`;
  } else {
    const data = probe.data ?? {};
    envBody = `
      <div class="sshconn-env-grid">
        <span>OS</span><b>${escapeHtml(data.os ?? "?")}</b>
        <span>Shell</span><b>${escapeHtml(data.shell ?? "?")}</b>
        <span>Home</span><b>${escapeHtml(data.home ?? "?")}</b>
        <span>磁盘</span><b>${escapeHtml(data.disk ?? "?")}</b>
        <span>内存</span><b>${escapeHtml(data.memory ?? "?")}</b>
      </div>
      <div class="sshconn-clis">
        ${(data.clis ?? []).map((cli) => `
          <div class="sshconn-cli${cli.installed ? "" : " is-missing"}">
            <span class="sshconn-cli-name">${escapeHtml(cli.label)}</span>
            <code>${escapeHtml(cli.command)}</code>
            ${cli.installed
              ? `<span class="sshconn-cli-ver" title="${escapeHtml(cli.rawVersion ?? "")}">${escapeHtml(cli.version ?? "已安装")}</span>`
              : `<span class="subtle">未安装</span>
                 <button type="button" class="button mini" data-config-install-cli="${escapeHtml(host.id)}:${escapeHtml(cli.id)}">安装</button>`}
          </div>`).join("")}
      </div>`;
  }
  panel.innerHTML = `
    <div class="config-surface-heading">
      <div>
        <p class="eyebrow">Remote Host</p>
        <h2><svg class="icon lucide"><use href="#lucide-globe"></use></svg> ${escapeHtml(host.name ?? host.id)}</h2>
        <p class="subtle">${escapeHtml(`${host.user ?? ""}@${host.host ?? ""}:${host.port ?? ""}`)}</p>
      </div>
      <div class="config-remote-actions">
        <button type="button" class="button secondary" data-config-host-probe="${escapeHtml(host.id)}"><svg class="icon lucide"><use href="#lucide-refresh-cw"></use></svg> 重新探测</button>
        <button type="button" class="button secondary" data-config-host-sync="${escapeHtml(host.id)}"><svg class="icon lucide"><use href="#lucide-cloud-upload"></use></svg> 同步本机配置</button>
        <button type="button" class="button secondary" data-config-host-terminal="${escapeHtml(host.id)}"><svg class="icon lucide"><use href="#lucide-square-terminal"></use></svg> 打开 SSH 终端</button>
      </div>
    </div>
    <div class="config-remote-result" aria-live="polite"></div>
    <div class="sshconn-detail config-remote-env">
      <div class="sshconn-detail-head"><strong><svg class="icon lucide"><use href="#lucide-activity"></use></svg> 远程环境</strong></div>
      ${envBody}
    </div>`;
}

async function probeConfigHost(id) {
  state.configHostProbes.set(id, { status: "loading" });
  if (state.configHostId === id) renderConfigRemotePanel();
  try {
    const result = await request(`/api/ssh/hosts/${id}/probe`, { method: "POST", body: JSON.stringify({}) });
    state.configHostProbes.set(id, { status: "ok", data: result?.probe ?? null });
  } catch (error) {
    state.configHostProbes.set(id, { status: "error", error: error.message });
  }
  if (state.configHostId === id) renderConfigRemotePanel();
}

/** 远程安装 CLI：确认框明示命令通道，结果内联如实回显，成功后重探测刷新矩阵。 */
async function installConfigCli(hostId, toolId) {
  const host = (state.configHosts ?? []).find((entry) => entry.id === hostId);
  const probe = state.configHostProbes.get(hostId);
  const cli = probe?.data?.clis?.find((entry) => entry.id === toolId);
  const platform = /darwin/i.test(probe?.data?.os ?? "") ? "darwin" : "linux";
  const verdict = await confirmAction({
    eyebrow: "远程安装",
    title: `在 ${host?.name ?? hostId} 安装 ${cli?.label ?? toolId}？`,
    rows: [
      ["主机", `${host?.user ?? ""}@${host?.host ?? ""}:${host?.port ?? ""}`],
      ["CLI", `${cli?.label ?? toolId}（${cli?.command ?? toolId}）`],
      ["通道", "官方安装命令（npm i -g / 官方脚本），输出如实回显，失败不伪造成功"],
    ],
    confirmLabel: "执行安装",
  });
  if (!verdict) return; // confirmAction 无 checkbox 时 resolve 布尔
  configRemoteResult(`<p class="subtle">正在安装 ${escapeHtml(cli?.label ?? toolId)}（最长 120s）…</p>`);
  try {
    const result = await request(`/api/ssh/hosts/${hostId}/install-cli`, { method: "POST", body: JSON.stringify({ toolId, platform }) });
    if (result.ok) await probeConfigHost(hostId); // 先重探测——重渲面板会清结果区，回报必须在重渲之后落
    configRemoteResult(`
      <div class="waveg-review">
        <strong>${result.ok ? "安装完成" : `安装失败（退出码 ${result.code ?? "?"}）`}：${escapeHtml(result.display ?? "")}</strong>
        <div class="waveg-log">${escapeHtml(result.stdout || "")}${result.stderr ? `\n[stderr]\n${escapeHtml(result.stderr)}` : ""}</div>
      </div>`);
  } catch (error) {
    configRemoteResult(`<div class="waveg-review"><strong>安装失败</strong><p class="subtle">${escapeHtml(error.message)}</p></div>`);
  }
}

/** 在该主机 home 目录开 SSH 终端（复用 pty ssh 面，与项目右键终端同链路）。 */
async function openConfigHostTerminal(hostId) {
  const host = (state.configHosts ?? []).find((entry) => entry.id === hostId);
  const home = state.configHostProbes.get(hostId)?.data?.home || "/";
  try {
    const result = await request("/api/pty", {
      method: "POST",
      body: JSON.stringify({ ssh: { hostId, path: home }, title: `${host?.name ?? hostId} · ${home}` }),
    });
    window.dispatchEvent(new CustomEvent("forge:pty-session-created", { detail: { session: result?.session } }));
    setView("terminal");
    toast(`已打开「${host?.name ?? hostId}」的远程终端`, "success");
  } catch (error) {
    toast(`打开远程终端失败:${error.message}`, "error");
  }
}

/** 一键同步本机配置：plan 列清单（含 secret 红字警示）→ 显式勾选确认 → 逐文件推送回报。 */
async function openConfigSyncDialog(host) {
  const dialog = document.createElement("dialog");
  dialog.className = "action-dialog sshconn-dialog";
  dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">同步配置</span><h2>同步到 ${escapeHtml(host.name ?? host.id)}</h2></div></div><div class="dialog-body"><p class="subtle">正在读取本机配置清单…</p></div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true }); // 一次性 dialog，关即销毁
  dialog.showModal();
  let plan;
  try {
    plan = await request(`/api/ssh/hosts/${host.id}/env-sync/plan`);
  } catch (error) {
    dialog.querySelector(".dialog-body").innerHTML = `<p class="subtle">读取失败：${escapeHtml(error.message)}</p><div class="dialog-actions"><button type="button" class="button secondary" data-act="cancel">关闭</button></div>`;
    dialog.querySelector('[data-act="cancel"]')?.addEventListener("click", () => dialog.close());
    return;
  }
  const files = plan?.files ?? [];
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div><span class="eyebrow">同步配置</span><h2>同步到 ${escapeHtml(host.name ?? host.id)}</h2></div>
      <button type="button" class="icon-button" data-act="cancel" aria-label="关闭对话框" title="关闭"><svg class="icon lucide"><use href="#lucide-x"></use></svg></button>
    </div>
    <div class="dialog-body">
      <p class="subtle">推送本机运行时实况文件到远端 <code>$HOME</code> 同名路径（整文件覆盖远端同名文件）。凭据文件（auth.json / .env）永不在清单内。</p>
      <div class="sshconn-sync-list">
        ${files.map((file) => `
          <label class="sshconn-sync-row${file.exists ? "" : " is-missing"}">
            <input type="checkbox" data-sync-file="${escapeHtml(file.id)}" ${file.exists && !file.containsSecrets ? "checked" : ""} ${file.exists ? "" : "disabled"} />
            <span class="sshconn-sync-main">
              <span>${escapeHtml(file.label)}${file.containsSecrets ? ` <span class="sshconn-badge is-warn">检测到疑似秘密</span>` : ""}</span>
              <span class="subtle">${escapeHtml(file.local)} → ~/${escapeHtml(file.remote)}${file.exists ? ` · ${file.size}B` : " · 本机不存在"}</span>
            </span>
          </label>`).join("")}
      </div>
      <p class="subtle" data-sync-msg></p>
    </div>
    <div class="dialog-actions">
      <button type="button" class="button secondary" data-act="cancel">取消</button>
      <button type="button" class="button primary" data-act="push"><svg class="icon lucide"><use href="#lucide-cloud-upload"></use></svg> 推送所选</button>
    </div>`;
  dialog.querySelectorAll('[data-act="cancel"]').forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.querySelector('[data-act="push"]')?.addEventListener("click", async () => {
    const selected = [...dialog.querySelectorAll("[data-sync-file]:checked")].map((box) => box.dataset.syncFile);
    const msg = dialog.querySelector("[data-sync-msg]");
    if (!selected.length) {
      if (msg) msg.textContent = "未选择任何文件。";
      return;
    }
    const secretPicks = selected.filter((id) => files.find((file) => file.id === id)?.containsSecrets);
    if (secretPicks.length) {
      const verdict = await confirmAction({
        eyebrow: "二次确认",
        title: "所选文件含疑似秘密",
        rows: [["文件", secretPicks.map((id) => files.find((file) => file.id === id)?.label ?? id).join("、")]],
        warning: "含疑似秘密字面量，将经 SSH 出本机写入远端。确认继续？",
        confirmLabel: "仍要推送",
        danger: true,
      });
      if (!verdict) return; // confirmAction 无 checkbox 时 resolve 布尔
    }
    if (msg) msg.textContent = "正在推送…";
    try {
      const result = await request(`/api/ssh/hosts/${host.id}/env-sync`, { method: "POST", body: JSON.stringify({ files: selected }) });
      dialog.close();
      configRemoteResult(`
        <div class="waveg-review">
          <strong>同步完成（远端 HOME=${escapeHtml(result?.home ?? "?")}）</strong>
          <div class="waveg-log">${(result?.results ?? []).map((entry) => `${entry.ok ? "✓" : "✗"} ${entry.label} → ${entry.remote}${entry.ok ? `（${entry.bytes}B）` : `：${entry.error}`}`).join("\n")}</div>
        </div>`);
    } catch (error) {
      if (msg) msg.textContent = `推送失败：${error.message}`;
    }
  });
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

// 配置图谱的能力面：skills 矩阵 + 花名册 + MCP 声明扫描
let capabilitiesLoadPromise = null;
let capabilitiesQueuedFreshPromise = null;
let capabilitiesFreshRequested = false;
let capabilitiesLoadEpoch = 0;

function invalidateCapabilitiesCatalog() {
  state.capabilitiesData = null;
  state.capabilitiesError = null;
  if (capabilitiesLoadPromise || capabilitiesQueuedFreshPromise) {
    return loadCapabilities({ fresh: true });
  }
  return Promise.resolve(successfulLoadResult(null, { invalidated: true }));
}

function startCapabilitiesLoad() {
  const epoch = ++capabilitiesLoadEpoch;
  state.capabilitiesLoading = true;
  let requestPromise;
  requestPromise = (async () => {
    try {
      const payload = await request(API.capabilities);
      if (epoch !== capabilitiesLoadEpoch) return successfulLoadResult(payload, { stale: true });
      state.capabilitiesData = payload;
      state.capabilitiesError = null;
      return successfulLoadResult(state.capabilitiesData);
    } catch (error) {
      if (epoch !== capabilitiesLoadEpoch) return successfulLoadResult(null, { stale: true });
      state.capabilitiesData = null;
      state.capabilitiesError = error.message;
      return failedLoadResult(error);
    } finally {
      if (epoch === capabilitiesLoadEpoch) {
        state.capabilitiesLoading = false;
        renderCapabilities();
        renderConfigTopology();
        // 团队设置已并入团队页；目录晚到时保留表单当前勾选，不回滚用户草稿。
        if (elements["team-settings-panel"]) {
          const editing = state.teams.find((team) => team.id === state.editingTeamId) ?? null;
          renderTeamChips(
            checkedChipValues("team-skills-chips", editing?.skills ?? []),
            checkedChipValues("team-mcp-chips", editing?.mcp ?? []),
            Boolean(editing?.builtin),
          );
        }
      }
    }
  })().finally(() => {
    if (capabilitiesLoadPromise === requestPromise) capabilitiesLoadPromise = null;
  });
  capabilitiesLoadPromise = requestPromise;
  return requestPromise;
}

function loadCapabilities({ fresh = false } = {}) {
  if (capabilitiesQueuedFreshPromise) {
    if (fresh) {
      capabilitiesFreshRequested = true;
      if (capabilitiesLoadPromise) capabilitiesLoadEpoch += 1;
    }
    return capabilitiesQueuedFreshPromise;
  }
  if (!capabilitiesLoadPromise) {
    capabilitiesFreshRequested = false;
    return startCapabilitiesLoad();
  }
  if (!fresh) return capabilitiesLoadPromise;

  capabilitiesFreshRequested = true;
  capabilitiesLoadEpoch += 1;
  const activeLoad = capabilitiesLoadPromise;
  let queuedPromise;
  queuedPromise = (async () => {
    try {
      let result = await activeLoad;
      while (capabilitiesFreshRequested) {
        capabilitiesFreshRequested = false;
        result = await startCapabilitiesLoad();
      }
      return result;
    } finally {
      if (capabilitiesQueuedFreshPromise === queuedPromise) capabilitiesQueuedFreshPromise = null;
    }
  })();
  capabilitiesQueuedFreshPromise = queuedPromise;
  return capabilitiesQueuedFreshPromise;
}

function capabilitySourceButton(sourceId, label) {
  if (!sourceId) return "";
  return `<button class="icon-button cap-source-button" type="button" data-capability-source-id="${escapeHtml(sourceId)}" title="在真源编辑器中打开" aria-label="打开 ${escapeHtml(label)} 的相关真源"><svg class="icon lucide"><use href="#lucide-file-text"></use></svg></button>`;
}

async function openCapabilitySource(sourceId) {
  if (!state.sources.length) {
    try {
      await loadSources();
    } catch (error) {
      toast(`真源索引读取失败：${error.message}`, "error", 6000);
      return;
    }
  }
  const source = state.sources.find((item) => item.id === sourceId) ?? null;
  if (!source) {
    toast(`未登记相关真源：${sourceId}`, "warning", 5000);
    return;
  }
  await selectSource(source.id);
  if (state.selectedSourceId !== source.id) return;
  setView("config", { configSurface: "sources", focus: false });
  runtimeSeatManager?.setMode("sources", { focus: false });
  const heading = elements["editor-title"];
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => {
      heading.scrollIntoView({ block: "start", behavior: "smooth" });
      heading.focus({ preventScroll: true });
    });
  }
}

function renderCapabilities() {
  const data = state.capabilitiesData;
  if (!elements["cap-skills-body"]) return;
  if (!data) {
    const message = state.capabilitiesError ? `读取失败：${state.capabilitiesError}` : "正在扫描…";
    elements["cap-agents-grid"].innerHTML = "";
    elements["cap-skills-body"].innerHTML = `<tr><td colspan="6" class="subtle">${escapeHtml(message)}</td></tr>`;
    elements["cap-mcp-body"].innerHTML = `<tr><td colspan="5" class="subtle">${escapeHtml(message)}</td></tr>`;
    elements["cap-mcp-map"].innerHTML = "";
    return;
  }
  const { skills, mcp } = data;
  elements["cap-agents-grid"].innerHTML = (skills.agents ?? []).length
    ? skills.agents
        .map(
          (agent) => `<div class="cap-agent-chip" title="${escapeHtml(agent.skill ?? "未挂 skill")}">
            <strong>${escapeHtml(agent.name ?? agent.code)}</strong>
            <span>${escapeHtml(agent.title ?? "")}</span>
            <code>${escapeHtml(agent.code)}</code>
          </div>`,
        )
        .join("")
    : '<span class="subtle">module.yaml 花名册不可用</span>';
  const registered = skills.items.filter((skill) => skill.registered).length;
  const members = skills.memberIds ?? [];
  const capabilityStatus = skills.configurationStatus ?? {};
  const mcpStatus = mcp.configurationStatus ?? {};
  const capabilityDegraded = capabilityStatus.failClosed === true;
  elements["cap-skills-summary"].textContent = capabilityDegraded
    ? `能力配置已降级：${capabilityStatus.message || capabilityStatus.code || "配置不可读"}。全部 Skill 声明已停用，修复配置前禁止派发。`
    : `${skills.items.length} 个 skill（${registered} 已注册）· ${members.length} 个成员 · 勾选=向成员编排提示词声明（非工具沙箱）` +
      (skills.registryStatus === "ok" ? "" : " · 注册表不可用（仅文件系统扫描）");
  // 启停矩阵：行=skill，列=成员；checkbox 勾选=启用（负名单 disabledSkills 之外）
  const states = skills.agentSkillStates ?? {};
  elements["cap-skills-head"].innerHTML = `<tr><th scope="col">Skill</th>${members.map((id) => {
    const label = agentLabel(id);
    return `<th scope="col" tabindex="-1" title="${escapeHtml(id)}" aria-label="${escapeHtml(label)} Skill 配置列" data-member-column="${escapeHtml(id)}" class="${id === state.configMemberFocusId ? "is-member-focus" : ""}">${escapeHtml(label)}</th>`;
  }).join("")}</tr>`;
  elements["cap-skills-body"].innerHTML = skills.items.length
    ? skills.items
        .map(
          (skill) => `<tr>
            <td class="mono cap-skill-source" title="${escapeHtml(skill.description || skill.path)}"><span>${escapeHtml(skill.code)}${skill.registered ? "" : ' <span class="subtle">（未注册）</span>'}</span>${capabilitySourceButton(skill.sourceId, skill.code)}</td>
            ${members
              .map((id) => {
                const enabled = !(states[id]?.disabledSkills ?? []).includes(skill.code);
                const disabled = capabilityDegraded || states[id]?.failClosed === true;
                const title = disabled
                  ? "能力配置损坏或不可读，已按 fail-closed 停用"
                  : "控制编排提示词中的 Skill 声明；真实调用仍受运行时权限约束";
                return `<td class="cap-cell${id === state.configMemberFocusId ? " is-member-focus" : ""}" data-member-column="${escapeHtml(id)}"><input type="checkbox" data-skill-toggle="${escapeHtml(id)}::${escapeHtml(skill.code)}"${enabled ? " checked" : ""}${disabled ? " disabled" : ""} title="${escapeHtml(title)}" aria-label="${escapeHtml(agentLabel(id))} 声明 ${escapeHtml(skill.code)}" /></td>`;
              })
              .join("")}
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="${members.length + 1}" class="subtle">未扫描到 skill 目录</td></tr>`;
  const ghosts = skills.ghostRegistrations ?? [];
  elements["cap-skills-ghosts"].hidden = !ghosts.length;
  elements["cap-skills-ghosts"].textContent = ghosts.length
    ? `幽灵注册（注册表有而磁盘无）：${ghosts.map((ghost) => ghost.code).join("、")}——建议清理 module.yaml`
    : "";
  elements["cap-mcp-summary"].textContent = mcpStatus.failClosed
    ? `MCP 启停已冻结 [${mcpStatus.code || "MCP_QUARANTINE_UNAVAILABLE"}]：${mcpStatus.message || "隔离配置不可用"}${mcpStatus.causeCode ? `（${mcpStatus.causeCode}）` : ""}`
    : `${mcp.servers.length} 个声明 · ${mcp.sources.length} 个来源文件`;
  elements["cap-mcp-body"].innerHTML = mcp.servers.length
    ? mcp.servers
        .map(
          (server) => `<tr${server.disabled ? ' class="is-disabled-row"' : ""}>
            <td class="mono">${escapeHtml(server.name)}${server.disabled ? ' <span class="hidden-badge">已禁用</span>' : ""}</td>
            <td>${escapeHtml(server.transport)}</td>
            <td class="mono">${escapeHtml(server.command ?? server.urlHost ?? "—")}</td>
            <td>${escapeHtml(server.scope)}</td>
            <td class="mono cap-path" title="${escapeHtml(server.source)}"><span>${escapeHtml(server.source.split(/[\\/]/).pop())}</span>${capabilitySourceButton(server.sourceId, server.name)}</td>
            <td>${mcpActionMarkup(server, mcp)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="subtle">未扫描到 MCP 声明</td></tr>`;
  elements["cap-mcp-map"].innerHTML = (mcp.capabilityMap ?? []).length
    ? `<p class="subtle">514cc 能力映射（module.yaml 策展层）：</p>` +
      mcp.capabilityMap
        .map((entry) => `<span class="cap-map-entry">${escapeHtml(entry.capability)} → ${escapeHtml(Array.isArray(entry.servers) ? entry.servers.join("、") : String(entry.servers))}</span>`)
        .join("")
    : "";
}

function focusMemberCapabilityColumn(memberId) {
  if (!memberId) return false;
  const heading = elements["cap-skills-head"]?.querySelector(`[data-member-column="${CSS.escape(memberId)}"]`);
  if (!heading) return false;
  requestAnimationFrame(() => {
    if (state.configMemberFocusId !== memberId || state.view !== "config" || state.configSurface !== "capabilities") return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    heading.scrollIntoView({ block: "nearest", inline: "center", behavior: reduceMotion ? "auto" : "smooth" });
    heading.focus({ preventScroll: true });
  });
  return true;
}

function focusConfigSurfaceHeading(surface) {
  const heading = byId(`config-surface-${surface}`)?.querySelector("h2");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  requestAnimationFrame(() => {
    if (state.view === "config" && state.configSurface === surface) heading.focus({ preventScroll: true });
  });
}

async function openMemberConfigTarget({ surface, memberId, runtimeProfileId, create = false } = {}) {
  const targetEpoch = ++memberConfigTargetEpoch;
  if (surface === "capabilities") {
    state.configMemberFocusId = memberId || null;
    state.configRuntimeFocusId = runtimeProfileId || null;
    setView("config", {
      configSurface: "capabilities",
      focus: false,
      preserveMemberTarget: true,
    });
    const cachedMembers = state.capabilitiesData?.skills?.memberIds ?? [];
    let loadResult = successfulLoadResult(state.capabilitiesData, { cached: true });
    if (!memberId || !cachedMembers.includes(memberId)) {
      loadResult = await loadCapabilities({ fresh: true });
    }
    if (targetEpoch !== memberConfigTargetEpoch) return;
    renderCapabilities();
    if (loadResultFailed(loadResult)) {
      focusConfigSurfaceHeading("capabilities");
      toast(`Skill / MCP 读取失败：${loadResult.error?.message || "未知错误"}`, "error", 6000);
      return;
    }
    if (!focusMemberCapabilityColumn(memberId)) {
      focusConfigSurfaceHeading("capabilities");
      toast("该成员尚未进入 Skill 配置目录", "warning");
    }
    return;
  }

  if (!runtimeProfileId && !create) {
    toast("当前成员尚未绑定运行席位", "warning");
    return;
  }
  state.configMemberFocusId = memberId || null;
  state.configRuntimeFocusId = runtimeProfileId || null;
  setView("config", {
    configSurface: "sources",
    focus: false,
    preserveMemberTarget: true,
  });
  try {
    if (!runtimeSeatManager) throw new Error("运行席位管理器尚未初始化");
    runtimeSeatManager.setMode("seats", { focus: false });
    if (create) await runtimeSeatManager.create();
    else {
      await runtimeSeatManager.load();
      const found = await runtimeSeatManager.focus(runtimeProfileId);
      if (!found) toast(`运行席位目录中未找到 ${runtimeProfileId}`, "warning");
    }
    if (targetEpoch !== memberConfigTargetEpoch) return;
  } catch (error) {
    if (targetEpoch !== memberConfigTargetEpoch) return;
    focusConfigSurfaceHeading("sources");
    toast(`运行席位读取失败：${error.message}`, "error");
  }
}

// MCP 行操作：claude.json 全局 server 可隔离启停（禁用=移隔离区可恢复）；其他来源如实只读
function mcpActionMarkup(server, mcp) {
  const writable = server.scope === "全局" && server.source.endsWith(".claude.json");
  if (!writable) return '<span class="subtle">只读</span>';
  const action = server.disabled ? "enable" : "disable";
  const label = server.disabled ? "恢复" : "禁用";
  const degraded = mcp.configurationStatus?.failClosed === true;
  const title = degraded ? `MCP 启停已冻结：${mcp.configurationStatus.message || mcp.configurationStatus.code || "隔离配置不可用"}` : "";
  return `<button class="text-button" type="button" data-mcp-toggle="${escapeHtml(server.name)}::${action}" data-mcp-source="${escapeHtml(server.source)}" data-mcp-mtime="${Number(mcp.claudeJsonMtimeMs) || ""}"${degraded ? ` disabled aria-describedby="cap-mcp-summary" title="${escapeHtml(title)}"` : ""}>${label}</button>`;
}

async function toggleMcp(button) {
  const mcpStatus = state.capabilitiesData?.mcp?.configurationStatus ?? {};
  if (mcpStatus.failClosed) {
    button.disabled = true;
    toast(`MCP 启停已冻结：${mcpStatus.message || mcpStatus.code || "隔离配置不可用"}`, "error", 6000);
    return;
  }
  const [name, action] = String(button.dataset.mcpToggle).split("::");
  if (action === "disable") {
    const verdict = await confirmAction({
      eyebrow: "MCP 启停",
      title: `禁用「${name}」？`,
      rows: [
        ["方式", "移入控制面隔离区（可从本页一键恢复，不是删除）"],
        ["影响", "禁用后 Claude Code 新会话不再加载该 server"],
      ],
      warning: "若 Claude Code 正在运行，它可能并发回写 .claude.json 覆盖本次修改——建议关闭 Claude Code 后操作。",
      confirmLabel: "禁用",
    });
    if (!verdict) return;
  }
  button.disabled = true;
  try {
    await request("/api/capabilities/mcp/toggle", {
      method: "POST",
      body: { name, source: button.dataset.mcpSource, action, knownMtimeMs: button.dataset.mcpMtime || undefined },
    });
    toast(action === "disable" ? `已禁用 ${name}（隔离区可恢复）` : `已恢复 ${name}`, "success");
  } catch (error) {
    toast(`操作失败：${error.message}`, "error", 6000);
  }
  button.disabled = false;
  void loadCapabilities();
}

async function toggleAgentSkill(checkbox) {
  const [agentId, skill] = String(checkbox.dataset.skillToggle).split("::");
  const enabled = checkbox.checked;
  checkbox.disabled = true;
  try {
    await request("/api/capabilities/agent-skill", { method: "PUT", body: { agentId, skill, enabled } });
    const states = state.capabilitiesData?.skills?.agentSkillStates;
    if (states?.[agentId]) {
      const list = new Set(states[agentId].disabledSkills ?? []);
      if (enabled) list.delete(skill);
      else list.add(skill);
      states[agentId].disabledSkills = [...list];
    }
    toast(`${agentLabel(agentId)} ${enabled ? "启用" : "禁用"} ${skill}`, "success", 2000);
  } catch (error) {
    checkbox.checked = !enabled; // 失败回滚勾选态
    toast(`保存失败：${error.message}`, "error", 5000);
  }
  checkbox.disabled = false;
}

function renderOverview() {
  if (state.view !== "overview") return;
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
          const label = statusText(item.rawStatus ?? item.status); // 原始态专属文案（待命/未安装/未配置）
          return `
            <div class="health-row">
              <div class="health-main">
                <span class="status-dot is-${status}" aria-hidden="true"></span>
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <span>${escapeHtml(item.detail || label)}</span>
                </div>
              </div>
              <span class="health-latency">${escapeHtml(label)}${item.latency == null ? "" : ` · ${formatDuration(item.latency)}`}</span>
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

function emptyMarkup(title, detail = "", streamKey = "") {
  const keyAttribute = streamKey ? ` data-stream-key="${escapeHtml(streamKey)}"` : "";
  return `<div class="empty-state"${keyAttribute}><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

// agent 徽标选择器：项目内新建会话后，只允许选择真实 CLI 成员。
function agentPickerMarkup() {
  const team = teamById(state.selectedTeamId || defaultTeamId()) ?? state.teams.find((item) => item.builtin);
  const members = team?.members?.length
    ? team.members
    : ["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "gemini-research", "pi-resident"];
  const coordinator = team?.coordinator ?? members[0];
  const cards = members
    .map((id) => {
      const cli = agentCli(id);
      const logo = cli ? cliIconMarkup(cli, "cli-logo") : `<span class="agent-pick-fallback">${escapeHtml(AGENT_SHORT[id] ?? "??")}</span>`;
      return `<button class="agent-pick-card is-agent-${agentSlug(id)}" type="button" data-pick-agent="${escapeHtml(id)}" title="直接发送给 ${escapeHtml(agentLabel(id))}">
        <span class="agent-pick-logo" aria-hidden="true">${logo}</span>
        <strong>${escapeHtml(agentLabel(id))}</strong>
        <span>${id === coordinator ? "团队主脑 · 直接发送" : "直达成员 CLI"}</span>
      </button>`;
    })
    .join("");
  return `
    <div class="empty-state welcome-state" data-stream-key="empty:agent-picker">
      <h2 class="welcome-hero is-picker">发送给谁？</h2>
      <span class="welcome-sub">选择成员即直达其 CLI，并使用该成员专属的模型、Effort、权限与命令</span>
      <div class="agent-pick-grid">${cards}</div>
    </div>`;
}
// 欢迎空态快捷任务模板（codeg Quick Actions 对标 + 514 多 CLI 团队强化）
// 只填不提交，LO 改完再发；模板措辞含体系纪律：证据优先、四节评审、隔离构建先计划
const QUICK_TASK_TEMPLATES = [
  {
    icon: "scan-search",
    title: "深度评审",
    detail: "烛独立审视 · file:line 证据",
    category: "review",
    startAgent: "codex-technical",
    prompt: "请对当前项目做一次深度代码评审：找出致命问题与架构风险，逐条给出 file:line 证据，按「致命问题 / 建议改进 / 可保留 / 总评」四节输出。",
  },
  {
    icon: "telescope",
    title: "调研问路",
    detail: "织拉情报 · 结论必附来源",
    category: "research",
    startAgent: "grok-search",
    prompt: "帮我调研以下主题的最新实践与可行方案，事实先于观点、结论必须附来源：\n\n<在这里填写主题>",
  },
  {
    icon: "hammer",
    title: "隔离构建",
    detail: "工作树写码 · 先计划后动手",
    category: "build",
    startAgent: null,
    prompt: "请在隔离工作树中实现以下功能：先输出实现计划与验收标准，经我确认后再动手写码；禁止声称未验证的完成。\n\n<在这里填写功能>",
  },
  {
    icon: "users",
    title: "团队会诊",
    detail: "多 CLI 社会编排 · 各司其职",
    category: "collab",
    startAgent: null,
    prompt: "请以团队协作方式处理以下目标：由当前团队主脑规划拆解，根据已选成员的职责与真实能力派工，最终由主脑收敛并给出可验证结论。\n\n目标：\n",
  },
];

// 成员角色一句话（欢迎星图 / 命令面板共用；与治理身份绑定，不是 provider 广告词）
// 真源：modules/agent-roles.js —— 此处兼容旧引用
const AGENT_ROLE_BLURB = MODULE_AGENT_ROLE_BLURB;

function currentTeamMembers() {
  const team = teamById(state.selectedTeamId || defaultTeamId()) ?? state.teams.find((item) => item.builtin);
  const members = team?.members?.length
    ? team.members
    : ["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "pi-resident"];
  return {
    team,
    members,
    coordinator: team?.coordinator ?? members[0],
    name: team?.name || "514cc",
  };
}

// codeg WelcomeTip：目录抽到 modules/welcome-tips.js，这里只负责注入 lucide 图标
function welcomeTipMarkup() {
  return buildWelcomeTipMarkup({ iconHtml: lucideIcon("sparkles", "icon lucide") });
}

function teamConstellationMarkup() {
  const { members, coordinator, name } = currentTeamMembers();
  const orbit = members.map((id, index) => {
    const cli = agentCli(id);
    const logo = cli ? cliIconMarkup(cli, "cli-logo") : `<span class="agent-pick-fallback">${escapeHtml(AGENT_SHORT[id] ?? "??")}</span>`;
    const isLeader = id === coordinator;
    // 环形布局：leader 居中视觉焦点，其余均分圆周（纯 CSS 变量驱动，无 JS 动画依赖）
    const peers = Math.max(members.length - (members.includes(coordinator) ? 1 : 0), 1);
    const peerIndex = members.filter((item) => item !== coordinator).indexOf(id);
    const angle = isLeader ? 0 : (peerIndex >= 0 ? peerIndex : index) * (360 / peers) - 90;
    return `<button class="constellation-chip is-agent-${agentSlug(id)}${isLeader ? " is-leader" : " is-orbit"}" type="button"
      data-pick-agent="${escapeHtml(id)}"
      data-orbit-angle="${angle}"
      title="直接发送给 ${escapeHtml(agentLabel(id))}">
      <span class="constellation-logo" aria-hidden="true">${logo}</span>
      <span class="constellation-copy">
        <strong>${escapeHtml(agentLabel(id))}${isLeader ? " · leader" : ""}</strong>
        <span>${escapeHtml(AGENT_ROLE_BLURB[id] || cliLabel(cli) || "成员")}</span>
      </span>
      ${cli ? `<span class="constellation-cli-tag">${escapeHtml(cliLabel(cli))}</span>` : ""}
    </button>`;
  }).join("");
  return `
    <div class="team-constellation" role="group" aria-label="当前团队 ${escapeHtml(name)}">
      <div class="constellation-head">
        <span class="constellation-kicker">异构 CLI 团队</span>
        <strong>${escapeHtml(name)}</strong>
        <span class="constellation-meta">${members.length} 席 · 原生会话互不抹平 · 治理身份 ≠ Provider</span>
      </div>
      <div class="constellation-stage" data-member-count="${members.length}">
        <div class="constellation-orbit-ring" aria-hidden="true"></div>
        <div class="constellation-grid">${orbit}</div>
      </div>
      <div class="constellation-legend" aria-hidden="true">
        <span><i class="lg-dot is-leader"></i>Leader 收敛</span>
        <span><i class="lg-dot is-route"></i>可寻址路由</span>
        <span><i class="lg-dot is-lease"></i>审批=租约</span>
      </div>
      <p class="constellation-hint">点击成员即切换直接发送目标；<kbd>@</kbd> 仅点名协作成员 · <kbd>/</kbd> 切换当前 CLI 控件</p>
    </div>`;
}

function welcomeTemplatesMarkup() {
  const category = state.welcomeCategory || "all";
  const categories = [
    { id: "all", label: "全部" },
    { id: "collab", label: "协作" },
    { id: "review", label: "评审" },
    { id: "research", label: "调研" },
    { id: "build", label: "构建" },
  ];
  const tabs = categories.map((item) => `
    <button class="welcome-cat${category === item.id ? " is-active" : ""}" type="button" data-welcome-cat="${escapeHtml(item.id)}">
      ${escapeHtml(item.label)}
    </button>`).join("");
  const cards = QUICK_TASK_TEMPLATES
    .filter((tpl) => category === "all" || tpl.category === category)
    .map(
      (tpl) => `
      <button class="template-card is-cat-${escapeHtml(tpl.category)}" type="button"
        data-quick-template="${escapeHtml(tpl.prompt)}"
        data-quick-start-agent="${escapeHtml(tpl.startAgent || "")}">
        <span class="template-icon" aria-hidden="true">${lucideIcon(tpl.icon, "icon lucide")}</span>
        <strong>${escapeHtml(tpl.title)}</strong>
        <span>${escapeHtml(tpl.detail)}</span>
        ${tpl.startAgent ? `<em class="template-start">${escapeHtml(agentLabel(tpl.startAgent))}</em>` : ""}
      </button>`,
    ).join("");
  // codeg 式 hero + tip + 分类 Quick Actions + 514 多 CLI 团队星图（本系统差异化）
  return `
    <div class="empty-state welcome-state" data-stream-key="empty:welcome">
      <h2 class="welcome-hero">LO，今天想<span class="hero-accent">做</span>点什么？</h2>
      <span class="welcome-sub">一个控制面，多套<strong>真实 CLI 进程</strong>各保边界——规划、评审、情报、前端同房间协作；路由、审批与证据可回放。</span>
      ${welcomeTipMarkup()}
      ${teamConstellationMarkup()}
      <div class="welcome-section-label">快速开始</div>
      <div class="welcome-cats" role="tablist" aria-label="任务模板分类">${tabs}</div>
      <div class="welcome-templates">${cards || `<div class="empty-state compact-empty"><span>该分类暂无模板</span></div>`}</div>
    </div>`;
}

// ── 命令面板扩展项（v4.0 Forge）：注入 command-palette.js 的 extraItems ──
// 视图导航由面板模块从 VIEW_TITLES 自动同步；这里只补面板本身没有的协作/权限/模板动作。
const FORGE_PALETTE_EXTRA_ITEMS = () => [
  {
    id: "task:new",
    group: "协作",
    label: "新建任务",
    detail: "清空选中会话，进入新任务输入",
    icon: "plus",
    keywords: "new task 新建 任务",
    run: () => {
      state.selectedRunId = null;
      state.selectionClearedByUser = true;
      state.activeTabKey = null;
      persistTabs();
      renderTabs();
      state.agentPickerOpen = false;
      renderSelectedRun();
      elements["task-input"]?.focus({ preventScroll: true });
    },
  },
  {
    id: "team:manage",
    group: "协作",
    label: "团队工作区",
    detail: "查看运行态并配置团队",
    icon: "users",
    keywords: "team 团队 管理 members",
    run: () => {
      const team = teamById(state.selectedTeamId) || state.teams.find((item) => item.builtin) || state.teams[0];
      if (team) void openTeamWorkspace(team);
      else toast("团队尚未加载", "error");
    },
  },
  {
    id: "auto:save",
    group: "协作",
    label: "存为自动化",
    detail: "把当前 composer 快照存为可定时任务",
    icon: "archive",
    keywords: "automation 自动化 cron",
    run: () => byId("save-automation-button")?.click(),
  },
  {
    id: "auto:manage",
    group: "协作",
    label: "管理自动化",
    detail: "编辑计划、权限、历史与取消运行",
    icon: "timer",
    keywords: "automation manage 自动化 管理 历史",
    run: () => openAutomationManager(),
  },
  {
    id: "mode:review",
    group: "权限",
    label: "切换 Review 深审",
    detail: "只读深审模式，禁止写盘",
    icon: "eye",
    keywords: "review permission 权限 深审",
    run: () => {
      if (elements["task-permission"]) elements["task-permission"].value = "review";
      syncPermissionPill();
      toast("权限：Review · 深审", "info", 1800);
    },
  },
  ...QUICK_TASK_TEMPLATES.map((tpl) => ({
    id: `tpl:${tpl.category}:${tpl.title}`,
    group: "模板",
    label: tpl.title,
    detail: tpl.detail,
    icon: "lightbulb",
    keywords: `${tpl.title} ${tpl.detail} template ${tpl.category}`,
    run: () => applyQuickTemplate(tpl.prompt, tpl.startAgent),
  })),
];

function applyQuickTemplate(prompt, startAgent) {
  state.requestedAgentIds = [];
  renderRequestedAgentChips();
  let appliedStartAgent = null;
  if (elements["task-input"]) {
    elements["task-input"].value = prompt;
    elements["task-input"].dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (startAgent && activeComposerTarget().members.includes(startAgent)) {
    selectComposerTarget(startAgent, { focusInput: false });
    appliedStartAgent = startAgent;
  }
  setView("workbench");
  elements["task-input"]?.focus({ preventScroll: true });
  toast(appliedStartAgent ? `模板已填入 · 直接发送给 ${agentLabel(appliedStartAgent)}` : "模板已填入任务内容，可修改后发送", "info", 2400);
}

// ── @ 成员提及：结构化协作点名，与直接收件人目标标签严格分离 ──
function hideMentionMenu() {
  const menu = byId("mention-menu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  state.mentionActive = false;
  state.mentionIndex = -1;
  state.mentionCandidates = [];
}

function mentionQueryAtCursor(textarea) {
  if (!textarea) return null;
  const value = textarea.value;
  const caret = textarea.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const match = before.match(/(^|[\s\n])@([\w\u4e00-\u9fff-]*)$/);
  if (!match) return null;
  return { start: caret - match[2].length - 1, end: caret, query: match[2].toLowerCase() };
}

function renderMentionMenu() {
  const menu = byId("mention-menu");
  const textarea = elements["task-input"];
  if (!menu || !textarea) return;
  const hit = mentionQueryAtCursor(textarea);
  if (!hit) {
    hideMentionMenu();
    return;
  }
  const { members, coordinator } = currentTeamMembers();
  const candidates = members
    .map((id) => ({
      id,
      label: agentLabel(id),
      role: AGENT_ROLE_BLURB[id] || "",
      isLeader: id === coordinator,
    }))
    .filter((item) => {
      if (!hit.query) return true;
      return `${item.label} ${item.id} ${item.role}`.toLowerCase().includes(hit.query);
    });
  if (!candidates.length) {
    hideMentionMenu();
    return;
  }
  state.mentionActive = true;
  state.mentionCandidates = candidates;
  state.mentionIndex = 0;
  state.mentionRange = hit;
  menu.hidden = false;
  menu.innerHTML = candidates.map((item, index) => {
    const cli = agentCli(item.id);
    const logo = cli ? cliIconMarkup(cli, "cli-logo") : "";
    return `<button class="mention-item${index === 0 ? " is-active" : ""} is-agent-${agentSlug(item.id)}" type="button" data-mention-id="${escapeHtml(item.id)}">
      <span class="mention-logo" aria-hidden="true">${logo}</span>
      <span class="mention-copy">
        <strong>${escapeHtml(item.label)}${item.isLeader ? " · leader" : ""}</strong>
        <span>${escapeHtml(item.role)}</span>
      </span>
    </button>`;
  }).join("");
}

function applyMention(agentId) {
  const textarea = elements["task-input"];
  const range = state.mentionRange;
  if (!textarea || !range || !agentId) return;
  const continuing = Boolean(selectedRun() && !TERMINAL_RUN_STATES.has(selectedRun().status));
  if (!continuing
    && !state.requestedAgentIds.includes(agentId)
    && state.requestedAgentIds.length >= MAX_REQUESTED_AGENTS) {
    hideMentionMenu();
    toast(`一次最多点名 ${MAX_REQUESTED_AGENTS} 个 Agent`, "warning", 2400);
    textarea.focus({ preventScroll: true });
    return;
  }
  const label = agentLabel(agentId);
  const before = textarea.value.slice(0, range.start);
  const after = textarea.value.slice(range.end);
  const insert = `@${label} `;
  textarea.value = `${before}${insert}${after}`;
  const caret = before.length + insert.length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));

  // @ 是新任务的结构化协作点名，不得覆盖“活动目标标签 = 直接收件人”。
  if (!continuing) {
    state.requestedAgentIds = addRequestedAgentId(state.requestedAgentIds, agentId);
    renderRequestedAgentChips();
  }
  hideMentionMenu();
  textarea.focus({ preventScroll: true });
  toast(`已点名 ${label}`, "success", 1800);
}

function renderRequestedAgentChips() {
  const container = byId("composer-collaborators");
  if (!container) return;
  const ids = [...state.requestedAgentIds];
  container.hidden = ids.length === 0;
  container.innerHTML = ids.length
    ? `<span class="composer-collaborator-label">${lucideIcon("users", "icon lucide")} 额外协作者</span>${ids.map((id) => {
        const cli = agentCli(id);
        return `<span class="composer-collaborator-chip is-agent-${agentSlug(id)}">
          <span aria-hidden="true">${cli ? cliIconMarkup(cli, "cli-logo") : lucideIcon("terminal", "icon lucide")}</span>
          <span>${escapeHtml(agentLabel(id))}</span>
          <button type="button" data-requested-agent-remove="${escapeHtml(id)}" title="移除额外协作者" aria-label="移除额外协作者 ${escapeHtml(agentLabel(id))}">${lucideIcon("x", "icon lucide")}</button>
        </span>`;
      }).join("")}`
    : "";
}

function removeRequestedAgent(agentId, { focusInput = true } = {}) {
  const id = String(agentId || "");
  if (!id || !state.requestedAgentIds.includes(id)) return;
  state.requestedAgentIds = state.requestedAgentIds.filter((candidate) => candidate !== id);
  const input = elements["task-input"];
  if (input) {
    input.value = removeRequestedAgentMention(input.value, agentLabel(id));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    renderRequestedAgentChips();
  }
  if (focusInput) input?.focus({ preventScroll: true });
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
      <span class="run-status is-${escapeHtml(statusClass)}">${escapeHtml(runStatusText(run.status, run))}</span>
    </div>`;
}

function pinMarkup() {
  return `<svg class="pin-mark" viewBox="0 0 24 24" aria-label="已置顶"><path d="${MENU_ICONS.pin}" /></svg>`;
}

// 会话行状态点色调：左栏一眼扫出哪些活着/等你/挂了（精致化波次——状态从文字变信号）
function runStatusTone(run) {
  if (["failed"].includes(run.status)) return "red";
  if (run.status === "recovery_required") return "red";
  if (run.status === "waiting_approval") return "amber";
  if (run.pendingAsk && !TERMINAL_RUN_STATES.has(run.status)) return "amber";
  if (["running", "queued"].includes(run.status)) return "live";
  if (run.status === "waiting_agent") return "live";
  if (["succeeded", "completed", "complete"].includes(run.status)) return "green";
  return "neutral"; // cancelled 等
}

function railRunMarkup(run) {
  const waitingAnswer = Boolean(run.pendingAsk) && !TERMINAL_RUN_STATES.has(run.status); // ask 挂起：琥珀点（终态残留不亮）
  return `
    <div class="rail-run-row">
      <button class="rail-run-button${run.id === state.selectedRunId ? " is-selected" : ""}${run.unread ? " is-unread" : ""}${waitingAnswer ? " is-waiting-answer" : ""}" type="button" data-run-select="${escapeHtml(run.id)}">
        <span class="rail-status-dot is-${runStatusTone(run)}" aria-hidden="true"></span>
        <strong>${run.unread ? `<span class="unread-dot" aria-label="未读"></span>` : ""}${waitingAnswer ? `<span class="ask-dot" aria-label="等你回答"></span>` : ""}${run.pinned ? pinMarkup() : ""}${escapeHtml(run.title)}</strong>
        <span title="${escapeHtml(formatDate(run.updatedAt ?? run.createdAt))}">${escapeHtml(runStatusText(run.status, run))}${run.teamName ? ` · ${escapeHtml(run.teamName)}` : ""} · ${escapeHtml(formatRelative(run.updatedAt ?? run.createdAt))}</span>
      </button>
      ${menuTriggerMarkup("run", run.id, `打开「${run.title}」任务菜单`)}
    </div>`;
}

function renderRuns() {
  // 已清除 run 的页签如实关闭（clearFinished/重启后 run 不存在）
  const existingRunIds = new Set(state.runs.map((run) => run.id));
  if (state.tabs.some((tab) => !existingRunIds.has(tab.runId))) {
    const removedRunIds = [...new Set(state.tabs.filter((tab) => !existingRunIds.has(tab.runId)).map((tab) => tab.runId))];
    state.tabs = state.tabs.filter((tab) => existingRunIds.has(tab.runId));
    if (state.activeTabKey && !state.tabs.some((tab) => tab.key === state.activeTabKey)) {
      state.activeTabKey = state.tabs.at(-1)?.key ?? null;
      state.selectedRunId = activeTab()?.runId ?? null;
    }
    persistTabs();
    renderTabs();
    renderMemberStrip();
    for (const runId of removedRunIds) releaseRunHistoryIfUnreferenced(runId);
  }
  if (state.view !== "workbench") return;
  // 左栏分区（互斥）：会话=普通任务；正在工作=活跃 run；置顶/已归档=renderRailMetaSections（run + 原生会话混合）
  // LO 2026-08-04：侧栏按选中团队隔离——其他团队的任务不进会话/正在工作区
  const visible = state.runs.filter((run) => !run.archived && runInRailTeam(run));
  const working = visible.filter((run) => ACTIVE_RUN_STATES.has(run.status));
  const workingIds = new Set(working.map((run) => run.id));
  const regular = visible.filter((run) => !workingIds.has(run.id) && !run.pinned);
  elements["run-count"].textContent = String(regular.length);
  commitMarkup(elements["workbench-run-list"], regular.length
    ? regular.map(railRunMarkup).join("")
    : `<div class="empty-state"><span>暂无任务</span></div>`);
  elements["rail-working"].hidden = !working.length;
  elements["working-count"].textContent = String(working.length);
  commitMarkup(elements["working-run-list"], working.map(railRunMarkup).join(""));
  renderRailMetaSections();
  renderProjects(); // run.sessions 变了，树内协作会话聚合（runSessionLinkIndex）也要跟着翻页；commitMarkup 幂等不抢焦点
  renderSelectedRun();
}

// ===== 置顶区 + 已归档区：Console run 与原生历史会话混合渲染（Codex 式单一置顶区） =====
function renderRailMetaSections() {
  if (state.view !== "workbench") return;
  // LO 2026-08-04：置顶/已归档同样按选中团队隔离，不在侧栏混显其他团队
  const railId = railTeamId();
  const pinnedRuns = state.runs.filter((run) => !run.archived && run.pinned && !ACTIVE_RUN_STATES.has(run.status) && runInRailTeam(run));
  const allProjects = [...state.pendingProjects, ...(state.projectsData?.projects ?? []), ...remoteTreeNodes()]; // 乐观/远程项目也可置顶/归档进分区
  const pinnedProjects = allProjects.filter((project) => {
    const pref = projectPrefOf(project);
    return pref.pinned && !pref.hidden && effectiveProjectTeamId(project) === railId;
  });
  const pinnedSessions = [];
  const archivedSessions = [];
  for (const project of allProjects) {
    if (projectPrefOf(project).hidden) continue;
    for (const session of project.sessions ?? []) {
      if (effectiveSessionTeamId(project, session) !== railId) continue;
      const pref = sessionPrefOf(session.cli ?? "claude", project.id, session.id);
      if (pref.archived) archivedSessions.push({ project, session });
      else if (pref.pinned) pinnedSessions.push({ project, session });
    }
  }
  const pinnedTotal = pinnedRuns.length + pinnedProjects.length + pinnedSessions.length;
  elements["rail-pinned"].hidden = !pinnedTotal;
  elements["pinned-count"].textContent = String(pinnedTotal);
  commitMarkup(elements["pinned-run-list"], [
    ...pinnedRuns.map(railRunMarkup),
    ...pinnedProjects.map((project, index) => pinnedProjectMarkup(project, index)),
    ...pinnedSessions.map(({ project, session }) => sessionLinkMarkup(project, session)),
  ].join(""));
  const archivedRuns = state.runs.filter((run) => run.archived && runInRailTeam(run));
  const archivedTotal = archivedRuns.length + archivedSessions.length;
  elements["rail-archived"].hidden = !archivedTotal;
  elements["archived-count"].textContent = String(archivedTotal);
  elements["archived-toggle"].setAttribute("aria-expanded", String(state.archivedExpanded));
  elements["archived-run-list"].hidden = !state.archivedExpanded;
  commitMarkup(
    elements["archived-run-list"],
    state.archivedExpanded
      ? [
          ...archivedRuns.map(railRunMarkup),
          ...archivedSessions.map(({ project, session }) => sessionLinkMarkup(project, session)),
        ].join("")
      : "",
  );
}

// 置顶项目行：复用 project-toggle/project-sessions 样式，点击内联展开（展开态独立存 expandedPinnedProjects）
function pinnedProjectMarkup(project, index) {
  if (project.remoteProject) return remoteProjectNodeMarkup(project, index, { pinned: true });
  const pref = projectPrefOf(project);
  const expanded = state.expandedPinnedProjects.has(project.id);
  const items = expanded ? sessionGroupsMarkup(project, visibleTreeSessions(project)) : "";
  return `<div class="project-node pinned-project">
    <div class="project-row">
      <button class="project-toggle" type="button" data-pinned-project="${escapeHtml(project.id)}"
        aria-expanded="${expanded}" aria-controls="pinned-project-sessions-${index}"
        title="${escapeHtml(project.path ?? project.id)}">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <span class="project-name">${escapeHtml(pref.name || project.label)}</span>
        <span class="project-badge">${Number(project.sessionCount) || 0}</span>
      </button>
      <button class="row-action" type="button" data-project-newsession="${escapeHtml(project.id)}"
        title="在此项目下新建会话" aria-label="在「${escapeHtml(pref.name || project.label)}」下新建会话"${project.path ? "" : " disabled"}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MENU_ICONS.rename}" /></svg>
      </button>
      ${menuTriggerMarkup("project", project.id, `打开「${pref.name || project.label}」项目菜单`)}
    </div>
    <ul class="project-sessions" id="pinned-project-sessions-${index}"${expanded ? "" : " hidden"}>
      ${expanded ? (items || `<li class="project-empty">无历史对话</li>`) : ""}
    </ul>
  </div>`;
}

// ===== 体系内输入对话框（替代原生 prompt，语言与 action-dialog 一致）=====
function promptDialog({ eyebrow = "重命名", title, value = "", confirmLabel = "保存", placeholder = "" }) {
  return new Promise((resolveDialog) => {
    const dialog = elements["input-dialog"];
    elements["input-dialog-eyebrow"].textContent = eyebrow;
    elements["input-dialog-title"].textContent = title;
    elements["input-dialog-confirm"].textContent = confirmLabel;
    const input = elements["input-dialog-value"];
    const form = byId("input-dialog-form");
    const cancel = elements["input-dialog-cancel"];
    input.value = value;
    input.placeholder = placeholder;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      form.removeEventListener("submit", onSubmit);
      cancel.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onEscape);
      dialog.close();
      resolveDialog(result);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      finish(input.value.trim());
    };
    const onCancel = () => finish(null);
    const onEscape = (event) => {
      event.preventDefault(); // 关闭统一走 finish，避免 dialog 默认关闭与清理竞争
      finish(null);
    };
    form.addEventListener("submit", onSubmit);
    cancel.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onEscape);
    dialog.showModal();
    input.select();
  });
}

// ===== 右键菜单（项目 / 会话）=====
// 菜单图标：24 viewBox 线性 path，与体系 icon 语言一致（12px 展示尺寸下保持简练）
const MENU_ICONS = {
  pin: "M12 17v5M7 4h10l-1.5 6L19 13v3H5v-3l3.5-3z",
  rename: "M17 3l4 4L8 20l-5 1 1-5z",
  archive: "M4 7h16M6 7l1 13h10l1-13M10 11h4",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  folder: "M3 6h6l2 2h10v11H3z",
  copy: "M9 9h11v11H9zM15 9V4H4v11h5",
  id: "M4 7h16v10H4zM8 11h.01M12 11h4M8 14h8",
  link: "M10 14a4 4 0 0 0 5.6.4l3-3a4 4 0 0 0-5.6-5.6l-1.2 1.2M14 10a4 4 0 0 0-5.6-.4l-3 3a4 4 0 0 0 5.6 5.6l1.2-1.2",
  plus: "M12 5v14M5 12h14",
  branch: "M7 5a2 2 0 1 0 0 .01M7 7v6m0 0a2.5 2.5 0 1 0 .01 0M17 5a2 2 0 1 0 .01 0M17 7c0 5-6 4-9 6",
  window: "M4 5h16v14H4zM4 9h16M8 5v4",
  remove: "M6 6l12 12M18 6L6 18",
  more: "M6 12a2 2 0 1 0 .01 0zM12 12a2 2 0 1 0 .01 0zM18 12a2 2 0 1 0 .01 0z",
  check: "M5 12l4 4L19 6",
};

let contextMenuCleanup = null;
let lastMenuPos = { x: 0, y: 0 }; // 二级菜单（如「从属团队」）在原位重开

function menuTriggerMarkup(kind, id, label) {
  const attribute = kind === "run" ? "data-run-menu" : "data-project-menu";
  // 「…」用填充圆点：stroke 零长段在 12px 下不足 1px 视觉隐形（LO 2026-08-11「图标还是没有显示」）；
  // path 级 fill/stroke 属性压过 .icon 的继承值（fill:none / stroke:currentColor）
  return `<button class="row-action row-menu-action" type="button" ${attribute}="${escapeHtml(id)}"
    data-context-menu-trigger aria-haspopup="menu" aria-expanded="false" aria-controls="context-menu"
    title="更多操作" aria-label="${escapeHtml(label)}">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MENU_ICONS.more}" fill="currentColor" stroke="none" /></svg>
  </button>`;
}

function hideContextMenu(options) {
  contextMenuCleanup?.(options);
}

function showContextMenu(items, x, y, { restoreFocus = document.activeElement } = {}) {
  hideContextMenu({ restoreFocus: false });
  lastMenuPos = { x, y };
  const menu = elements["context-menu"];
  const returnFocus = restoreFocus instanceof HTMLElement ? restoreFocus : null;
  const trigger = returnFocus?.matches("[data-context-menu-trigger]") ? returnFocus : null;
  menu.innerHTML = items
    .map((item, index) =>
      item === "---"
        ? `<div class="menu-separator" role="separator"></div>`
        : `<button type="button" role="menuitem" data-menu-index="${index}"${item.danger ? ' class="is-danger"' : ""}${item.disabled ? " disabled" : ""}>
            <svg class="menu-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MENU_ICONS[item.icon] ?? MENU_ICONS.plus}" /></svg>
            <span>${escapeHtml(item.label)}</span>
          </button>`,
    )
    .join("");
  menu.hidden = false;
  trigger?.setAttribute("aria-expanded", "true");
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  const focusables = () => [...menu.querySelectorAll("[data-menu-index]:not(:disabled)")];
  focusables()[0]?.focus();
  const onPick = (event) => {
    const button = event.target.closest("[data-menu-index]");
    if (!button || button.disabled) return;
    const item = items[Number(button.dataset.menuIndex)];
    hideContextMenu();
    item?.action?.();
  };
  const onDismiss = (event) => {
    if (!menu.contains(event.target)) hideContextMenu();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      hideContextMenu();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const list = focusables();
    if (!list.length) return;
    event.preventDefault();
    const current = list.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? (current + 1) % list.length : (current - 1 + list.length) % list.length;
    list[next].focus();
  };
  const onWindowBlur = () => hideContextMenu({ restoreFocus: false });
  menu.addEventListener("click", onPick);
  document.addEventListener("pointerdown", onDismiss, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("blur", onWindowBlur, { once: true });
  contextMenuCleanup = ({ restoreFocus: shouldRestore = true } = {}) => {
    menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    menu.removeEventListener("click", onPick);
    document.removeEventListener("pointerdown", onDismiss, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("blur", onWindowBlur);
    contextMenuCleanup = null;
    if (shouldRestore && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
}

function showContextMenuFromTrigger(trigger, items) {
  const rect = trigger.getBoundingClientRect();
  showContextMenu(items, rect.left, rect.bottom + 4, { restoreFocus: trigger });
}

async function patchRunMeta(id, patch, message) {
  try {
    const updated = normalizeRun(await request(`/api/runs/${encodeURIComponent(id)}/meta`, { method: "PATCH", body: patch }), 0);
    state.runs = state.runs.map((run) => (run.id === updated.id ? updated : run));
    let tabsChanged = false;
    for (const tab of state.tabs) {
      if (tab.runId !== updated.id || tab.title === updated.title) continue;
      tab.title = updated.title;
      tabsChanged = true;
    }
    if (tabsChanged) {
      persistTabs();
      renderTabs();
    }
    renderRuns();
    if (message) toast(message, "success");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(String(text ?? ""));
    toast(`${label}已复制`, "success");
  } catch (error) {
    toast(`复制失败：${error.message}`, "error");
  }
}

async function revealPath(path) {
  if (!path) return toast("该会话没有记录工作目录", "warning");
  try {
    await request("/api/system/reveal", { method: "POST", body: { path } });
  } catch (error) {
    toast(`打开失败：${error.message}`, "error");
  }
}

function nativeSessionIdOf(run) {
  // "会话ID"取原生 CLI sessionId（可用于 claude --resume 等），优先主脑；无原生会话退回 run id
  const sessions = Array.isArray(run.sessions) ? run.sessions : [];
  const coordinatorId = run.coordinatorId || run.startAgentId || "";
  const coordinator = coordinatorId
    ? sessions.find((session) => (session.agentId ?? session.name) === coordinatorId)
    : null;
  return coordinator?.sessionId ?? sessions[0]?.sessionId ?? run.id;
}

function controlCenterDeepLink(name, value) {
  const url = new URL(location.pathname, location.origin);
  url.hash = new URLSearchParams([[name, String(value)]]).toString();
  return url.href;
}

function openDeepLink(url) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    toast("已阻止打开非同源控制台链接", "error");
    return;
  }
  const opened = window.open("about:blank", "_blank");
  if (!opened) {
    toast("浏览器拦截了新窗口，请允许此站点打开窗口", "warning");
    return;
  }
  try {
    // 深链只含定位参数；登录态显式写入新窗口自己的 sessionStorage，随后切断 opener。
    if (getAccessToken()) opened.sessionStorage.setItem(TOKEN_KEY, getAccessToken());
    opened.opener = null;
    opened.location.replace(target.href);
  } catch (error) {
    try {
      opened.opener = null;
      opened.location.replace(target.href);
    } catch {}
    toast(`新窗口未能继承当前登录态：${error.message}`, "warning", 6000);
  }
}

function runDeepLink(run) {
  return controlCenterDeepLink("run", run.id);
}

function continueRunInNewTask(run) {
  state.selectedRunId = null;
  state.selectionClearedByUser = true;
  state.sessionPreview = null;
  if (run.cwd) state.pendingCwd = run.cwd;
  state.pendingRemote = run.remote ? { ...run.remote } : null; // 远程 run 的新任务沿用其远端位置
  renderRuns();
  elements["task-input"].focus();
  toast(`已切到新任务模式${run.cwd ? `（项目地址 ${run.cwd}）` : run.remote ? `（远程 ${run.remote.hostId} · ${run.remote.path}）` : ""}`, "success");
}

async function continueRunInWorktree(run) {
  if (!run.cwd) return toast("该会话没有记录工作目录，无法建工作树", "warning");
  toast("正在创建工作树…", "info");
  try {
    const result = await request("/api/system/worktree", { method: "POST", body: { path: run.cwd } });
    state.selectedRunId = null;
    state.selectionClearedByUser = true;
    state.sessionPreview = null;
    state.pendingCwd = result.worktree;
    state.pendingRemote = null; // 本地工作树与远程位置互斥
    renderRuns();
    elements["task-input"].focus();
    toast(`工作树已创建，新任务将在 ${result.worktree} 运行`, "success", 6000);
  } catch (error) {
    toast(error.message, "error", 6000);
  }
}

async function renameRun(run) {
  const next = await promptDialog({ eyebrow: "会话", title: "重命名任务", value: run.title });
  if (next === null || !next) return;
  void patchRunMeta(run.id, { title: next }, "已重命名");
}

function runContextItems(run) {
  return [
    { icon: "pin", label: run.pinned ? "取消置顶" : "置顶任务", action: () => void patchRunMeta(run.id, { pinned: !run.pinned }) },
    { icon: "rename", label: "重命名任务", action: () => void renameRun(run) },
    run.archived
      ? { icon: "archive", label: "取消归档", action: () => void patchRunMeta(run.id, { archived: false }, "已从归档取出") }
      : { icon: "archive", label: "归档任务", action: () => void patchRunMeta(run.id, { archived: true }, "已归档（数据保留，仅从列表隐藏）") },
    { icon: "eye", label: run.unread ? "标记为已读" : "标记为未读", action: () => void patchRunMeta(run.id, { unread: !run.unread }) },
    "---",
    { icon: "folder", label: "在资源管理器中打开", disabled: !run.cwd, action: () => void revealPath(run.cwd) },
    { icon: "copy", label: "复制工作目录", disabled: !run.cwd, action: () => void copyText(run.cwd, "工作目录") },
    { icon: "id", label: "复制会话ID", action: () => void copyText(nativeSessionIdOf(run), "会话ID") },
    { icon: "link", label: "复制深度链接", action: () => void copyText(runDeepLink(run), "深度链接") },
    "---",
    { icon: "plus", label: "在新任务中继续", action: () => continueRunInNewTask(run) },
    { icon: "branch", label: "在新工作树中继续", disabled: !run.cwd, action: () => void continueRunInWorktree(run) },
    { icon: "window", label: "在新窗口中打开", action: () => openDeepLink(runDeepLink(run)) },
  ];
}

// Codex 恢复 ID：rollout 文件名里的线程 uuid（codex resume 用 uuid 不用文件名）
function nativeResumeId(sessionId, cli) {
  if (cli !== "codex") return sessionId;
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(sessionId);
  return match ? match[1] : sessionId;
}

// 项目树下的原生 CLI 历史会话菜单（数据来自各 CLI 本地存储扫描，与 Console run 是两类实体）
// 项集对齐 run 菜单（Codex 式）：置顶/重命名/归档/未读走会话级偏好（project-prefs.json sessions 映射）
function sessionContextItems(project, sessionId, cli = "claude", scope = "") {
  const pref = sessionPrefOf(cli, project.id, sessionId);
  const session = (project.sessions ?? []).find((item) => item.id === sessionId && (item.cli ?? "claude") === cli);
  return [
    { icon: "eye", label: "查看会话", action: () => void openSessionPreview(project.id, sessionId, cli, scope) },
    { icon: "pin", label: pref.pinned ? "取消置顶" : "置顶任务", action: () => void updateSessionPref(cli, project.id, sessionId, { pinned: !pref.pinned }) },
    {
      icon: "branch",
      label: `从属团队：${teamById(effectiveSessionTeamId(project, session ?? { id: sessionId, cli }))?.name ?? "跟随项目"}`,
      action: () => {
        showContextMenu(
          teamPickContextItems(effectiveSessionTeamId(project, session ?? { id: sessionId, cli }), (teamId) => updateSessionPref(cli, project.id, sessionId, { teamId })),
          lastMenuPos.x,
          lastMenuPos.y,
        );
      },
    },
    {
      icon: "rename",
      label: "重命名任务",
      action: async () => {
        const next = await promptDialog({ eyebrow: "历史会话", title: "重命名任务（仅影响侧栏显示）", value: pref.alias || (session ? sessionDisplayTitle(session) : "") });
        if (next === null || !next) return;
        void updateSessionPref(cli, project.id, sessionId, { alias: next });
      },
    },
    pref.archived
      ? { icon: "archive", label: "取消归档", action: () => void updateSessionPref(cli, project.id, sessionId, { archived: false }) }
      : { icon: "archive", label: "归档任务", action: () => void updateSessionPref(cli, project.id, sessionId, { archived: true }) },
    { icon: "eye", label: pref.unread ? "标记为已读" : "标记为未读", action: () => void updateSessionPref(cli, project.id, sessionId, { unread: !pref.unread }) },
    "---",
    {
      icon: "folder",
      label: "在资源管理器中打开",
      action: async () => {
        try {
          await request("/api/sessions/reveal", { method: "POST", body: { source: cli, project: project.id, scope, id: sessionId } });
        } catch (error) {
          toast(`定位失败：${error.message}`, "error");
        }
      },
    },
    { icon: "copy", label: "复制工作目录", disabled: !project.path, action: () => void copyText(project.path, "工作目录") },
    { icon: "id", label: "复制会话ID", action: () => void copyText(nativeResumeId(sessionId, cli), "会话ID") },
    {
      icon: "copy",
      label: "复制恢复命令",
      action: () => void copyText(cli === "codex" ? `codex resume ${nativeResumeId(sessionId, cli)}` : `claude -r ${sessionId}`, "恢复命令"),
    },
    { icon: "link", label: "复制深度链接", action: () => void copyText(sessionDeepLink(cli, project.id, sessionId), "深度链接") },
    "---",
    {
      icon: "plus",
      label: "在新任务中继续",
      disabled: !project.path,
      action: () => {
        state.selectedRunId = null;
        state.selectionClearedByUser = true;
        state.sessionPreview = null;
        state.pendingCwd = project.path;
        state.pendingRemote = null; // 本地项目与远程位置互斥
        renderRuns();
        elements["task-input"].focus();
        toast(`已切到新任务模式（项目地址 ${project.path}）`, "success");
      },
    },
    {
      icon: "branch",
      label: "在新工作树中继续",
      disabled: !project.path,
      action: () => void continueRunInWorktree({ cwd: project.path }),
    },
    { icon: "window", label: "在新窗口中打开", action: () => openDeepLink(sessionDeepLink(cli, project.id, sessionId)) },
  ];
}

// ===== v3.7 Automations（codeg 对标）：composer 快照的保存/列表/触发/启停 =====
async function loadAutomations() {
  try {
    const payload = await request("/api/automations");
    state.automations = Array.isArray(payload?.automations) ? payload.automations : [];
    state.automationStatus = payload?.status ?? {
      state: "ready",
      writable: true,
      failClosed: false,
      code: null,
      message: null,
    };
    renderAutomations();
    return payload;
  } catch (error) {
    // 保留最后一次成功读取的列表作为只读快照。连接失败时清空并隐藏会让用户误以为
    // 自动化被删除；显式冻结写入口才符合存储层的 fail-closed 契约。
    state.automationStatus = {
      state: "unavailable",
      writable: false,
      failClosed: true,
      code: error?.payload?.error?.code ?? "AUTOMATION_API_UNAVAILABLE",
      message: error?.message ?? "无法读取自动化状态",
    };
    renderAutomations();
    throw error;
  }
}

function scheduleLabel(schedule) {
  const match = /^every:(\d+)([mhd])$/.exec(String(schedule ?? ""));
  if (!match) return "手动";
  return `每 ${match[1]}${{ m: " 分钟", h: " 小时", d: " 天" }[match[2]]}`;
}

function automationStatusCopy(status = {}) {
  // 状态请求失败不能证明本地存储的精确故障。优先呈现控制面不可达并冻结最后一次成功快照，
  // 不把失败响应携带的诊断码误报成已确认的本地文件状态。
  if (status.state === "unavailable") {
    return ["自动化状态不可用", "现有数据保持只读，请恢复控制面连接后重试。"];
  }
  if (status.code === "AUTOMATION_STORE_CORRUPT") {
    return ["自动化已暂停", "存储文件损坏，原文件已保留。修复文件后重启控制面。"];
  }
  if (status.code === "AUTOMATION_STORE_UNREADABLE") {
    return ["自动化已暂停", "存储文件不可读，原路径已保留。检查权限后重启控制面。"];
  }
  return ["自动化已暂停", "存储当前不可写；现有数据不会被修改。"];
}

function automationsWritable() {
  return state.automationStatus?.writable === true;
}

function renderAutomations() {
  const rail = elements["rail-automations"];
  if (!rail) return;
  const items = state.automations;
  const status = state.automationStatus ?? {};
  const blocked = status.failClosed === true || ["degraded", "unavailable"].includes(status.state);
  const writable = automationsWritable();
  rail.hidden = !items.length && !blocked;
  elements["automations-count"].textContent = blocked ? `${items.length} · 暂停` : String(items.length);
  const saveButton = elements["save-automation-button"];
  if (saveButton) {
    saveButton.disabled = !writable;
    saveButton.title = writable
      ? "把当前 composer 全配置（任务/团队/直接目标/权限/模型/地址）存为可定时执行的自动化"
      : "自动化存储不可写";
  }
  const [statusTitle, statusDetail] = automationStatusCopy(status);
  const statusMarkup = blocked
    ? `<div class="automation-store-alert" role="alert"><strong>${escapeHtml(statusTitle)}</strong><span>${escapeHtml(statusDetail)}</span>${status.code ? `<code>${escapeHtml(status.code)}</code>` : ""}</div>`
    : "";
  const itemMarkup = items
    .map((item) => `
      <div class="automation-row${item.enabled ? "" : " is-disabled"}${writable ? "" : " is-readonly"}">
        <button class="automation-main" type="button" data-automation-open="${escapeHtml(item.id)}"
          title="${escapeHtml(item.prompt.slice(0, 300))}${item.lastError ? `\n上次失败：${escapeHtml(item.lastError)}` : ""}">
          <strong>${item.lastError ? `<span class="automation-error-dot" aria-label="上次触发失败"></span>` : ""}${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(scheduleLabel(item.schedule))}${item.enabled ? "" : " · 已停用"} · ${item.permissionMode || "plan"} · ${item.lastRunId ? `上次 ${formatDate(item.lastRunAt)}` : "未运行"}</span>
        </button>
        <span class="automation-actions">
          <button class="rail-action" type="button" data-automation-edit="${escapeHtml(item.id)}" title="编辑/历史" aria-label="编辑 ${escapeHtml(item.name)}">
            ${lucideIcon("settings")}
          </button>
          <button class="rail-action" type="button" data-automation-run="${escapeHtml(item.id)}" title="立即执行" aria-label="立即执行 ${escapeHtml(item.name)}"${writable ? "" : " disabled"}>
            <svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </button>
          <button class="rail-action" type="button" data-automation-toggle="${escapeHtml(item.id)}" title="${item.enabled ? "停用" : "启用"}" aria-label="${item.enabled ? "停用" : "启用"} ${escapeHtml(item.name)}"${writable ? "" : " disabled"}>
            <svg class="icon" viewBox="0 0 24 24">${item.enabled ? '<path d="M10 9v6m4-6v6" />' : '<path d="M8 5v14l11-7z" opacity="0.4" />'}</svg>
          </button>
          <button class="rail-action" type="button" data-automation-remove="${escapeHtml(item.id)}" title="删除" aria-label="删除 ${escapeHtml(item.name)}"${writable ? "" : " disabled"}>
            <svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
          </button>
        </span>
      </div>`)
    .join("");
  commitMarkup(elements["automations-list"], `${statusMarkup}${itemMarkup}`);
}

// 「存为自动化」：当前 composer 全配置快照 → 名称 + 计划两问 → 落库
async function saveAutomationFromComposer() {
  if (!automationsWritable()) return toast("自动化存储当前不可写；现有数据保持不变", "error");
  const prompt = elements["task-input"].value.trim();
  if (!prompt) return toast("先在输入框写好任务内容，再存为自动化", "warning");
  const composer = captureComposerConfig();
  const name = await promptDialog({ eyebrow: "自动化", title: "命名这个自动化", placeholder: "如：每日体系体检", confirmLabel: "下一步" });
  if (!name) return;
  const schedule = await promptDialog({
    eyebrow: "自动化",
    title: "执行计划（manual = 仅手动；every:30m / every:6h / every:1d = 定时）",
    value: "manual",
    confirmLabel: "保存",
  });
  if (schedule === null) return;
  try {
    await request("/api/automations", {
      method: "POST",
      body: {
        name,
        prompt,
        sources: state.attachments.length ? [...state.attachments] : undefined,
        schedule: schedule.trim() || "manual",
        teamId: composer.target.teamId,
        startAgentId: composer.target.memberId || undefined,
        requestedAgentIds: composer.requestedAgentIds.length ? [...composer.requestedAgentIds] : undefined,
        permissionMode: composer.permissionMode,
        model: composer.model,
        effort: composer.effort,
        cwd: composer.cwd,
      },
    });
    toast(`自动化「${name}」已保存`, "success");
    await loadAutomations();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function triggerAutomation(id) {
  if (!automationsWritable()) return toast("自动化已暂停，无法执行", "error");
  try {
    const run = await request(`/api/automations/${encodeURIComponent(id)}/run`, { method: "POST", body: {} });
    toast("自动化已触发", "success");
    await Promise.all([loadAutomations(), loadRuns()]);
    if (run?.id) selectRun(run.id);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function toggleAutomation(id) {
  if (!automationsWritable()) return toast("自动化已暂停，无法修改", "error");
  const item = state.automations.find((entry) => entry.id === id);
  if (!item) return;
  try {
    await request(`/api/automations/${encodeURIComponent(id)}`, { method: "PATCH", body: { enabled: !item.enabled } });
    await loadAutomations();
  } catch (error) {
    toast(error.message, "error");
  }
}

async function removeAutomation(id) {
  if (!automationsWritable()) return toast("自动化已暂停，无法删除", "error");
  const item = state.automations.find((entry) => entry.id === id);
  if (!item) return;
  const confirmed = await confirmAction({
    eyebrow: "自动化",
    title: `删除自动化「${item.name}」？`,
    rows: [["计划", scheduleLabel(item.schedule)], ["任务", item.prompt.slice(0, 120)]],
    confirmLabel: "删除",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await request(`/api/automations/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast("自动化已删除", "success");
    await loadAutomations();
  } catch (error) {
    toast(error.message, "error");
  }
}

function openAutomationLastRun(id) {
  const item = state.automations.find((entry) => entry.id === id);
  if (item?.lastRunId && state.runs.some((run) => run.id === item.lastRunId)) return selectRun(item.lastRunId);
  toast(item?.lastRunId ? "上次运行已被清除" : "该自动化还没有运行记录", "info");
}

function fillAutomationManager(selectedId = null) {
  const select = byId("automation-edit-select");
  const name = byId("automation-edit-name");
  const schedule = byId("automation-edit-schedule");
  const permission = byId("automation-edit-permission");
  const prompt = byId("automation-edit-prompt");
  const history = byId("automation-history-list");
  if (!select || !name || !schedule || !permission || !prompt || !history) return;
  const items = state.automations;
  select.innerHTML = items.length
    ? items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("")
    : `<option value="">（暂无自动化）</option>`;
  const id = selectedId && items.some((item) => item.id === selectedId)
    ? selectedId
    : (select.value || items[0]?.id || "");
  if (id) select.value = id;
  const item = items.find((entry) => entry.id === id);
  name.disabled = !item || !automationsWritable();
  schedule.disabled = !item || !automationsWritable();
  permission.disabled = !item || !automationsWritable();
  prompt.disabled = !item || !automationsWritable();
  byId("automation-save-button").disabled = !item || !automationsWritable();
  byId("automation-run-now-button").disabled = !item || !automationsWritable();
  byId("automation-cancel-run-button").disabled = !item || !automationsWritable();
  if (!item) {
    name.value = "";
    schedule.value = "manual";
    permission.value = "plan";
    prompt.value = "";
    history.innerHTML = `<div class="empty-state compact-empty"><span>暂无运行历史</span></div>`;
    return;
  }
  name.value = item.name || "";
  schedule.value = item.schedule || "manual";
  permission.value = ["build", "review"].includes(item.permissionMode) ? item.permissionMode : "plan";
  prompt.value = item.prompt || "";
  const rows = Array.isArray(item.runHistory) ? item.runHistory : [];
  history.innerHTML = rows.length
    ? rows.map((row) => `
        <button class="automation-history-row" type="button" data-automation-history-run="${escapeHtml(row.runId)}"
          title="打开运行 ${escapeHtml(row.runId)}">
          <strong>${escapeHtml(row.source || "manual")} · ${escapeHtml(row.status || "?")}</strong>
          <span>${escapeHtml(formatDate(row.at))} · ${escapeHtml(String(row.runId).slice(0, 8))}</span>
        </button>`).join("")
    : item.lastRunId
      ? `<button class="automation-history-row" type="button" data-automation-history-run="${escapeHtml(item.lastRunId)}">
          <strong>上次运行</strong><span>${escapeHtml(formatDate(item.lastRunAt))} · ${escapeHtml(String(item.lastRunId).slice(0, 8))}</span>
        </button>`
      : `<div class="empty-state compact-empty"><span>尚未运行</span></div>`;
}

function openAutomationManager(selectedId = null) {
  fillAutomationManager(selectedId);
  const dialog = byId("automation-dialog");
  if (!dialog) return;
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

function closeAutomationManager() {
  const dialog = byId("automation-dialog");
  if (dialog?.open) dialog.close();
}

async function saveAutomationEdits(event) {
  event?.preventDefault?.();
  if (!automationsWritable()) return toast("自动化已暂停，无法保存", "error");
  const id = byId("automation-edit-select")?.value;
  if (!id) return toast("请先选择自动化", "warning");
  try {
    await request(`/api/automations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: {
        name: byId("automation-edit-name").value.trim(),
        schedule: byId("automation-edit-schedule").value.trim() || "manual",
        permissionMode: byId("automation-edit-permission").value,
        prompt: byId("automation-edit-prompt").value.trim(),
      },
    });
    toast("自动化已更新", "success");
    await loadAutomations();
    fillAutomationManager(id);
  } catch (error) {
    toast(error.message, "error");
  }
}

async function cancelAutomationRun(id) {
  if (!automationsWritable()) return toast("自动化已暂停，无法取消", "error");
  try {
    await request(`/api/automations/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
    toast("已请求取消当前运行", "success");
    await Promise.all([loadAutomations(), loadRuns()]);
    fillAutomationManager(id);
  } catch (error) {
    toast(error.message, "error");
  }
}

// ── 斜杠命令：运行控制来自当前成员的 Adapter catalog；这里只保留控制台本地命令。 ──
const LOCAL_SLASH_COMMANDS = Object.freeze([
  { id: "new", label: "/new", detail: "新建任务输入模式", apply: () => {
    state.selectedRunId = null;
    state.selectionClearedByUser = true;
    state.activeTabKey = null;
    persistTabs();
    renderTabs();
    renderSelectedRun();
  } },
  { id: "team", label: "/team", detail: "打开团队工作区", apply: () => {
    const team = teamById(state.selectedTeamId) || state.teams.find((item) => item.builtin);
    if (team) void openTeamWorkspace(team);
  } },
  { id: "auto", label: "/auto", detail: "打开自动化管理", apply: () => openAutomationManager() },
  { id: "commands", label: "/commands", detail: "打开命令面板", apply: () => openForgePalette() },
]);

function applyRuntimeSlashControl(command) {
  const controlIds = {
    model: "task-model",
    effort: "task-effort",
    permission: "task-permission",
  };
  const select = elements[controlIds[command.control]];
  if (!select) return;
  const value = String(command.value ?? "");
  if (![...select.options].some((option) => option.value === value)) {
    throw new Error(`${command.label} 不在当前成员的可执行目录中`);
  }
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function fallbackRuntimeSlashCommands() {
  const commands = [];
  const addSelectCommands = (control, token, select, pick) => {
    if (!select || pick?.hidden) return;
    for (const option of select.options) {
      const value = option.value;
      const labelValue = value || "default";
      commands.push({
        id: `${control}:${labelValue}`,
        label: `/${token} ${labelValue}`,
        detail: `${option.textContent || labelValue} · 当前席位目录`,
        control,
        value,
        apply() { applyRuntimeSlashControl(this); },
      });
    }
  };
  addSelectCommands("model", "model", elements["task-model"], elements["task-model-pick"]);
  addSelectCommands("effort", "effort", elements["task-effort"], elements["task-effort-pick"]);
  if (!elements["task-permission-pick"]?.hidden) {
    for (const option of elements["task-permission"]?.options || []) {
      commands.push({
        id: `permission:${option.value}`,
        label: `/${option.value}`,
        detail: option.textContent || option.value,
        control: "permission",
        value: option.value,
        apply() { applyRuntimeSlashControl(this); },
      });
    }
  }
  return commands;
}

function slashCommandsForContext() {
  const continuing = Boolean(selectedRun() && !state.sessionPreview);
  if (continuing) return [...LOCAL_SLASH_COMMANDS];
  const agentId = activeComposerTarget().memberId || "";
  const catalog = state.agentControlCatalog;
  const runtimeCommands = catalog?.context?.memberId === agentId && Array.isArray(catalog.commands)
    ? catalog.commands.map((command) => ({
      ...command,
      apply() { applyRuntimeSlashControl(this); },
    }))
    : fallbackRuntimeSlashCommands();
  return [...runtimeCommands, ...LOCAL_SLASH_COMMANDS];
}

function hideSlashMenu() {
  const menu = byId("slash-menu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  state.slashActive = false;
  state.slashIndex = -1;
  state.slashCandidates = [];
  state.slashRange = null;
  elements["task-input"]?.setAttribute("aria-expanded", "false");
  elements["task-input"]?.removeAttribute("aria-activedescendant");
}

function slashQueryAtCursor(textarea) {
  if (!textarea) return null;
  const value = textarea.value;
  const caret = textarea.selectionStart ?? value.length;
  const before = value.slice(0, caret);
  const match = before.match(/(^|[\s\n])\/([A-Za-z0-9_-]*(?:[ \t]+[A-Za-z0-9._:/-]*)?)$/);
  if (!match) return null;
  return {
    start: caret - match[2].length - 1,
    end: caret,
    query: match[2].toLowerCase().replace(/[ \t]+/g, " "),
  };
}

function syncSlashActiveOption() {
  const menu = byId("slash-menu");
  const textarea = elements["task-input"];
  if (!menu || !textarea) return;
  menu.querySelectorAll(".slash-item").forEach((element, index) => {
    const active = index === state.slashIndex;
    element.classList.toggle("is-active", active);
    element.setAttribute("aria-selected", String(active));
    if (active) {
      textarea.setAttribute("aria-activedescendant", element.id);
      element.scrollIntoView({ block: "nearest" });
    }
  });
}

function renderSlashMenu() {
  const menu = byId("slash-menu");
  const textarea = elements["task-input"];
  if (!menu || !textarea) return;
  if (state.mentionActive) {
    hideSlashMenu();
    return;
  }
  const hit = slashQueryAtCursor(textarea);
  if (!hit) {
    hideSlashMenu();
    return;
  }
  const candidates = slashCommandsForContext().filter((item) => {
    if (!hit.query) return true;
    const normalizedLabel = item.label.slice(1).toLowerCase().replace(/[ \t]+/g, " ");
    return hit.query.includes(" ")
      ? normalizedLabel.startsWith(hit.query)
      : `${normalizedLabel} ${item.detail} ${item.id}`.toLowerCase().includes(hit.query);
  });
  if (!candidates.length) {
    hideSlashMenu();
    return;
  }
  state.slashActive = true;
  state.slashCandidates = candidates;
  state.slashIndex = 0;
  state.slashRange = hit;
  menu.hidden = false;
  menu.innerHTML = candidates.map((item, index) => `
    <button class="slash-item${index === 0 ? " is-active" : ""}" id="slash-option-${index}" type="button" role="option" aria-selected="${index === 0}" data-slash-id="${escapeHtml(item.id)}">
      <strong>${escapeHtml(item.label)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </button>`).join("");
  textarea.setAttribute("aria-expanded", "true");
  textarea.setAttribute("aria-activedescendant", "slash-option-0");
}

function applySlashCommand(id) {
  const command = state.slashCandidates.find((item) => item.id === id);
  const textarea = elements["task-input"];
  const range = state.slashRange;
  if (!command || !textarea || !range) return;
  const before = textarea.value.slice(0, range.start);
  const after = textarea.value.slice(range.end);
  textarea.value = `${before}${after}`.replace(/^\s+/, (s) => s); // keep leading if any
  // 去掉命令 token，不把 /plan 留在 prompt 里
  const caret = before.length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  hideSlashMenu();
  try {
    command.apply();
    toast(`已应用 ${command.label}`, "success", 1800);
  } catch (error) {
    toast(error.message, "error");
  }
  textarea.focus({ preventScroll: true });
}

// ===== 项目侧栏偏好（置顶/重命名/隐藏）=====
function projectPrefsFromPayload(payload) {
  const revision = Number(payload?.revision);
  return payload?.projects
    ? {
        revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
        projects: payload.projects,
        sessions: payload?.sessions ?? {},
      }
    : { revision: 0, projects: {}, sessions: {} };
}

function projectPrefsSnapshot(source = state.projectPrefs) {
  // 快照必须与后续乐观修改隔离；structuredClone 避免 JSON 往返的额外文本副本。
  const value = { projects: source?.projects ?? {}, sessions: source?.sessions ?? {} };
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function cloneProjectPrefs(source) {
  return { revision: source.revision, ...projectPrefsSnapshot(source) };
}

function projectPrefValueEqual(left, right) {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

// CAS 冲突后只重放 base -> desired 的字段级本地意图。完整旧文档绝不能直接覆盖
// 最新权威状态：远端不同 key/field 保留，同一字段才由本地最终意图覆盖。
function diffProjectPrefs(base, desired) {
  const changes = [];
  for (const collection of ["projects", "sessions"]) {
    const before = base?.[collection] ?? {};
    const after = desired?.[collection] ?? {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!Object.hasOwn(after, key)) {
        changes.push({ collection, key, removeEntry: true });
        continue;
      }
      const beforeEntry = Object.hasOwn(before, key) && before[key] && typeof before[key] === "object" ? before[key] : {};
      const afterEntry = after[key] && typeof after[key] === "object" ? after[key] : {};
      for (const field of new Set([...Object.keys(beforeEntry), ...Object.keys(afterEntry)])) {
        if (!Object.hasOwn(afterEntry, field)) changes.push({ collection, key, field, removeField: true });
        else if (!Object.hasOwn(beforeEntry, field) || !projectPrefValueEqual(beforeEntry[field], afterEntry[field])) {
          changes.push({ collection, key, field, value: afterEntry[field] });
        }
      }
    }
  }
  return changes;
}

function applyProjectPrefsChanges(base, changes) {
  const next = projectPrefsSnapshot(base);
  for (const change of changes) {
    const collection = next[change.collection];
    if (change.removeEntry) {
      delete collection[change.key];
      continue;
    }
    const entry = collection[change.key] && typeof collection[change.key] === "object"
      ? { ...collection[change.key] }
      : {};
    if (change.removeField) delete entry[change.field];
    else entry[change.field] = change.value;
    collection[change.key] = entry;
  }
  return next;
}

let projectPrefsAuthoritative = { revision: 0, projects: {}, sessions: {} };

function setProjectPrefsAuthoritative(payload, { adopt = false } = {}) {
  projectPrefsAuthoritative = cloneProjectPrefs(projectPrefsFromPayload(payload));
  if (adopt) state.projectPrefs = cloneProjectPrefs(projectPrefsAuthoritative);
  return projectPrefsAuthoritative;
}

function rebaseProjectPrefsOperation(operation, base) {
  const changes = diffProjectPrefs(operation.baseSnapshot, operation.desired);
  operation.baseSnapshot = projectPrefsSnapshot(base);
  operation.desired = applyProjectPrefsChanges(operation.baseSnapshot, changes);
  return operation.desired;
}

function mergeProjectPrefsOperations(...operations) {
  const queued = operations.filter(Boolean);
  const baseSnapshot = projectPrefsSnapshot(projectPrefsAuthoritative);
  let desired = projectPrefsSnapshot(baseSnapshot);
  for (const operation of queued) {
    desired = applyProjectPrefsChanges(desired, diffProjectPrefs(operation.baseSnapshot, operation.desired));
  }
  return {
    baseSnapshot,
    desired,
    revision: Math.max(0, ...queued.map((operation) => operation.revision ?? 0)),
    waiters: queued.flatMap((operation) => operation.waiters ?? []),
  };
}

let projectPrefsLoadPromise = null;
async function loadProjectPrefs({ notify = true } = {}) {
  if (state.projectPrefsStatus === "ready") return true;
  if (projectPrefsLoadPromise) return projectPrefsLoadPromise;
  state.projectPrefsStatus = "loading";
  projectPrefsLoadPromise = (async () => {
    try {
      const authoritative = setProjectPrefsAuthoritative(await request("/api/projects/prefs"));
      if (projectPrefsPendingSave) {
        const optimistic = rebaseProjectPrefsOperation(projectPrefsPendingSave, authoritative);
        state.projectPrefs = { revision: authoritative.revision, ...optimistic };
      } else {
        state.projectPrefs = cloneProjectPrefs(authoritative);
      }
      state.projectPrefsStatus = "ready";
      state.projectPrefsError = null;
      renderProjects();
      renderStatusline();
      if (projectPrefsPendingSave) queueMicrotask(() => void drainProjectPrefsSaves());
      return true;
    } catch (error) {
      // 保留内存中的最后可信快照；首次失败也绝不伪装成“已加载的空库”。
      state.projectPrefsStatus = "error";
      state.projectPrefsError = error.message;
      renderStatusline();
      if (notify) toast(`项目偏好加载失败，写入已锁定：${error.message}`, "error", 6000);
      return false;
    } finally {
      projectPrefsLoadPromise = null;
    }
  })();
  return projectPrefsLoadPromise;
}

async function ensureProjectPrefsWritable() {
  if (state.projectPrefsStatus === "ready") return true;
  const ready = await loadProjectPrefs(); // error 状态允许用户动作触发真实重试
  if (!ready) {
    toast(
      projectPrefsPendingSave
        ? "项目偏好仍处于写锁；已保留的本地修改会等待重试，本次新修改尚未应用"
        : "项目偏好尚未成功读取，本次修改未写入",
      "warning",
      5000,
    );
  }
  return ready;
}

let projectPrefsSaveRevision = 0;
let projectPrefsSaveActive = false;
let projectPrefsPendingSave = null; // 一个 in-flight + 一个 latest；中间快照合并

function saveProjectPrefs() {
  if (state.projectPrefsStatus !== "ready") return Promise.resolve(false);
  const desired = projectPrefsSnapshot();
  const revision = ++projectPrefsSaveRevision;
  const result = new Promise((resolveSave) => {
    if (projectPrefsPendingSave) {
      projectPrefsPendingSave.desired = desired;
      projectPrefsPendingSave.revision = revision;
      projectPrefsPendingSave.waiters.push(resolveSave);
    } else {
      projectPrefsPendingSave = {
        baseSnapshot: projectPrefsSnapshot(projectPrefsAuthoritative),
        desired,
        revision,
        waiters: [resolveSave],
      };
    }
  });
  queueMicrotask(() => void drainProjectPrefsSaves());
  return result;
}

async function drainProjectPrefsSaves() {
  if (projectPrefsSaveActive || state.projectPrefsStatus !== "ready") return;
  projectPrefsSaveActive = true;
  try {
    while (projectPrefsPendingSave) {
      const operation = projectPrefsPendingSave;
      projectPrefsPendingSave = null;
      let saved = false;
      let stop = false;
      let deferred = false;
      let conflictRetries = 0;
      while (!saved && !stop) {
        try {
          // 每次发送都以最后权威 revision 为基线，并将局部本地意图重放到该基线。
          // 前一轮 PUT 或跨标签页 GET 推进 revision 后，排队操作不会复用陈旧整份快照。
          const desired = rebaseProjectPrefsOperation(operation, projectPrefsAuthoritative);
          const authoritative = setProjectPrefsAuthoritative(await request("/api/projects/prefs", {
            method: "PUT",
            body: { baseRevision: projectPrefsAuthoritative.revision, ...desired },
          }));
          if (projectPrefsPendingSave) {
            const optimistic = rebaseProjectPrefsOperation(projectPrefsPendingSave, authoritative);
            state.projectPrefs = { revision: authoritative.revision, ...optimistic };
          } else {
            state.projectPrefs = cloneProjectPrefs(authoritative);
          }
          renderProjects();
          saved = true;
        } catch (error) {
          const conflict = error.status === 409 && error.payload?.error?.code === "PREFS_REVISION_MISMATCH";
          if (conflict && conflictRetries < 3) {
            conflictRetries += 1;
            toast("项目偏好已被其它页面更新，正在合并本地修改", "warning", 5000);
            try {
              const authoritative = setProjectPrefsAuthoritative(await request("/api/projects/prefs"));
              state.projectPrefsStatus = "ready";
              state.projectPrefsError = null;
              const currentDesired = rebaseProjectPrefsOperation(operation, authoritative);
              const optimistic = projectPrefsPendingSave
                ? rebaseProjectPrefsOperation(projectPrefsPendingSave, currentDesired)
                : currentDesired;
              state.projectPrefs = { revision: authoritative.revision, ...optimistic };
              renderProjects();
              continue;
            } catch (refreshError) {
              projectPrefsPendingSave = mergeProjectPrefsOperations(operation, projectPrefsPendingSave);
              state.projectPrefs = {
                revision: projectPrefsAuthoritative.revision,
                ...projectPrefsSnapshot(projectPrefsPendingSave.desired),
              };
              state.projectPrefsStatus = "error";
              state.projectPrefsError = refreshError.message;
              deferred = true;
              renderProjects();
              renderStatusline();
              toast(`项目偏好权威回读失败；本地修改已保留，写入已锁定：${refreshError.message}`, "error", 7000);
              stop = true;
              continue;
            }
          }
          toast(
            conflict ? "项目偏好连续发生版本冲突，本次修改未保存" : `项目偏好保存失败：${error.message}`,
            "error",
          );
          try {
            setProjectPrefsAuthoritative(await request("/api/projects/prefs"), { adopt: true });
            state.projectPrefsStatus = "ready";
            state.projectPrefsError = null;
            renderProjects();
          } catch (refreshError) {
            projectPrefsPendingSave = mergeProjectPrefsOperations(operation, projectPrefsPendingSave);
            state.projectPrefs = {
              revision: projectPrefsAuthoritative.revision,
              ...projectPrefsSnapshot(projectPrefsPendingSave.desired),
            };
            state.projectPrefsStatus = "error";
            state.projectPrefsError = refreshError.message;
            deferred = true;
            renderProjects();
            renderStatusline();
            toast(`项目偏好权威回读失败；本地修改已保留，写入已锁定：${refreshError.message}`, "error", 7000);
          }
          stop = true;
        }
      }
      if (!deferred) for (const settle of operation.waiters) settle(saved);
      if (stop && projectPrefsPendingSave && !deferred) {
        for (const settle of projectPrefsPendingSave.waiters) settle(false);
        projectPrefsPendingSave = null;
      }
      if (stop) break;
    }
  } finally {
    projectPrefsSaveActive = false;
    // finally 与新调用可能同一微任务交错；若又有 latest，确保泵继续。
    if (projectPrefsPendingSave && state.projectPrefsStatus === "ready") queueMicrotask(() => void drainProjectPrefsSaves());
  }
}

function projectPrefOf(project) {
  return state.projectPrefs.projects[normalizePathKey(project.path ?? project.id)] ?? {};
}

async function updateProjectPref(project, patch) {
  if (!(await ensureProjectPrefsWritable())) return false;
  const key = normalizePathKey(project.path ?? project.id);
  const current = state.projectPrefs.projects[key] ?? {};
  const nextPref = { ...current, ...patch };
  // hidden/pinned 是最终态不变量，而非仅隐藏动作的副作用：隐藏项目即使从旧数据
  // 迁移而来、或随后被其它偏好更新，也不能重新进入置顶集合。
  if (nextPref.hidden) nextPref.pinned = false;
  state.projectPrefs.projects[key] = nextPref;
  // 乐观项目的「移除」= 退出 pending（刚选定又不要了；hidden 语义留给真实项目）
  if (patch.hidden === true && project.pending) {
    state.pendingProjects = state.pendingProjects.filter((item) => normalizePathKey(item.path) !== key);
    persistPendingProjects();
  }
  renderProjects();
  return saveProjectPrefs();
}

// 乐观项目持久化（LO 报障：刷新后 pending 项目消失——改 localStorage，刷新/重启浏览器不丢）；
// 扫描列表出现同路径真项目时 renderProjects 自动让位并同步清出持久层
const PENDING_PROJECTS_KEY = "514cc-pending-projects";

function persistPendingProjects() {
  try {
    localStorage.setItem(PENDING_PROJECTS_KEY, JSON.stringify(state.pendingProjects));
  } catch {
    // 写失败退化为内存态
  }
}

function restorePendingProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(PENDING_PROJECTS_KEY) ?? "[]");
    state.pendingProjects = (Array.isArray(saved) ? saved : []).filter((item) => item?.path && item?.id);
  } catch {
    state.pendingProjects = [];
  }
}

// 项目查找统一入口：乐观项目 + 扫描列表（右键菜单/从属菜单等曾只搜扫描列表——pending 项目无菜单）
function findProjectById(id) {
  return state.pendingProjects.find((project) => project.id === id)
    ?? (state.projectsData?.projects ?? []).find((item) => item.id === id)
    ?? remoteTreeNodes().find((item) => item.id === id)
    ?? null;
}

// ===== 原生历史会话偏好（置顶/归档/未读/别名/团队）：与项目偏好同文件，键 = cli::projectId::sessionId =====
function sessionPrefOf(cli, projectId, sessionId) {
  const sessions = state.projectPrefs.sessions ?? {};
  // 读取兼容旧两段键（projectId::sessionId，多 CLI 波次前的格式）——写入永远三段
  return sessions[`${cli}::${projectId}::${sessionId}`] ?? sessions[`${projectId}::${sessionId}`] ?? {};
}

async function updateSessionPref(cli, projectId, sessionId, patch) {
  if (!(await ensureProjectPrefsWritable())) return false;
  const key = `${cli}::${projectId}::${sessionId}`;
  state.projectPrefs.sessions = {
    ...(state.projectPrefs.sessions ?? {}),
    [key]: { ...sessionPrefOf(cli, projectId, sessionId), ...patch },
  };
  renderProjects(); // 内部连带重渲置顶/已归档区
  return saveProjectPrefs();
}

function sessionDeepLink(cli, projectId, sessionId) {
  return controlCenterDeepLink("session", `${cli}::${projectId}::${sessionId}`);
}

function projectDeepLink(project) {
  return controlCenterDeepLink("project", project.id);
}

// 「从属团队」二级菜单：原位列出可选团队（当前项打勾）
function teamPickContextItems(currentTeamId, onPick) {
  return state.teams.map((team) => ({
    icon: "branch",
    label: `${team.id === currentTeamId ? "* " : ""}${team.name}${team.builtin ? "（默认）" : ""}`,
    action: () => void onPick(team.id),
  }));
}

function projectContextItems(project) {
  const pref = projectPrefOf(project);
  // 远程项目：本地动作（资源管理器/归档/删会话文件）天然无意义，给精简如实菜单
  if (project.remoteProject) {
    const remote = project.remote;
    return [
      { icon: "pin", label: pref.pinned ? "取消置顶" : "置顶项目", action: () => void updateProjectPref(project, { pinned: !pref.pinned }) },
      {
        icon: "branch",
        label: `从属团队：${teamById(effectiveProjectTeamId(project))?.name ?? "默认团队"}`,
        action: () => {
          showContextMenu(
            teamPickContextItems(effectiveProjectTeamId(project), (teamId) => updateProjectPref(project, { teamId })),
            lastMenuPos.x,
            lastMenuPos.y,
          );
        },
      },
      { icon: "window", label: "打开 SSH 终端", disabled: remote.hostMissing || !remote.enabled, action: () => void openRemoteTerminalForProject(project) },
      {
        icon: "folder",
        label: "浏览文件（SFTP）",
        disabled: remote.hostMissing || !remote.enabled,
        action: () => {
          // v41 波三：直达远程主机视图并预填主机+路径，由 hosts-panel 监听快显事件接管
          setView("hosts");
          window.dispatchEvent(new CustomEvent("forge:hosts-open-sftp", { detail: { hostId: remote.hostId, path: remote.path } }));
        },
      },
      {
        icon: "rename",
        label: "重命名项目",
        action: async () => {
          const next = await promptDialog({ eyebrow: "项目侧栏", title: "重命名项目（仅影响侧栏显示）", value: pref.name || project.label });
          if (next === null) return;
          void updateProjectPref(project, { name: next });
        },
      },
      "---",
      {
        icon: "remove",
        label: "移除远程项目",
        danger: true,
        action: async () => {
          const verdict = await confirmAction({
            eyebrow: "项目侧栏",
            title: `移除远程项目「${pref.name || project.label}」？`,
            rows: [["主机", `${remote.hostName}${remote.addr ? `（${remote.addr}）` : ""}`], ["路径", remote.path]],
            warning: "仅从台账移除登记，不动远程主机上的任何文件。",
            confirmLabel: "移除",
            danger: true,
          });
          if (!verdict) return; // confirmAction 无 checkbox 时 resolve 布尔（波四修复：原 verdict.confirmed 恒 undefined，移除永不执行）
          try {
            await request(`/api/remote-projects/${encodeURIComponent(project.remoteId)}`, { method: "DELETE" });
            await loadProjects();
            toast("已移除远程项目", "success");
          } catch (error) {
            toast(`移除失败:${error.message}`, "error");
          }
        },
      },
    ];
  }
  return [
    { icon: "pin", label: pref.pinned ? "取消置顶" : "置顶项目", action: () => void updateProjectPref(project, { pinned: !pref.pinned }) },
    {
      icon: "branch",
      label: `从属团队：${teamById(effectiveProjectTeamId(project))?.name ?? "默认团队"}`,
      action: () => {
        showContextMenu(
          teamPickContextItems(effectiveProjectTeamId(project), (teamId) => updateProjectPref(project, { teamId })),
          lastMenuPos.x,
          lastMenuPos.y,
        );
      },
    },
    { icon: "folder", label: "在资源管理器中打开", disabled: !project.path, action: () => void revealPath(project.path) },
    { icon: "link", label: "复制深度链接", action: () => void copyText(projectDeepLink(project), "深度链接") },
    { icon: "window", label: "在新窗口中打开", action: () => openDeepLink(projectDeepLink(project)) },
    {
      icon: "rename",
      label: "重命名项目",
      action: async () => {
        const next = await promptDialog({ eyebrow: "项目侧栏", title: "重命名项目（仅影响侧栏显示）", value: pref.name || project.label });
        if (next === null) return;
        void updateProjectPref(project, { name: next });
      },
    },
    ...(pref.hidden
      ? [{ icon: "check", label: "取消隐藏（恢复到侧栏）", action: () => void updateProjectPref(project, { hidden: false, pinned: false }) }]
      : []),
    {
      icon: "archive",
      label: "归档任务",
      disabled: !project.path,
      action: async () => {
        try {
          const result = await request("/api/projects/archive-finished", { method: "POST", body: { cwd: project.path } });
          await loadRuns();
          toast(result.archived ? `已归档 ${result.archived} 个已结束任务` : "该项目没有可归档的已结束任务", "success");
        } catch (error) {
          toast(error.message, "error");
        }
      },
    },
    "---",
    {
      icon: "remove",
      label: "移除",
      danger: true,
      action: async () => {
        const verdict = await confirmAction({
          eyebrow: "项目侧栏",
          title: `从侧栏移除「${pref.name || project.label}」？`,
          rows: [["路径", project.path ?? project.id]],
          warning: "默认仅从侧栏隐藏，不动磁盘上的任何文件。",
          checkbox: { label: "同时删除磁盘上的会话文件（移入隔离区，可恢复）", checked: false },
          confirmLabel: "移除",
          danger: true,
        });
        if (!verdict.confirmed) return;
        if (verdict.checked) {
          try {
            const result = await request("/api/projects/delete-sessions", { method: "POST", body: { project: project.id, path: project.path } });
            const statuses = Array.isArray(result.sources) ? result.sources : [];
            const labels = { claude: "Claude", codex: "Codex", cursor: "Cursor", kimi: "Kimi", pi: "Pi" };
            const removed = statuses
              .filter((status) => Number(status?.removed) > 0)
              .map((status) => `${labels[status.source] ?? status.source} ${status.removed} 个`);
            const unsupported = statuses
              .filter((status) => status?.supported === false)
              .map((status) => labels[status.source] ?? status.source);
            const limited = statuses
              .filter((status) => status?.supported !== false && status?.limited)
              .map((status) => labels[status.source] ?? status.source);
            const messages = [];
            messages.push(removed.length ? `已隔离 ${removed.join("、")}` : "Claude/Codex 未发现可隔离会话");
            if (unsupported.length) messages.push(`${unsupported.join("、")} 暂不支持项目级会话删除`);
            if (limited.length) messages.push(`${limited.join("、")} 扫描或隔离不完整，剩余数量未知`);
            if (result.trash && removed.length) messages.push(`隔离区：${result.trash}`);
            toast(messages.join("；"), unsupported.length || limited.length ? "warning" : removed.length ? "success" : "warning", 12_000);
          } catch (error) {
            toast(`删除会话文件失败：${error.message}`, "error", 6000);
          }
        }
        void updateProjectPref(project, { hidden: true });
        void loadProjects(); // 文件可能已消失，重新扫描保持树一致
      },
    },
  ];
}

const PROJECT_SUMMARIES_KEY = "514cc-project-summaries";
const SHOW_SUBAGENTS_KEY = "514cc-show-subagents";
const RECENT_ONLY_KEY = "514cc-recent-only";
const SHOW_HIDDEN_KEY = "514cc-show-hidden";
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 「近期」= 近 30 天

const FINISHED_RUN_STATES = new Set(["succeeded", "failed", "cancelled"]); // 与后端 orchestrator TERMINAL 同口径

// ===== 团队：会话级能力配比预设（内置 514cc 冻结，自定义可增改删） =====
const TEAM_KEY = "514cc-selected-team";
const COMPOSER_CLI_OPEN_KEY = "514cc-composer-cli-open-v2";
const BUILTIN_TEAM_ID = "team-514cc";

function currentTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? state.teams[0] ?? null;
}

let teamsLoadPromise = null;
let teamsQueuedFreshPromise = null;
let teamsFreshRequested = false;
let teamsLoadEpoch = 0;
let teamFormDirty = false;
let teamFormBusy = false;
let teamFormInitialized = false;
let teamFormRevision = 0;

function teamCatalogSignature(catalog = state.bootstrap?.teamCatalog) {
  if (!Array.isArray(catalog)) return "";
  return JSON.stringify(catalog.map((item) => [
    item.id,
    item.label,
    item.shortLabel,
    item.role,
    item.provider,
    item.runtimeProfileId,
    item.enabled,
    item.teamMemberEligible,
    item.coordinatorEligible,
    item.eligibilityReason,
  ]));
}

function reconcileTeamFormCatalog(previousSignature) {
  const nextSignature = teamCatalogSignature();
  if (previousSignature === nextSignature || !teamFormInitialized || !elements["team-form"]) return;
  if (teamFormDirty || teamFormBusy) {
    const list = elements["team-members-list"];
    if (!teamFormBusy && nextSignature && list) {
      const members = new Set([...list.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value));
      const activeCoordinator = list.querySelector('input[name="team-coordinator"]:checked')?.value
        || elements["team-form"].dataset.coordinator
        || "";
      renderTeamMemberOptions(teamById(state.editingTeamId), {
        members,
        activeCoordinator,
        readOnly: Boolean(teamById(state.editingTeamId)?.builtin),
      });
    }
    toast("团队成员目录已更新；当前未保存草稿已保留，保存前请复核成员与主脑", "warning", 7000);
    return;
  }
  fillTeamForm(state.editingTeamId ? teamById(state.editingTeamId) : null);
}

function startTeamsLoad() {
  const epoch = ++teamsLoadEpoch;
  let requestPromise;
  requestPromise = (async () => {
    try {
      const payload = await request(API.teams);
      // 写操作要求 fresh 时，写前启动的 GET 即使晚到也不能回滚界面。
      if (epoch !== teamsLoadEpoch) return successfulLoadResult(payload, { stale: true });
      state.teams = payload.teams ?? [];
      state.teamStoreStatus = payload.storeStatus ?? null;
      if (payload.rejectedOnLoad?.length) {
        // 拒载必须可见——团队不能静默消失（烛 R12 建议）
        toast(`${payload.rejectedOnLoad.length} 个团队配置校验失败被拒载：${payload.rejectedOnLoad[0].reason}`, "warning", 8000);
      }
      if (payload.storeStatus?.failClosed) {
        toast(payload.storeStatus.message || "团队存储不可验证；团队写入和成员换绑/删除已冻结", "error", 8000);
      }
      // 只有成功响应确认所选团队不存在才回退——瞬时网络错误不清空、不改选择（烛 R10 建议）
      if (!state.teams.some((team) => team.id === state.selectedTeamId)) {
        state.selectedTeamId = BUILTIN_TEAM_ID;
        localStorage.setItem(TEAM_KEY, state.selectedTeamId);
      }
      renderTeams();
      refreshTeamData();
      renderTeamActivation();
      if (elements["team-switch-select"]) {
        const editing = teamById(state.editingTeamId);
        if (state.editingTeamId && !editing) {
          if (teamFormDirty && !teamFormBusy) {
            state.editingTeamId = null;
            teamFormRevision += 1;
            elements["team-form-title"].textContent = "新建团队 · 原团队已不存在";
            elements["team-builtin-note"].hidden = true;
            elements["team-delete-button"].hidden = true;
            elements["team-save-label"].textContent = "保存";
            for (const field of ["team-name-input", "team-description-input", "team-prompt-input"]) elements[field].disabled = false;
            for (const app of PROVIDER_APPS) elements[`team-provider-${app}`].disabled = false;
            renderTeamSwitcher(null);
            updateTeamFormStatus();
            renderTeamActivation();
            toast("正在编辑的团队已被外部删除；当前草稿已保留为新团队", "warning", 6000);
          } else {
            state.editingTeamId = null;
            if (state.view === "team") fillTeamForm(currentTeam());
            else renderTeamSwitcher(null);
          }
        } else if (editing && teamFormInitialized && !teamFormDirty && !teamFormBusy) {
          // clean 表单跟随服务端新快照；dirty/busy 表单必须保留当前 DOM。
          fillTeamForm(editing);
        } else {
          renderTeamSwitcher(editing);
        }
      }
      missionControlDock?.refreshIdle?.();
      return successfulLoadResult(payload);
    } catch (error) {
      if (epoch !== teamsLoadEpoch) return successfulLoadResult(null, { stale: true });
      toast(`团队加载失败：${error.message}`, "error");
      if (!state.teams.length) {
        const tree = elements["workbench-project-tree"];
        if (tree) tree.innerHTML = emptyMarkup("团队加载失败", "点击刷新重试");
      }
      return failedLoadResult(error); // 保留旧列表与选择
    }
  })().finally(() => {
    if (teamsLoadPromise === requestPromise) teamsLoadPromise = null;
  });
  teamsLoadPromise = requestPromise;
  return requestPromise;
}

function loadTeams({ fresh = false } = {}) {
  // 已有 fresh 队列时，普通调用也等待最终快照，不能提前拿到被失效的中间结果。
  if (teamsQueuedFreshPromise) {
    if (fresh) {
      teamsFreshRequested = true;
      if (teamsLoadPromise) teamsLoadEpoch += 1;
    }
    return teamsQueuedFreshPromise;
  }
  if (!teamsLoadPromise) return startTeamsLoad();
  if (!fresh) return teamsLoadPromise;

  teamsFreshRequested = true;
  teamsLoadEpoch += 1;
  const activeLoad = teamsLoadPromise;
  let queuedPromise;
  queuedPromise = (async () => {
    try {
      let result = await activeLoad;
      // fresh 在新请求进行中再次到达时继续补发，直到最后一次写之后的快照落盘。
      while (teamsFreshRequested) {
        teamsFreshRequested = false;
        result = await startTeamsLoad();
      }
      return result;
    } finally {
      // 必须在 queued promise 结算前清空；最终 GET 的 then() 里再次 fresh 才会启动新请求。
      if (teamsQueuedFreshPromise === queuedPromise) teamsQueuedFreshPromise = null;
    }
  })();
  teamsQueuedFreshPromise = queuedPromise;
  return teamsQueuedFreshPromise;
}

// ===== 团队层级树：团队 → 从属项目 → 会话 =====
function defaultTeamId() {
  return state.teams.find((team) => team.builtin)?.id ?? BUILTIN_TEAM_ID;
}

function teamById(id) {
  return state.teams.find((team) => team.id === id) ?? null;
}

// 显式从属：只有右键手动归属过、且目标团队仍存在时才返回 team id，否则 null=未归属。
// LO 2026-08-10 严格归属制：团队树下只挂显式归属的项目；未归属的进「未归属」虚拟组
// 兜底可见（保留 08-08 "项目不能整片消失"的底线，但不再在所有团队混显）。
function explicitProjectTeamId(project) {
  const pref = projectPrefOf(project);
  return pref.teamId && teamById(pref.teamId) ? pref.teamId : null;
}

// 项目从属：显式归属优先，未归属回落默认团队（会话从属比较、右键菜单当前值等仍需要一个具体 id）
function effectiveProjectTeamId(project) {
  return explicitProjectTeamId(project) ?? defaultTeamId();
}

// 会话从属：会话级 teamId 优先，缺省跟随项目
function effectiveSessionTeamId(project, session) {
  const pref = sessionPrefOf(session.cli ?? "claude", project.id, session.id);
  return pref.teamId && teamById(pref.teamId) ? pref.teamId : effectiveProjectTeamId(project);
}

// 侧栏工作区团队（LO 2026-08-04：侧栏=团队工作区，只显示选中团队，不混显其他团队）；
// 选中团队缺失（未加载/已删除）时回退内置/首个团队，teams 空时落到默认团队 id
function railTeamId() {
  return (teamById(state.selectedTeamId) ?? state.teams.find((team) => team.builtin) ?? state.teams[0])?.id ?? defaultTeamId();
}

function runInRailTeam(run) {
  return (run?.teamId || defaultTeamId()) === railTeamId();
}

function renderTeams() {
  // 团队呈现已并入团队树；composer 的直接收件人由目标标签唯一决定。
  const select = elements["composer-team"];
  if (select) {
    select.innerHTML = state.teams
      .map((team) => `<option value="${escapeHtml(team.id)}"${team.id === state.selectedTeamId ? " selected" : ""}>${escapeHtml(team.name)}</option>`)
      .join("");
  }
  const startSelect = elements["start-agent"];
  if (startSelect) {
    const team = state.teams.find((item) => item.id === state.selectedTeamId) ?? state.teams.find((item) => item.builtin);
    const members = team?.members ?? [];
    const coordinator = team?.coordinator ?? members[0] ?? "";
    const previous = startSelect.value;
    startSelect.innerHTML = members
      .map((member) => `<option value="${escapeHtml(member)}"${member === (members.includes(previous) ? previous : coordinator) ? " selected" : ""}>${escapeHtml(agentLabel(member))}${member === coordinator ? "（leader）" : ""}</option>`)
      .join("");
  }
  renderProjects();
  renderRuns(); // 侧栏按团队隔离后，团队任何变化都要联动会话/正在工作/置顶区
  renderStatusline();
  renderMemberStrip();
  syncModelPick(); // 团队/目标成员变化后，CLI 专属控制目录同步
}

// 选项渲染（尽量保留当前选中；不在目录内则回落首项=默认）
function renderPickOptions(select, options, currentValue) {
  select.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.id)}"${option.id === currentValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
}

let modelPickEpoch = 0;

function composerControlKey(memberId, runtimeProfileId = null) {
  const member = String(memberId || "").trim();
  if (!member) return "";
  return `${member}::${String(runtimeProfileId || member).trim()}`;
}

function nativePermissionToComposer(value) {
  return {
    plan: "plan",
    "read-only": "review",
    "workspace-write": "build",
    "workspace-write:on-failure": "auto",
    "danger-full-access": "full-access",
    "config-default": "config",
  }[value] || "plan";
}

function supportedControlValue(options, preferred, fallback = "") {
  const values = (options || []).map((option) => String(option?.id ?? option?.value ?? ""));
  const requested = String(preferred ?? "");
  if (values.includes(requested)) return requested;
  const safeFallback = String(fallback ?? "");
  if (values.includes(safeFallback)) return safeFallback;
  return values[0] ?? "";
}

function composerDraftFor(memberId, { runtimeProfileId, profile, template } = {}) {
  const key = composerControlKey(memberId, runtimeProfileId);
  const stored = key ? state.composerControlDrafts.get(key) : null;
  if (stored) return { key, draft: { ...stored } };
  const draft = {
    model: "",
    effort: "",
    permission: nativePermissionToComposer(profile?.defaultPermissionMode || template?.defaultPermissionMode || "read-only"),
  };
  if (key) state.composerControlDrafts.set(key, draft);
  return { key, draft: { ...draft } };
}

function rememberComposerControlDraft(target = activeComposerTarget()) {
  if (target?.run || !target?.memberId) return;
  const { runtimeProfileId } = staticControlContext(target.memberId);
  const key = composerControlKey(target.memberId, runtimeProfileId);
  if (!key) return;
  state.composerControlDrafts.set(key, {
    model: elements["task-model"]?.value || "",
    effort: elements["task-effort"]?.value || "",
    permission: elements["task-permission"]?.value || "plan",
  });
}

function composerCliContextState(context = {}) {
  const key = composerControlKey(context.memberId, context.runtimeProfileId);
  return {
    key,
    value: (key && state.composerCliActionStates.get(key)) || { busy: false, result: null, epoch: 0 },
  };
}

function beginComposerCliOperation(context) {
  const { key, value } = composerCliContextState(context);
  if (!key || value.busy) return null;
  const next = { ...value, busy: true, epoch: Number(value.epoch || 0) + 1 };
  state.composerCliActionStates.set(key, next);
  return { key, epoch: next.epoch };
}

function finishComposerCliOperation(operation, patch = {}) {
  if (!operation?.key) return false;
  const current = state.composerCliActionStates.get(operation.key);
  if (!current || current.epoch !== operation.epoch) return false;
  state.composerCliActionStates.set(operation.key, { ...current, ...patch, busy: false });
  return true;
}

function activeComposerTarget() {
  const run = selectedRun() && !state.sessionPreview ? selectedRun() : null;
  const teamId = run?.teamId || state.selectedTeamId || defaultTeamId();
  const team = teamById(teamId) ?? teamById(state.selectedTeamId) ?? state.teams.find((item) => item.builtin) ?? state.teams[0] ?? null;
  const members = (run && Array.isArray(run.teamMembers) && run.teamMembers.length
    ? run.teamMembers
    : team?.members || []).filter(Boolean);
  const coordinatorId = run?.coordinatorId || team?.coordinator || members[0] || null;
  const preferredAgentId = run ? activeAgentId() : state.composerTargetAgentId;
  const defaultMemberId = run ? defaultRunRecipient(run) : coordinatorId;
  const memberId = preferredAgentId && members.includes(preferredAgentId)
    ? preferredAgentId
    : members.includes(defaultMemberId) ? defaultMemberId : coordinatorId;
  const mode = memberId ? "member" : "none";
  return { mode, memberId, coordinatorId, members, teamId, team, run };
}

function syncSideChatTarget(target = activeComposerTarget()) {
  const title = byId("mission-side-chat-title");
  const input = byId("mission-side-chat-input");
  const submit = byId("mission-side-chat-form")?.querySelector('button[type="submit"]');
  const name = target.memberId ? agentLabel(target.memberId) : "未配置直接收件人";
  if (title) title.textContent = name;
  if (input) {
    input.placeholder = target.memberId ? `直接发送给 ${name}` : "当前团队没有可执行成员";
    input.disabled = !target.memberId;
  }
  if (submit) {
    submit.disabled = !target.memberId;
    submit.title = target.memberId ? `发送给 ${name}` : "当前没有可用收件人";
    submit.setAttribute("aria-label", submit.title);
  }
}

function syncLegacyComposerTarget(target = activeComposerTarget()) {
  const memberId = target.memberId || "";
  for (const id of ["start-agent", "followup-agent"]) {
    const select = elements[id];
    if (!select || !memberId) continue;
    if (![...select.options].some((option) => option.value === memberId)) {
      select.add(new Option(agentLabel(memberId), memberId));
    }
    select.value = memberId;
  }
}

function syncComposerTargetUi(target = activeComposerTarget()) {
  syncLegacyComposerTarget(target);
  const shell = byId("composer-shell");
  const name = byId("composer-target-name");
  const logo = byId("composer-target-logo");
  const cliBadge = byId("composer-target-cli");
  const route = byId("composer-target-route");
  const sessionControls = byId("composer-session-controls");
  const memberName = target.memberId ? agentLabel(target.memberId) : "未配置主脑";
  const cli = target.memberId ? agentCli(target.memberId) : null;
  const { template } = staticControlContext(target.memberId);
  const cliName = template?.label || (cli ? `${cli[0].toUpperCase()}${cli.slice(1)} CLI` : "CLI 未配置");
  if (shell) {
    shell.dataset.targetMode = target.mode;
    shell.dataset.targetAgent = target.memberId || "";
  }
  if (name) name.textContent = memberName;
  if (logo) logo.innerHTML = cli ? cliIconMarkup(cli, "cli-logo") : lucideIcon("terminal", "icon lucide");
  if (cliBadge) cliBadge.textContent = cliName;
  const waitingAnswer = Boolean(target.run?.pendingAsk);
  const answeringAsk = waitingAnswer && target.run.pendingAsk.from === target.memberId;
  if (route) route.textContent = answeringAsk ? "回答该成员" : "直接收件人";
  if (sessionControls) {
    sessionControls.hidden = !target.run;
    sessionControls.querySelector("span").textContent = `沿用 ${memberName} 会话配置`;
  }
  if (elements["submit-task-button"]) {
    const action = answeringAsk ? `回答 ${memberName}` : `发送给 ${memberName}`;
    elements["submit-task-button"].title = action;
    elements["submit-task-button"].setAttribute("aria-label", action);
  }
  const input = elements["task-input"];
  if (input) {
    const steering = Boolean(target.run) && !waitingAnswer && ACTIVE_RUN_STATES.has(target.run.status);
    const askerName = waitingAnswer ? agentLabel(target.run.pendingAsk.from) : "";
    input.placeholder = answeringAsk
      ? `回答 ${askerName}：${String(target.run.pendingAsk.text || "").slice(0, 80)}`
      : waitingAnswer
        ? `${askerName} 正等待回答；当前消息将排队发送给 ${memberName}`
      : steering
        ? `会话进行中——发送给 ${memberName} 的消息将在当前轮结束后送达`
        : target.run
          ? `直接发送给 ${memberName}：补充要求、质疑证据或继续执行`
          : `直接交给 ${memberName} 执行`;
  }
  syncSideChatTarget(target);
}

function runPermissionOptions(permissionModes = []) {
  const rows = [];
  const add = (id, label) => {
    if (!rows.some((row) => row.id === id)) rows.push({ id, label });
  };
  // Codex 官方权限档：adapter 声明 danger-full-access（预设族标记位）时，
  // 用与 Codex 桌面批准菜单同款的四档替换 514cc 自造档位。
  if (permissionModes.includes("danger-full-access")) {
    if (permissionModes.includes("workspace-write")) add("ask", "请求批准");
    if (permissionModes.includes("workspace-write:on-failure")) add("auto", "帮我批准");
    add("full-access", "完全访问权限");
    if (permissionModes.includes("config-default")) add("config", "自定义 (config.toml)");
    if (rows.length) return rows;
  }
  if (permissionModes.includes("plan")) add("plan", "Plan · 只读规划");
  if (permissionModes.includes("read-only")) add("review", "Review · 只读深审");
  if (permissionModes.includes("workspace-write")) add("build", "Build · 写盘审批");
  return rows.length ? rows : [{ id: "plan", label: "Plan · 只读规划" }];
}

// 权限 pill（Codex 桌面式选择器）：`<select id="task-permission">` 仍是唯一状态源，
// pill/menu 只是它的镜像。文案如实对应 permissions.json 的 modes——不虚构后端没有的能力档。
const PERMISSION_MODE_META = {
  plan: { short: "只读规划", title: "Plan · 只读规划", desc: "不写入、不执行命令、不联网——只产出计划与方案", icon: "book-open" },
  review: { short: "只读深审", title: "Review · 只读深审", desc: "允许只读 shell 排查证据，不落盘任何修改", icon: "scan-search" },
  build: { short: "写盘审批", title: "Build · 写盘审批", desc: "隔离工作区写盘，写动作逐个审批后才执行", icon: "hammer" },
  // Codex 官方权限档：文案与 Codex 桌面批准菜单逐字对齐，不夸大不缩水
  ask: { short: "请求批准", title: "请求批准", desc: "编辑外部文件和使用互联网时始终询问", icon: "shield-check" },
  auto: { short: "帮我批准", title: "帮我批准", desc: "仅对检测到的风险操作请求批准", icon: "zap" },
  "full-access": { short: "完全访问", title: "完全访问权限", desc: "可不受限制地访问互联网和您电脑上的任何文件", icon: "triangle-alert" },
  config: { short: "自定义", title: "自定义 (config.toml)", desc: "使用 config.toml 中定义的权限", icon: "settings" },
};

function permissionModeMeta(id, fallbackLabel = "") {
  return PERMISSION_MODE_META[id] || { short: fallbackLabel || id, title: fallbackLabel || id, desc: "", icon: "shield" };
}

function syncPermissionPill() {
  const select = elements["task-permission"];
  const pill = elements["permission-pill"];
  const menu = elements["permission-menu"];
  if (!select || !pill || !menu) return;
  const options = [...select.options].map((option) => ({ id: option.value, label: option.textContent.trim() }));
  const current = permissionModeMeta(select.value, options.find((option) => option.id === select.value)?.label);
  if (elements["permission-pill-label"]) elements["permission-pill-label"].textContent = current.short;
  pill.disabled = select.disabled;
  menu.innerHTML = options.map((option) => {
    const meta = permissionModeMeta(option.id, option.label);
    const active = option.id === select.value;
    return `
      <button type="button" class="permission-menu-row${active ? " is-active" : ""}" role="menuitemradio" aria-checked="${active}" data-permission-option="${escapeHtml(option.id)}">
        <span class="permission-menu-icon" aria-hidden="true">${lucideIcon(meta.icon, "icon lucide")}</span>
        <span class="permission-menu-copy">
          <strong>${escapeHtml(meta.title)}</strong>
          ${meta.desc ? `<span>${escapeHtml(meta.desc)}</span>` : ""}
        </span>
        <span class="permission-menu-check" aria-hidden="true">${active ? lucideIcon("check", "icon lucide") : ""}</span>
      </button>`;
  }).join("");
}

function setPermissionMenuOpen(open) {
  const pill = elements["permission-pill"];
  const menu = elements["permission-menu"];
  if (!pill || !menu) return;
  menu.hidden = !open;
  pill.setAttribute("aria-expanded", String(open));
}

// 会话中权限热改白名单——与 orchestrator PERMISSION_HOT_TRANSITIONS 严格同表：
// 只放开机制上每轮可改、治理上安全的迁移（降档写面收缩 / Codex ask↔auto 同 sandbox）。
const PERMISSION_HOT_TRANSITIONS = Object.freeze({
  plan: [],
  review: ["plan"],
  build: ["review", "plan"],
  ask: ["auto"],
  auto: ["ask"],
  "full-access": [],
  config: [],
});

// 续聊时权限 picker 的选项 = 当前档 + 可热迁移档（其余档要求新建任务，不列出来骗人）
function continuingPermissionOptions(currentMode) {
  const current = PERMISSION_MODE_META[currentMode] ? currentMode : "plan";
  return [current, ...(PERMISSION_HOT_TRANSITIONS[current] || [])]
    .map((id) => ({ id, label: permissionModeMeta(id).title }));
}

// 续聊中改模型/Effort/权限 = run 级热改（PATCH /controls），下一轮生效；失败回滚 select 显示
async function applyRunControlChange(controlId, value) {
  const run = selectedRun();
  if (!run) return;
  // 恢复条未确认：热改与续聊同闸——先点「确认恢复并继续」，本地直接拦下不说英文黑话
  if (run.status === "recovery_required" && state.recoveryAckRunId !== run.id) {
    toast("热改被拒绝：上一轮原生会话提交状态不明，请先点恢复条上的「确认恢复并继续」", "error", 4200);
    await syncModelPick(); // 回滚 select 到 run 的真实档位
    return;
  }
  const patch = controlId === "task-model"
    ? { model: value }
    : controlId === "task-effort"
      ? { effort: value }
      : { permissionMode: value };
  // 恢复条已确认但未发送：确认标记随本次热改一次性消费，服务端原子完成"放弃 claim + 改档"
  if (run.status === "recovery_required") patch.acknowledgeRecovery = true;
  try {
    const updated = normalizeRun(await request(`/api/runs/${encodeURIComponent(run.id)}/controls`, { method: "PATCH", body: patch }), 0);
    state.runs = state.runs.map((entry) => (entry.id === updated.id ? updated : entry));
    if (patch.acknowledgeRecovery) state.recoveryAckRunId = null; // 确认标记一次性消费（与发送链路同语义）
    const what = controlId === "task-model"
      ? `模型已切换为 ${value || "席位默认"}`
      : controlId === "task-effort"
        ? `Effort 已调整为 ${value || "CLI 默认"}`
        : `权限已切换为 ${permissionModeMeta(value, value).short}`;
    toast(`${patch.acknowledgeRecovery ? "恢复已确认·" : ""}${what}，下一轮生效`, "success", 2400);
    renderSelectedRun();
  } catch (error) {
    toast(`热改被拒绝：${error.message}`, "error", 3600);
    await syncModelPick(); // 回滚 select 到 run 的真实档位
  }
}

function syncComposerControlVisibility() {
  const continuing = Boolean(selectedRun() && !state.sessionPreview);
  const controls = state.agentControlCatalog?.controls;
  const { template } = staticControlContext(activeComposerTarget().memberId);
  const modelUnsupported = controls
    ? controls.model?.supported === false
    : template?.modelMode === "none";
  const effortUnsupported = controls
    ? controls.effort?.supported !== true
    : template?.effortMode === "none";
  if (elements["task-model-pick"]) {
    // 模型每轮可改：Codex turn/start 接受 per-turn model（0.146.0 实测），spawn 型 argv 本就每轮带
    elements["task-model-pick"].hidden = modelUnsupported;
  }
  if (elements["task-effort-pick"]) {
    // Effort 两种 Adapter 都是每轮参数（codex turn/start / spawn argv）——续聊也可热调
    elements["task-effort-pick"].hidden = effortUnsupported;
  }
  // 权限续聊可见：白名单迁移（降档 + Codex ask↔auto）由后端校验，选项随当前档收窄
  if (elements["task-permission-pick"]) elements["task-permission-pick"].hidden = false;
  if (byId("composer-session-controls")) byId("composer-session-controls").hidden = !continuing;
}

function staticControlContext(agentId) {
  const member = (state.memberCatalog || []).find((item) => item.id === agentId);
  const runtimeProfileId = member?.runtimeProfileId || agentId;
  const profile = (state.bootstrap?.providers ?? []).find((item) => item.id === runtimeProfileId) || null;
  const templates = state.bootstrap?.adapterTemplates || state.adapterTemplatesData?.templates || [];
  const template = templates.find((item) => item.id === profile?.adapter) || null;
  return { member, runtimeProfileId, profile, template };
}

function composerCliCatalog() {
  const agentId = activeComposerTarget().memberId || "";
  const loaded = state.agentControlCatalog;
  if (loaded?.context?.memberId === agentId) return loaded;
  const { runtimeProfileId, profile, template } = staticControlContext(agentId);
  const modelOptions = (profile?.modelOptions || []).filter((option) => option?.id);
  const effortLevels = template?.effortMode === "none"
    ? []
    : [...new Set([...(profile?.effortLevels || []), ...(template?.effortLevels || [])])];
  const providerApp = template?.providerApp || null;
  const actions = [
    {
      id: "refresh-catalog", label: "刷新能力目录", detail: "重新读取当前 CLI 的模型与推理档位。",
      execution: "server-catalog-refresh", risk: "read-only",
    },
    ...(template?.diagnosticActions || []).map((action) => ({ ...action, execution: "allowlisted-cli" })),
    { id: "open-seat-config", label: "编辑席位完整配置", execution: "frontend-seat-editor", risk: "configuration-write" },
    { id: "open-connection", label: providerApp ? "编辑 Provider 连接" : "查看 CLI 认证归属", execution: "frontend-connection-editor", risk: providerApp ? "credential-configuration" : "read-only" },
  ];
  return {
    version: 2,
    context: {
      memberId: agentId,
      runtimeProfileId,
      runtimeProfileLabel: profile?.label || runtimeProfileId,
      adapterId: template?.id || profile?.adapter || "",
      adapterLabel: template?.label || profile?.adapter || "CLI",
      transport: template?.transport || "unknown",
      providerApp,
      providerId: profile?.providerId || null,
      providerBindingMode: template?.providerBindingMode || "unknown",
      selectable: template?.selectable !== false,
      enabled: profile?.enabled !== false,
    },
    source: "fallback",
    models: modelOptions,
    effortLevels,
    controls: {
      command: { supported: template?.commandMode !== "none", value: profile?.command || template?.defaultCommand || null, help: template?.commandHelp || "" },
      model: { supported: template?.modelMode !== "none", options: modelOptions.map((option) => ({ value: option.id, label: option.label })) },
      effort: { supported: template?.effortMode !== "none", options: effortLevels.map((value) => ({ value, label: value })) },
      permission: { supported: true, options: (template?.permissionModes || ["read-only"]).map((value) => ({ value, label: value })) },
      cwd: { mode: template?.cwdMode || "process-fixed" },
    },
    defaults: {
      model: profile?.model || null,
      effort: profile?.defaultEffort || null,
      permission: profile?.defaultPermissionMode || template?.defaultPermissionMode || "read-only",
      quickEditable: template?.selectable !== false,
    },
    connection: {
      mode: template?.providerBindingMode || "unknown",
      providerApp,
      providerId: profile?.providerId || null,
    },
    commands: fallbackRuntimeSlashCommands(),
    actions,
    notes: [...(template?.controlNotes || [])],
  };
}

function composerCliPermissionLabel(value) {
  return {
    plan: "Plan · 只读规划",
    "read-only": "Review · 只读深审",
    "workspace-write": "Build · 写盘审批",
  }[value] || value;
}

function renderComposerCliSelect(select, options, currentValue, emptyLabel, { includeEmpty = true } = {}) {
  if (!select) return;
  const normalized = includeEmpty ? [{ id: "", label: emptyLabel }] : [];
  for (const option of options || []) {
    const id = String(option?.value ?? option?.id ?? "");
    if (!id || normalized.some((entry) => entry.id === id)) continue;
    normalized.push({ id, label: String(option?.label || id) });
  }
  if (currentValue && !normalized.some((entry) => entry.id === currentValue)) {
    normalized.push({ id: currentValue, label: `${currentValue}（当前）` });
  }
  renderPickOptions(select, normalized, currentValue || "");
}

function setComposerCliTab(tab, { focus = false } = {}) {
  const consoleRoot = elements["composer-cli-console"];
  if (!consoleRoot) return;
  const next = ["commands", "defaults", "connection"].includes(tab) ? tab : "commands";
  state.composerCliTab = next;
  consoleRoot.querySelectorAll("[data-composer-cli-tab]").forEach((button) => {
    const active = button.dataset.composerCliTab === next;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus({ preventScroll: true });
  });
  for (const name of ["commands", "defaults", "connection"]) {
    const panel = byId(`composer-cli-panel-${name}`);
    if (panel) panel.hidden = name !== next;
  }
}

function setComposerCliOpen(open) {
  state.composerCliOpen = Boolean(open);
  const panel = elements["composer-cli-console-panel"];
  const toggle = elements["composer-cli-console-toggle"];
  if (panel) panel.hidden = !state.composerCliOpen;
  if (toggle) toggle.setAttribute("aria-expanded", String(state.composerCliOpen));
  try { localStorage.setItem(COMPOSER_CLI_OPEN_KEY, state.composerCliOpen ? "1" : "0"); } catch { /* storage may be blocked */ }
}

function renderComposerCliConsole() {
  const root = elements["composer-cli-console"];
  if (!root) return;
  const target = activeComposerTarget();
  const catalog = composerCliCatalog();
  const context = catalog.context || {};
  const cliContextState = composerCliContextState(context);
  const cliBusy = cliContextState.value.busy;
  const continuing = Boolean(target.run);
  const diagnosticActions = (catalog.actions || []).filter((action) => ["server-catalog-refresh", "allowlisted-cli"].includes(action.execution));
  const sourceLabel = catalog.source === "dynamic" ? "CLI 实时目录" : catalog.source === "fallback" ? "配置回退目录" : "能力目录";
  elements["composer-cli-console-title"].textContent = `${context.adapterLabel || "CLI"} 操作台`;
  elements["composer-cli-console-summary"].textContent = `${catalog.commands?.length || 0} Composer 命令 · ${diagnosticActions.length} CLI 工具 · ${sourceLabel}`;
  elements["composer-cli-console-state"].textContent = cliBusy
    ? "执行中"
    : continuing ? "会话配置·可热调" : context.enabled === false ? "席位已停用" : "本次任务可配置";
  elements["composer-cli-console-state"].classList.toggle("is-warning", continuing || context.enabled === false);
  root.dataset.adapter = context.adapterId || "unknown";
  root.dataset.busy = String(cliBusy);
  root.dataset.context = cliContextState.key;
  setComposerCliOpen(state.composerCliOpen);
  setComposerCliTab(state.composerCliTab);

  const commandGroups = new Map();
  for (const command of catalog.commands || []) {
    const group = command.control || "other";
    if (!commandGroups.has(group)) commandGroups.set(group, []);
    commandGroups.get(group).push(command);
  }
  const groupLabels = { permission: "执行模式", model: "模型", effort: "推理强度", other: "命令" };
  const controlSelectIds = { model: "task-model", effort: "task-effort", permission: "task-permission" };
  const commandMarkup = [...commandGroups.entries()].map(([group, commands]) => `
    <section class="composer-cli-command-group" aria-label="${escapeHtml(groupLabels[group] || group)}">
      <span class="composer-cli-command-group-label">${escapeHtml(groupLabels[group] || group)}</span>
      <div class="composer-cli-command-chips">${commands.map((command) => {
        const select = elements[controlSelectIds[command.control]];
        const selected = select?.value === String(command.value ?? "");
        // 续聊：chips 只放行当前 select 里可热迁移的项（模型/Effort 全量；权限限白名单档）
        const hotReachable = [...(select?.options || [])].some((option) => option.value === String(command.value ?? ""));
        const disabled = cliBusy || (continuing && !hotReachable);
        return `<button type="button" class="composer-cli-command${selected ? " is-selected" : ""}" data-composer-cli-command="${escapeHtml(command.id)}"
          title="${escapeHtml(command.detail || command.label)}" aria-pressed="${selected}"${disabled ? " disabled" : ""}><code>${escapeHtml(command.label)}</code></button>`;
      }).join("")}</div>
    </section>`).join("");
  elements["composer-cli-command-list"].innerHTML = commandMarkup || '<p class="composer-cli-console-empty">当前 Adapter 没有可应用到 Composer 的命令。</p>';
  elements["composer-cli-command-note"].textContent = continuing
    ? "Codex 沙箱轴随原生会话固化；模型、Effort、权限降档与 ask↔auto 可热调，下一轮生效。"
    : (catalog.notes?.[0] || "命令只改变本次新任务；发送后配置固化到会话。");

  const modelControl = catalog.controls?.model || {};
  const effortControl = catalog.controls?.effort || {};
  const permissionControl = catalog.controls?.permission || {};
  renderComposerCliSelect(elements["composer-cli-default-model"], modelControl.options, catalog.defaults?.model, modelControl.supported === false ? "未接入" : "CLI 默认");
  renderComposerCliSelect(elements["composer-cli-default-effort"], effortControl.options, catalog.defaults?.effort, effortControl.supported === true ? "未设置" : "未接入");
  renderComposerCliSelect(
    elements["composer-cli-default-permission"],
    (permissionControl.options || []).map((option) => ({ value: option.value, label: composerCliPermissionLabel(option.value) })),
    catalog.defaults?.permission,
    "Adapter 默认",
    { includeEmpty: false },
  );
  elements["composer-cli-default-model"].disabled = modelControl.supported === false || !catalog.defaults?.quickEditable || cliBusy;
  elements["composer-cli-default-effort"].disabled = effortControl.supported !== true || !catalog.defaults?.quickEditable || cliBusy;
  elements["composer-cli-default-permission"].disabled = !catalog.defaults?.quickEditable || cliBusy;
  elements["composer-cli-default-save"].disabled = !catalog.defaults?.quickEditable || cliBusy;
  elements["composer-cli-command-value"].textContent = catalog.controls?.command?.value
    ? `执行命令：${catalog.controls.command.value}`
    : "该通道不接受席位级执行命令";
  elements["composer-cli-open-seat"].disabled = !context.runtimeProfileId || cliBusy;

  const connection = catalog.connection || {};
  const connectionText = connection.providerApp
    ? connection.providerId
      ? `${connection.providerApp} · Provider ${connection.providerId}`
      : `${connection.providerApp} · 尚未绑定 Provider（可使用官方或 CLI 登录态）`
    : connection.mode === "cli-managed"
      ? "认证与 token 由当前 CLI 自身管理，控制台不读取明文。"
      : `连接由 ${connection.mode || "Adapter"} 管理，控制台不暴露凭据。`;
  elements["composer-cli-connection-copy"].textContent = connectionText;
  elements["composer-cli-open-connection"].textContent = connection.providerApp ? (connection.providerId ? "编辑 Provider" : "新建 Provider") : "查看认证归属";
  elements["composer-cli-open-connection"].disabled = cliBusy;
  elements["composer-cli-open-capabilities"].disabled = !context.memberId || cliBusy;

  elements["composer-cli-diagnostic-actions"].innerHTML = diagnosticActions.map((action) => `
    <button class="button secondary" type="button" data-composer-cli-action="${escapeHtml(action.id)}" title="${escapeHtml(action.detail || action.label)}"${cliBusy ? " disabled" : ""}>
      ${lucideIcon(action.id === "refresh-catalog" ? "refresh-cw" : "activity")}
      ${escapeHtml(action.label)}
    </button>`).join("");
  const output = elements["composer-cli-diagnostic-output"];
  const diagnostic = cliContextState.value.result;
  output.dataset.context = cliContextState.key;
  if (diagnostic) {
    output.dataset.status = diagnostic.status === "ok" ? "ok" : "failed";
    output.textContent = `${diagnostic.label ? `${diagnostic.label}\n` : ""}${diagnostic.output || "诊断完成，未返回文本"}`;
    output.hidden = false;
  } else {
    delete output.dataset.status;
    output.textContent = "";
    output.hidden = true;
  }
}

async function saveComposerCliDefaults() {
  const catalog = composerCliCatalog();
  const context = catalog.context || {};
  const runtimeProfileId = catalog.context?.runtimeProfileId;
  if (!runtimeProfileId || !catalog.defaults?.quickEditable || composerCliContextState(context).value.busy) return;
  const patch = {
    model: catalog.controls?.model?.supported === false
      ? catalog.defaults?.model ?? null
      : elements["composer-cli-default-model"].value || null,
    defaultEffort: catalog.controls?.effort?.supported === true
      ? elements["composer-cli-default-effort"].value || null
      : catalog.defaults?.effort ?? null,
    defaultPermissionMode: elements["composer-cli-default-permission"].value || catalog.defaults.permission,
  };
  const operation = beginComposerCliOperation(context);
  if (!operation) return;
  renderComposerCliConsole();
  try {
    const result = await request(`${API.runtimeSeats}/${encodeURIComponent(runtimeProfileId)}`, {
      method: "PUT",
      body: patch,
    });
    await Promise.all([
      loadBootstrap(),
      runtimeSeatManager?.load({ fresh: true, preferredId: runtimeProfileId, preserveDraft: true }),
    ]);
    const active = result?.transaction?.activation?.status === "reloaded" || result?.seat?.activation === "live";
    toast(active ? "CLI 席位默认值已保存并激活" : "CLI 席位默认值已保存，等待运行时重载", active ? "success" : "warning", active ? 2600 : 5200);
    await syncModelPick();
  } catch (error) {
    toast(`默认值保存失败：${error.message}`, "error", 6000);
  } finally {
    finishComposerCliOperation(operation);
    renderComposerCliConsole();
  }
}

async function openComposerCliSeat() {
  const catalog = composerCliCatalog();
  await openMemberConfigTarget({
    surface: "runtime",
    memberId: catalog.context?.memberId,
    runtimeProfileId: catalog.context?.runtimeProfileId,
  });
}

async function openComposerCliCapabilities() {
  const catalog = composerCliCatalog();
  await openMemberConfigTarget({
    surface: "capabilities",
    memberId: catalog.context?.memberId,
    runtimeProfileId: catalog.context?.runtimeProfileId,
  });
}

async function openComposerCliConnection() {
  const catalog = composerCliCatalog();
  const connection = catalog.connection || {};
  if (!connection.providerApp) {
    toast(connection.mode === "cli-managed" ? "该成员使用 CLI 自管理认证；控制台不会读取或展示 token" : `连接由 ${connection.mode || "Adapter"} 管理`, "info", 4200);
    return;
  }
  if (!state.providersData) await loadProviders();
  const provider = (state.providersData?.providers || []).find((item) => item.id === connection.providerId) || null;
  openProviderDialog(provider, { app: connection.providerApp });
}

async function runComposerCliAction(actionId) {
  const catalog = composerCliCatalog();
  const memberId = catalog.context?.memberId;
  const action = (catalog.actions || []).find((item) => item.id === actionId);
  const context = catalog.context || {};
  if (!memberId || !action || composerCliContextState(context).value.busy) return;
  const operation = beginComposerCliOperation(context);
  if (!operation) return;
  elements["composer-cli-console-state"].textContent = `${action.label}…`;
  renderComposerCliConsole();
  let diagnostic = null;
  try {
    const result = await request(API.agentActions, { method: "POST", body: { agent: memberId, action: actionId } });
    if (result.catalog) {
      diagnostic = { status: "ok", label: action.label, output: `${action.label}完成`, actionId, finishedAt: new Date().toISOString() };
      const active = activeComposerTarget();
      const activeContext = staticControlContext(active.memberId);
      if (composerControlKey(active.memberId, activeContext.runtimeProfileId) === operation.key) {
        state.agentControlCatalog = result.catalog;
        await syncModelPick();
      }
      toast(`${action.label}完成`, "success", 2200);
    } else {
      diagnostic = {
        status: result.status === "ok" ? "ok" : "failed",
        label: action.label,
        output: result.output || "诊断完成，未返回文本",
        actionId,
        finishedAt: new Date().toISOString(),
      };
      toast(result.status === "ok" ? `${action.label}完成` : `${action.label}执行失败`, result.status === "ok" ? "success" : "error", 3200);
    }
  } catch (error) {
    diagnostic = {
      status: "failed",
      label: action.label,
      output: `${action.label}失败：${error.message}`,
      actionId,
      finishedAt: new Date().toISOString(),
    };
    toast(`${action.label}失败：${error.message}`, "error", 6000);
  } finally {
    finishComposerCliOperation(operation, { result: diagnostic });
    renderComposerCliConsole();
  }
}

function applyComposerCliCommand(commandId) {
  const continuing = Boolean(selectedRun() && !state.sessionPreview);
  const command = (composerCliCatalog().commands || []).find((item) => item.id === commandId);
  if (!command) return toast("命令已不在当前 CLI 目录中，请刷新后重试", "warning");
  if (continuing) {
    // 续聊只放行当前 select 里可热迁移的命令（模型/Effort 每轮原生可改；权限限白名单档）
    const select = elements[{ model: "task-model", effort: "task-effort", permission: "task-permission" }[command.control]];
    const hotReachable = [...(select?.options || [])].some((option) => option.value === String(command.value ?? ""));
    if (!hotReachable) {
      return toast(`${command.label} 不在当前会话的可热迁移配置中（权限沙箱轴/升档需新建任务）`, "warning", 2800);
    }
  }
  try {
    applyRuntimeSlashControl(command);
    renderComposerCliConsole();
    if (!continuing) toast(`已应用 ${command.label}`, "success", 1800);
  } catch (error) {
    toast(error.message, "error");
  }
}

// /model·/effort 随逻辑成员 -> runtime profile -> Adapter catalog 联动。
async function syncModelPick() {
  const epoch = ++modelPickEpoch;
  const agentId = activeComposerTarget().memberId;
  const context = staticControlContext(agentId);
  const { runtimeProfileId, profile, template } = context;
  const { key: draftKey, draft } = composerDraftFor(agentId, context);
  // 续聊：模型/Effort/权限 picker 镜像 run 的当前配置（可热调），不写成员草稿——
  // 草稿是"下一个新任务"的默认值，不能被现有会话污染
  const continuingRun = selectedRun() && !state.sessionPreview ? selectedRun() : null;
  const modelSelect = elements["task-model"];
  const modelPick = elements["task-model-pick"];
  const effortPick = elements["task-effort-pick"];
  const effortSelect = elements["task-effort"];
  const permissionSelect = elements["task-permission"];
  state.agentControlCatalog = null;
  if (modelPick) {
    delete modelPick.dataset.catalogAgent;
    delete modelPick.dataset.catalogSource;
  }
  syncComposerTargetUi();

  const staticModels = [
    { id: "", label: profile?.model ? `${profile.model}（席位默认）` : "CLI 默认" },
    ...(profile?.modelOptions || []).filter((option) => option?.id),
  ];
  if (modelSelect) {
    const selected = supportedControlValue(staticModels, continuingRun ? (continuingRun.modelOverride ?? "") : draft.model, "");
    renderPickOptions(modelSelect, staticModels, selected);
    if (!continuingRun) draft.model = selected;
  }
  const staticEfforts = template?.effortMode === "none"
    ? []
    : [...new Set([...(profile?.effortLevels || []), ...(template?.effortLevels || [])])];
  if (effortSelect) {
    const options = staticEfforts.length
      ? [{ id: "", label: "CLI 默认" }, ...staticEfforts.map((level) => ({ id: level, label: level }))]
      : [{ id: "", label: "未接入" }];
    const selected = supportedControlValue(options, continuingRun ? (continuingRun.effortOverride ?? "") : draft.effort, "");
    renderPickOptions(effortSelect, options, selected);
    if (!continuingRun) draft.effort = selected;
    effortSelect.disabled = template?.effortMode === "none";
  }
  if (permissionSelect) {
    const options = continuingRun
      ? continuingPermissionOptions(continuingRun.permissionMode)
      : runPermissionOptions(template?.permissionModes || ["plan", "read-only", "workspace-write"]);
    const fallback = nativePermissionToComposer(profile?.defaultPermissionMode || template?.defaultPermissionMode || "read-only");
    const selected = supportedControlValue(options, continuingRun ? continuingRun.permissionMode : draft.permission, fallback);
    renderPickOptions(permissionSelect, options, selected);
    if (!continuingRun) draft.permission = selected;
    syncPermissionPill();
  }
  if (draftKey && !continuingRun) state.composerControlDrafts.set(draftKey, { ...draft });
  if (modelPick) modelPick.hidden = template?.modelMode === "none";
  if (effortPick) effortPick.hidden = template?.effortMode === "none" || !staticEfforts.length;
  syncComposerControlVisibility();
  renderComposerCliConsole();
  if (!agentId) return;
  try {
    const discovered = await request(`/api/agents/models?agent=${encodeURIComponent(agentId)}`);
    if (epoch !== modelPickEpoch || activeComposerTarget().memberId !== agentId) return;
    state.agentControlCatalog = discovered;
    const activeDraft = (draftKey && state.composerControlDrafts.get(draftKey)) || draft;
    const modelSupported = discovered.controls?.model?.supported !== false;
    const effortSupported = discovered.controls?.effort?.supported === true;
    if (modelSelect) {
      const defaultLabel = discovered.defaultModel
        ? discovered.models?.find((model) => model.id === discovered.defaultModel)?.label || discovered.defaultModel
        : `${agentLabel(agentId)} CLI`;
      const options = [
        { id: "", label: `${defaultLabel}（默认）` },
        ...(discovered.models || []).map((model) => ({ id: model.id, label: model.label })),
      ];
      const selected = supportedControlValue(options, continuingRun ? (continuingRun.modelOverride ?? "") : activeDraft.model, "");
      renderPickOptions(
        modelSelect,
        options,
        selected,
      );
      if (!continuingRun) activeDraft.model = selected;
      modelSelect.disabled = !modelSupported;
    }
    if (effortSelect) {
      const options = effortSupported
        ? [{ id: "", label: "CLI 默认" }, ...(discovered.effortLevels || []).map((level) => ({ id: level, label: level }))]
        : [{ id: "", label: "未接入" }];
      const selected = supportedControlValue(options, continuingRun ? (continuingRun.effortOverride ?? "") : activeDraft.effort, "");
      renderPickOptions(effortSelect, options, selected);
      if (!continuingRun) activeDraft.effort = selected;
      effortSelect.disabled = !effortSupported;
    }
    if (permissionSelect) {
      const nativeModes = (discovered.controls?.permission?.options || []).map((option) => option.value);
      const options = continuingRun ? continuingPermissionOptions(continuingRun.permissionMode) : runPermissionOptions(nativeModes);
      const fallback = nativePermissionToComposer(discovered.defaults?.permission || profile?.defaultPermissionMode || template?.defaultPermissionMode || "read-only");
      const selected = supportedControlValue(options, continuingRun ? continuingRun.permissionMode : activeDraft.permission, fallback);
      renderPickOptions(permissionSelect, options, selected);
      if (!continuingRun) activeDraft.permission = selected;
      syncPermissionPill();
    }
    if (draftKey && !continuingRun) state.composerControlDrafts.set(draftKey, { ...activeDraft });
    if (modelPick) {
      modelPick.title = `${discovered.context?.adapterLabel || agentLabel(agentId)} 模型目录 · ${discovered.source === "dynamic" ? "CLI 动态发现" : "静态回退"}`;
      modelPick.dataset.catalogAgent = agentId;
      modelPick.dataset.catalogSource = discovered.source || "unknown";
    }
    if (effortPick) effortPick.title = `${discovered.context?.adapterLabel || agentLabel(agentId)} 推理强度`;
    syncComposerControlVisibility();
    renderComposerCliConsole();
    if (state.slashActive) renderSlashMenu();
  } catch {
    // 动态目录失败保持静态（端点自身已回退，这里是双保险）
    renderComposerCliConsole();
  }
}

function selectTeam(id) {
  if (!state.teams.some((team) => team.id === id)) return;
  rememberComposerControlDraft();
  state.selectedTeamId = id;
  state.composerTargetAgentId = null;
  state.requestedAgentIds = [];
  renderRequestedAgentChips();
  localStorage.setItem(TEAM_KEY, id); // LO 2026-08-04：跨客户端重启记忆所选团队（原 sessionStorage 随退出丢失）
  state.expandedTeams.add(id); // 切团队后侧栏直接展开该团队全部项目
  renderTeams();
  refreshTeamData();
  renderTeamActivation();
  if (state.view === "team") void refreshCollabFlow();
}

function updateTeamFormStatus() {
  const status = elements["team-form-status"];
  if (!status) return;
  const editing = teamById(state.editingTeamId);
  if (teamFormBusy) {
    status.textContent = "正在处理";
    status.className = "status-label is-neutral";
  } else if (teamFormDirty) {
    status.textContent = "有未保存修改";
    status.className = "status-label is-warning";
  } else if (!editing) {
    status.textContent = "新团队草稿";
    status.className = "status-label is-warning";
  } else if (editing.builtin) {
    status.textContent = "只读";
    status.className = "status-label is-neutral";
  } else {
    status.textContent = "已保存";
    status.className = "status-label is-ok";
  }
}

function setTeamFormBusy(busy) {
  teamFormBusy = Boolean(busy);
  for (const id of ["team-save-button", "team-new-button", "team-cancel-button", "team-delete-button", "team-export-button", "team-import-button", "team-preset-select"]) {
    if (elements[id]) elements[id].disabled = teamFormBusy;
  }
  if (elements["team-switch-select"]) {
    elements["team-switch-select"].disabled = teamFormBusy || (state.teams.length === 0 && Boolean(state.editingTeamId));
  }
  updateTeamFormStatus();
  renderTeamActivation();
}

function setTeamFormDirty(dirty) {
  teamFormDirty = Boolean(dirty);
  updateTeamFormStatus();
  renderTeamActivation();
}

function markTeamFormDirty() {
  if (teamById(state.editingTeamId)?.builtin) return;
  teamFormRevision += 1;
  setTeamFormDirty(true);
}

function renderTeamActivation() {
  const editing = teamById(state.editingTeamId);
  const active = currentTeam();
  const activateButton = elements["team-activate-button"];
  const applyButton = elements["team-apply-providers-button"];
  const status = elements["team-active-status"];
  const runtimeName = elements["team-runtime-team-name"];

  if (runtimeName) {
    runtimeName.textContent = active?.name ?? "未选择团队";
    runtimeName.className = `status-label ${active ? "is-ok" : "is-neutral"}`;
  }
  if (!activateButton || !status) return;

  if (!editing) {
    status.textContent = "新团队草稿";
    status.className = "status-label is-warning";
    activateButton.disabled = true;
    elements["team-activate-label"].textContent = "先保存团队";
  } else if (editing.id === state.selectedTeamId) {
    status.textContent = "本标签页当前";
    status.className = "status-label is-ok";
    activateButton.disabled = true;
    elements["team-activate-label"].textContent = "已选用";
  } else {
    status.textContent = "仅查看";
    status.className = "status-label is-neutral";
    activateButton.disabled = teamFormDirty || teamFormBusy;
    elements["team-activate-label"].textContent = teamFormBusy ? "正在处理" : teamFormDirty ? "先保存修改" : "设为当前团队";
  }

  if (applyButton) {
    const bindingCount = Object.keys(editing?.providers ?? {}).length;
    applyButton.disabled = !editing || bindingCount === 0 || teamFormDirty || teamFormBusy;
    applyButton.title = teamFormBusy
      ? "团队操作正在进行"
      : teamFormDirty
      ? "先保存团队修改，再应用供应商方案"
      : bindingCount
      ? `按「${editing.name}」的 ${bindingCount} 项绑定切换各 CLI live 配置`
      : "该团队没有供应商绑定";
  }
}

function knownProviderOptions(team = null) {
  const catalog = Array.isArray(state.bootstrap?.teamCatalog) ? state.bootstrap.teamCatalog : [];
  // bootstrap 未就绪时不伪造 Claude 资格；既有团队成员只作禁用占位，目录到达后再恢复真实控件。
  // 当前团队的目录外成员以幽灵项保留，绝不静默删除。
  const options = catalog.length
    ? catalog.map((profile) => ({
        id: profile.id,
        label: profile.label || profile.id,
        shortLabel: profile.shortLabel || "",
        role: profile.role || "",
        description: profile.description || "",
        provider: profile.provider || "",
        runtimeProfileId: profile.runtimeProfileId || profile.id,
        ghost: false,
        catalogPending: false,
        enabled: profile.enabled !== false,
        teamMemberEligible: profile.teamMemberEligible === true,
        coordinatorEligible: profile.coordinatorEligible === true,
        coordinatorEligibilityReason: profile.coordinatorEligibilityReason || null,
        eligibilityReason: profile.eligibilityReason || null,
      }))
    : [];
  const seen = new Set(options.map((option) => option.id));
  for (const id of team?.members ?? []) {
    if (seen.has(id)) continue;
    const meta = PROFILE_META[id] || {};
    options.push({
      id,
      label: meta.name || id,
      shortLabel: AGENT_SHORT[id] || "",
      role: "",
      description: "",
      provider: meta.provider || "",
      runtimeProfileId: id,
      ghost: true,
      catalogPending: !catalog.length,
      enabled: true,
      teamMemberEligible: Boolean(catalog.length),
      coordinatorEligible: Boolean(catalog.length) && id === team?.coordinator,
      coordinatorEligibilityReason: catalog.length ? "runtime-profile-ineligible" : "catalog-unavailable",
      eligibilityReason: catalog.length ? "adapter-not-team-eligible" : "catalog-unavailable",
    });
    seen.add(id);
  }
  return options;
}

function renderTeamSwitcher(team) {
  const switcher = elements["team-switch-select"];
  if (!switcher) return;
  const options = state.teams.map((item) =>
    `<option value="${escapeHtml(item.id)}" ${item.id === team?.id ? "selected" : ""}>${escapeHtml(item.name)}${item.builtin ? "（内置）" : ""}</option>`,
  );
  if (!team) options.unshift('<option value="" selected>＋ 新团队</option>');
  switcher.innerHTML = options.join("");
  switcher.disabled = teamFormBusy || (state.teams.length === 0 && Boolean(team));
}

function updateTeamRosterSummary() {
  const list = elements["team-members-list"];
  const summary = elements["team-roster-summary"];
  if (!list || !summary) return;
  const memberInputs = [...list.querySelectorAll('input[type="checkbox"]')];
  for (const input of memberInputs) {
    input.closest(".team-member-option")?.classList.toggle("is-selected", input.checked);
  }
  // 组头计数（n 席 · 已选 m）随勾选实时刷新；hidden 行照常计入——过滤只是视图。
  for (const group of list.querySelectorAll(".tm-group")) {
    const rows = [...group.querySelectorAll(".team-member-option")];
    const checked = rows.filter((row) => row.querySelector('input[type="checkbox"]')?.checked).length;
    const counter = group.querySelector(".tm-group-count");
    if (counter) counter.textContent = `${rows.length} 席 · 已选 ${checked}`;
  }
  const count = memberInputs.filter((input) => input.checked).length;
  const coordinatorId = list.querySelector('input[name="team-coordinator"]:checked')?.value || "";
  const coordinator = knownProviderOptions(teamById(state.editingTeamId)).find((option) => option.id === coordinatorId);
  summary.textContent = `${count} 个成员 · ${coordinatorId ? `主脑 ${coordinator?.label || coordinatorId}` : "未设置主脑"}`;
  summary.dataset.state = coordinatorId ? "ready" : count ? "missing-coordinator" : "empty";
}

function teamEligibilityReason(reason) {
  return ({
    "profile-disabled": "Profile 已禁用",
    "command-not-configured": "未配置 CLI 命令",
    "adapter-not-team-eligible": "Adapter 未开放团队席位",
    "runtime-profile-missing": "绑定的运行席位不存在",
    "runtime-profile-ineligible": "绑定的运行席位不可用",
    "runtime-capability-conflict": "能力声明超出运行席位",
    "member-main-brain-disabled": "成员未开放主脑资格",
    "adapter-not-coordinator-capable": "Adapter 不支持主脑职责",
    "seat-main-brain-disabled": "运行席位未开放主脑资格",
    "runtime-coordinator-disabled": "运行席位未开放主脑资格",
    "catalog-unavailable": "成员目录加载中",
  })[reason] || "未接入可执行 Adapter";
}

// 成员选择区分组/搜索（2026-08-02 LO）：按品牌分组可折叠；搜索只切换 hidden——
// checked 行绝不移出 DOM，新团队草稿已选成员不会因过滤在保存时静默丢失（collectTeamForm 直接读 DOM）。
const TM_GROUP_ORDER = ["claude", "codex", "grok", "kimi", "gemini", "pi", "other"];
const TM_GROUP_LABELS = { claude: "Claude", codex: "Codex", grok: "Grok", kimi: "Kimi", gemini: "Gemini", pi: "Pi", other: "其他" };
let teamMembersQuery = "";
const teamMemberGroupCollapsed = new Set();

function teamMemberSearchHay(option, meta) {
  return `${option.id} ${option.label} ${option.shortLabel} ${option.role} ${option.provider} ${option.runtimeProfileId} ${meta.name || ""} ${TM_GROUP_LABELS[option.brand] || ""}`.toLowerCase();
}

function applyTeamMemberFilter() {
  const list = elements["team-members-list"];
  if (!list) return;
  const tokens = teamMembersQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [...list.querySelectorAll(".team-member-option")];
  for (const row of rows) {
    const hay = row.dataset.search || "";
    row.hidden = tokens.length > 0 && !tokens.every((token) => hay.includes(token));
  }
  for (const group of list.querySelectorAll(".tm-group")) {
    const groupRows = [...group.querySelectorAll(".team-member-option")];
    const anyVisible = groupRows.some((row) => !row.hidden);
    group.hidden = groupRows.length > 0 && !anyVisible;
    const expanded = teamMemberGroupCollapsed.has(group.dataset.groupBrand) === false || tokens.length > 0;
    const body = group.querySelector(".tm-group-body");
    if (body) body.hidden = !expanded;
    group.querySelector(".tm-group-header")?.setAttribute("aria-expanded", String(expanded));
  }
  const empty = list.querySelector(".tm-filter-empty");
  if (empty) empty.hidden = tokens.length === 0 || rows.some((row) => !row.hidden);
}

function renderTeamMemberOptions(team, {
  members = new Set(team?.members ?? []),
  activeCoordinator = team?.coordinator ?? "",
  readOnly = Boolean(team?.builtin),
} = {}) {
  const list = elements["team-members-list"];
  if (!list) return;
  const selectedMembers = members instanceof Set ? members : new Set(members ?? []);
  const options = knownProviderOptions(team);
  if (!options.length) {
    list.innerHTML = '<div class="team-catalog-loading" role="status">正在加载可执行席位</div>';
    updateTeamRosterSummary();
    return;
  }
  const rows = options.map((option) => {
    const { id, label, shortLabel, role, provider, runtimeProfileId, ghost, catalogPending, enabled, teamMemberEligible, coordinatorEligible, coordinatorEligibilityReason, eligibilityReason } = option;
    const meta = PROFILE_META[id] || {};
    const presentation = profileRolePresentation(role, meta);
    const name = label || meta.name || id;
    const brand = resolveCatalogBrand(provider, `${meta.provider || ""} ${id}`);
    const cli = CLI_ICONS[brand] ? brand : "";
    const statusSuffix = `${enabled === false ? " · 已禁用" : ""}${teamMemberEligible === false ? ` · 不可用（${teamEligibilityReason(eligibilityReason)}）` : ""}`;
    const coordinatorSuffix = coordinatorEligible
      ? " · 可任主脑"
      : ` · 不可任主脑（${teamEligibilityReason(coordinatorEligibilityReason || eligibilityReason)}）`;
    const runtimeSuffix = runtimeProfileId && runtimeProfileId !== id ? ` · ${runtimeProfileId}` : "";
    const sub = catalogPending
      ? `${presentation.title} · 成员目录加载中`
      : ghost
        ? `${presentation.title} · 未在当前成员目录，保存时保留`
        : `${presentation.title}${presentation.role ? ` · ${presentation.role}` : ""}${runtimeSuffix}${statusSuffix}${coordinatorSuffix}`;
    const logo = cliIconMarkup(cli, "tm-logo");
    const avatar = logo || `<span class="tm-initials">${escapeHtml(shortLabel || AGENT_SHORT[id] || name.slice(0, 2))}</span>`;
    const search = teamMemberSearchHay({ ...option, brand }, meta);
    const html = `<div class="team-member-option${ghost ? " is-ghost" : ""}${catalogPending ? " is-catalog-placeholder" : ""}${selectedMembers.has(id) ? " is-selected" : ""}${teamMemberEligible === false ? " is-disabled-profile" : ""}" data-brand="${escapeHtml(brand)}" data-search="${escapeHtml(search)}">
        <label class="team-member-toggle">
          <input type="checkbox" value="${escapeHtml(id)}" ${selectedMembers.has(id) ? "checked" : ""}
            ${readOnly || teamMemberEligible === false ? "disabled" : ""} />
          <span class="tm-avatar" aria-hidden="true">${avatar}</span>
          <span class="tm-meta"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(sub)}</span></span>
        </label>
        ${teamMemberEligible !== false && coordinatorEligible ? `<label class="coordinator-pick"><input type="radio" name="team-coordinator" value="${escapeHtml(id)}"
          ${id === activeCoordinator ? "checked" : ""} ${readOnly ? "disabled" : ""} aria-label="将 ${escapeHtml(name)} 设为团队主脑" /><span>主脑</span></label>` : ""}
        <button class="icon-button team-member-edit" type="button" data-edit-team-member="${escapeHtml(id)}" title="编辑 ${escapeHtml(name)}" aria-label="编辑 ${escapeHtml(name)}">
          <svg class="icon lucide"><use href="#lucide-pencil"></use></svg>
        </button>
      </div>`;
    return { id, brand, html };
  });
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.brand)) groups.set(row.brand, []);
    groups.get(row.brand).push(row);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => {
    const ia = TM_GROUP_ORDER.indexOf(a);
    const ib = TM_GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  list.innerHTML = ordered.map(([brand, groupRows]) => {
    const logo = cliIconMarkup(CLI_ICONS[brand] ? brand : "", "tm-group-logo");
    const selected = groupRows.filter((row) => selectedMembers.has(row.id)).length;
    return `<section class="tm-group" data-group-brand="${escapeHtml(brand)}">
      <button class="tm-group-header" type="button" data-toggle-member-group aria-expanded="true">
        <svg class="icon lucide tm-group-chevron" aria-hidden="true"><use href="#lucide-chevron-down"></use></svg>
        ${logo}<strong>${escapeHtml(TM_GROUP_LABELS[brand] || brand)}</strong>
        <span class="tm-group-count">${groupRows.length} 席 · 已选 ${selected}</span>
      </button>
      <div class="tm-group-body">${groupRows.map((row) => row.html).join("")}</div>
    </section>`;
  }).join("") + '<div class="tm-filter-empty" hidden>没有匹配的席位</div>';
  applyTeamMemberFilter();
  updateTeamRosterSummary();
}

function fillTeamForm(team) {
  const readOnly = Boolean(team?.builtin);
  state.editingTeamId = team?.id ?? null;
  teamFormDirty = false;
  teamFormInitialized = true;
  teamFormRevision += 1;
  elements["team-form-title"].textContent = team ? (readOnly ? `查看团队 · ${team.name}` : `编辑团队 · ${team.name}`) : "新建团队";
  elements["team-builtin-note"].hidden = !readOnly;
  elements["team-name-input"].value = team?.name ?? "";
  elements["team-description-input"].value = team?.description ?? "";
  elements["team-prompt-input"].value = team?.systemPrompt ?? "";
  renderTeamChips(team?.skills ?? [], team?.mcp ?? [], readOnly);
  // 供应商绑定下拉：档案未到时先占位，loadProviders 末尾钩子会按 dialog.open 回填（与芯片墙同纪律）
  populateTeamProviderSelects(team?.providers ?? {});
  for (const app of PROVIDER_APPS) elements[`team-provider-${app}`].disabled = readOnly;
  if (!state.providersData) void loadProviders();
  const members = new Set(team?.members ?? []);
  const activeCoordinator = team?.coordinator ?? "";
  elements["team-form"].dataset.coordinator = activeCoordinator; // 保存时若无 radio 可选（bootstrap 未就绪）的回退锚点
  teamMembersQuery = ""; // 切换团队/重建草稿时重置成员过滤，折叠态跨团队保留
  if (elements["team-members-search"]) elements["team-members-search"].value = "";
  renderTeamMemberOptions(team, { members, activeCoordinator, readOnly });
  // 同页团队浏览器只切换设置草稿；是否作为新会话当前团队由独立动作明确决定。
  renderTeamSwitcher(team);
  for (const field of ["team-name-input", "team-description-input", "team-prompt-input"]) {
    elements[field].disabled = readOnly;
  }
  elements["team-save-label"].textContent = readOnly ? "另存为新团队" : "保存";
  elements["team-delete-button"].hidden = readOnly || !team;
  updateTeamFormStatus();
  renderTeamActivation();
  memberLibrary?.updateTeamToggle();
  memberLibrary?.refreshUsage?.(); // 团队数据落盘后同步成员库徽章/使用情况
}

// 能力声明芯片墙：逗号文本已成历史——目录来自 /api/capabilities（与配置图谱能力面同源），
// 幽灵项（团队声明了但目录没有）照常渲染为虚线片，可手动摘除，绝不静默吞掉
function checkedChipValues(id, fallback) {
  const wall = elements[id];
  if (!wall) return fallback;
  const boxes = wall.querySelectorAll("input[type=checkbox]");
  if (!boxes.length) return fallback;
  return [...boxes].filter((input) => input.checked).map((input) => input.value);
}

function chipWallMarkup(items, selected, readOnly) {
  const sel = new Set(selected);
  return items
    .map((item) => `<label class="chip${item.ghost ? " is-ghost" : ""}${item.off ? " is-off" : ""}" title="${escapeHtml(item.title || item.code)}">
      <input type="checkbox" value="${escapeHtml(item.code)}"${sel.has(item.code) ? " checked" : ""}${readOnly ? " disabled" : ""} />
      <span>${escapeHtml(item.code)}</span>
    </label>`)
    .join("");
}

function renderTeamChips(selectedSkills, selectedMcp, readOnly) {
  const skillsWall = elements["team-skills-chips"];
  const mcpWall = elements["team-mcp-chips"];
  if (!skillsWall || !mcpWall) return;
  const data = state.capabilitiesData;
  if (!data) {
    // 失败态必须显式停在「失败 + 重试」——绝不在渲染层回环重触发 loadCapabilities（请求失败会无限自旋）；
    // 勾选意图暂存 teamChipsPending，重试/回填不吞用户选择
    state.teamChipsPending = { skills: selectedSkills, mcp: selectedMcp, readOnly };
    const message = state.capabilitiesError
      ? `<span class="subtle">目录读取失败：${escapeHtml(state.capabilitiesError)}</span><button class="text-button" type="button" data-chips-retry>重试</button>`
      : '<span class="subtle">正在读取能力目录…</span>';
    skillsWall.innerHTML = message;
    mcpWall.innerHTML = message;
    if (!state.capabilitiesError) void loadCapabilities(); // 完成后由 loadCapabilities 末尾钩子回填（checkedChipValues 保留当前勾选）
    return;
  }
  const skillItems = (data.skills?.items ?? []).map((skill) => ({ code: skill.code, title: skill.description || skill.path }));
  for (const code of selectedSkills) {
    if (!skillItems.some((item) => item.code === code)) skillItems.push({ code, ghost: true, title: "目录中不存在——取消勾选即摘除" });
  }
  const mcpItems = (data.mcp?.servers ?? []).map((server) => ({ code: server.name, title: `${server.transport} · ${server.scope}`, off: server.disabled }));
  for (const name of selectedMcp) {
    if (!mcpItems.some((item) => item.code === name)) mcpItems.push({ code: name, ghost: true, title: "目录中不存在——取消勾选即摘除" });
  }
  skillsWall.innerHTML = skillItems.length ? chipWallMarkup(skillItems, selectedSkills, readOnly) : '<span class="subtle">能力目录为空</span>';
  mcpWall.innerHTML = mcpItems.length ? chipWallMarkup(mcpItems, selectedMcp, readOnly) : '<span class="subtle">能力目录为空</span>';
}

async function confirmDiscardTeamDraft() {
  if (teamFormBusy) {
    toast("团队操作正在进行，请稍候", "warning");
    return false;
  }
  if (!teamFormDirty) return true;
  const editing = teamById(state.editingTeamId);
  return confirmAction({
    eyebrow: "未保存修改",
    title: `放弃「${editing?.name || "新团队"}」的修改？`,
    rows: [
      ["当前状态", "有未保存修改"],
      ["影响", "名称、成员、能力与供应商绑定草稿都不会保存"],
    ],
    warning: "切换后无法恢复这份草稿。",
    confirmLabel: "放弃修改",
    danger: true,
  });
}

async function openTeamWorkspace(team = currentTeam()) {
  const target = team ?? currentTeam();
  if (teamFormDirty && state.editingTeamId !== target?.id && !await confirmDiscardTeamDraft()) return false;
  setView("team");
  memberLibrary?.setSurface("orchestration", { focus: false });
  // 从其他视图返回同一草稿时保留 DOM；其余入口按当前磁盘快照回填。
  if (!teamFormDirty || state.editingTeamId !== target?.id) fillTeamForm(target);
  requestAnimationFrame(() => elements["team-settings-panel"]?.scrollIntoView({ block: "start", behavior: "smooth" }));
  return true;
}

function resetTeamForm() {
  fillTeamForm(teamById(state.editingTeamId) ?? currentTeam());
}

function activateEditingTeam() {
  const team = teamById(state.editingTeamId);
  if (teamFormDirty) {
    toast("先保存团队修改，再设为当前团队", "warning");
    return;
  }
  if (!team || team.id === state.selectedTeamId) return;
  selectTeam(team.id);
  toast(`「${team.name}」已设为本标签页当前团队`, "success", 2600);
}

function splitList(value) {
  return String(value ?? "")
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function teamChipFallback(kind) {
  const pending = state.teamChipsPending;
  if (!state.capabilitiesData && Array.isArray(pending?.[kind])) return pending[kind];
  const editing = teamById(state.editingTeamId);
  return Array.isArray(editing?.[kind]) ? editing[kind] : [];
}

function collectTeamForm() {
  const memberInputs = [...elements["team-members-list"].querySelectorAll("input[type=checkbox]")];
  const renderedMemberIds = new Set(memberInputs.map((input) => input.value));
  const members = memberInputs
    .filter((input) => input.checked)
    .map((input) => input.value);
  // 若 DOM 因目录/渲染故障少了既有成员，保存其他字段时仍必须保留；已渲染且主动取消的成员照常移除。
  for (const member of teamById(state.editingTeamId)?.members ?? []) {
    if (!renderedMemberIds.has(member) && !members.includes(member)) members.push(member);
  }
  // 无 radio 选中（bootstrap 未就绪、coordinator 选项未渲染）时回退编辑前的原主脑，
  // 新团队保持空值并在保存前显式拦截，不能静默改成任一 Agent。
  const checkedCoordinator = elements["team-members-list"].querySelector("input[name=team-coordinator]:checked")?.value;
  const coordinator = checkedCoordinator || elements["team-form"].dataset.coordinator || "";
  if (coordinator && !members.includes(coordinator)) members.push(coordinator); // 主脑必是成员；空值不能伪装成成员
  const providers = collectTeamProviderBindings();
  return {
    name: elements["team-name-input"].value.trim(),
    description: elements["team-description-input"].value.trim(),
    systemPrompt: elements["team-prompt-input"].value.trim(),
    coordinator,
    members,
    skills: checkedChipValues("team-skills-chips", teamChipFallback("skills")),
    mcp: checkedChipValues("team-mcp-chips", teamChipFallback("mcp")),
    providers,
  };
}

async function saveTeamForm(event) {
  event.preventDefault();
  if (elements["team-save-button"].disabled) return;
  const editing = state.teams.find((team) => team.id === state.editingTeamId);
  const payload = collectTeamForm();
  const submissionEditingId = state.editingTeamId;
  const submissionRevision = teamFormRevision;
  let savedTeamId = editing?.id ?? null;
  let savedTeam = editing ?? null;
  if (!payload.name) {
    toast("团队名称不能为空", "error");
    return;
  }
  if (!payload.members.length) {
    toast("至少选择一名团队成员", "error");
    return;
  }
  if (!payload.coordinator) {
    toast("请从已选成员中指定团队主脑", "error");
    return;
  }
  setTeamFormBusy(true); // 防双击/切换；输入仍可继续，revision gate 保留保存期间产生的新修改。
  try {
    if (editing?.builtin) {
      // 内置团队只读——"另存为新团队"路径；重名时提示改名
      if (payload.name === editing.name) payload.name = `${editing.name} 副本`;
      const created = await request(API.teams, { method: "POST", body: payload });
      savedTeam = created;
      savedTeamId = created.id;
      toast(`已基于 ${editing.name} 创建新团队`, "success");
    } else if (editing) {
      savedTeam = await request(`${API.teams}/${encodeURIComponent(editing.id)}`, { method: "PUT", body: payload });
      toast("团队已保存", "success");
    } else {
      const created = await request(API.teams, { method: "POST", body: payload });
      savedTeam = created;
      savedTeamId = created.id;
      toast("团队已创建", "success");
    }
    const reloadResult = await loadTeams({ fresh: true });
    if (loadResultFailed(reloadResult) && savedTeam) {
      const index = state.teams.findIndex((team) => team.id === savedTeam.id);
      if (index === -1) state.teams.push(savedTeam);
      else state.teams[index] = savedTeam;
      renderTeams();
      toast("写入已完成，但团队列表回读失败；当前显示写入响应", "warning", 6000);
    }
    const saved = teamById(savedTeamId) ?? savedTeam ?? currentTeam();
    const draftUnchanged = teamFormRevision === submissionRevision && state.editingTeamId === submissionEditingId;
    if (draftUnchanged) fillTeamForm(saved);
    else {
      // 新建请求已落盘时，把保存期间继续输入的草稿绑定到已创建团队，下一次保存必须走 PUT。
      if (submissionEditingId === null && saved?.id) {
        state.editingTeamId = saved.id;
        elements["team-form-title"].textContent = `编辑团队 · ${saved.name}`;
        elements["team-delete-button"].hidden = false;
        renderTeamSwitcher(saved);
      }
      toast("团队已保存；保存期间产生的新修改仍保留，需再次保存", "warning", 6000);
    }
    if (saved?.id === state.selectedTeamId) void refreshCollabFlow();
  } catch (error) {
    toast(`团队保存失败：${error.message}`, "error");
  } finally {
    setTeamFormBusy(false);
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
  setTeamFormBusy(true);
  try {
    await request(`${API.teams}/${encodeURIComponent(team.id)}`, { method: "DELETE" });
    toast(`团队「${team.name}」已删除`, "success");
    const reloadResult = await loadTeams({ fresh: true });
    if (loadResultFailed(reloadResult)) {
      state.teams = state.teams.filter((item) => item.id !== team.id);
      if (state.selectedTeamId === team.id) {
        state.selectedTeamId = BUILTIN_TEAM_ID;
        localStorage.setItem(TEAM_KEY, state.selectedTeamId);
      }
      renderTeams();
    }
    fillTeamForm(currentTeam());
    void refreshCollabFlow();
  } catch (error) {
    toast(`删除失败：${error.message}`, "error");
  } finally {
    setTeamFormBusy(false);
  }
}

// ── 团队配置便利层（team-config-kit）：预设模板一键新建 + 团队包导入导出 ──
// 纯前端编排，CRUD 全走既有 /api/teams /api/team-members；逐成员失败如实上报不静默。

function renderTeamPresetSelect() {
  const select = elements["team-preset-select"];
  if (!select) return;
  select.innerHTML = [
    '<option value="" selected>从预设新建…</option>',
    ...TEAM_PRESETS.map((preset) =>
      `<option value="${escapeHtml(preset.id)}" title="${escapeHtml(preset.summary)}">${escapeHtml(preset.label)}</option>`),
  ].join("");
}

async function applyTeamPreset(presetId) {
  const preset = presetById(presetId);
  if (!preset) return;
  if (!await confirmDiscardTeamDraft()) {
    renderTeamPresetSelect(); // 放弃则回占位，不残留选中态
    return;
  }
  // 席位目录未就绪时等它（bootstrap 在启动期被长连接挤占，实测迟到 6-8s）：
  // 轮询至多 12s，到位照常套用；仍不到才明示放弃——绝不用空目录套"全席位缺席"假草稿。
  let catalogReady = Array.isArray(state.bootstrap?.teamCatalog) && state.bootstrap.teamCatalog.length > 0;
  if (!catalogReady) {
    toast("席位目录仍在加载，到位后自动套用预设…", "info", 3000);
    const deadline = Date.now() + 12_000;
    while (!catalogReady && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      catalogReady = Array.isArray(state.bootstrap?.teamCatalog) && state.bootstrap.teamCatalog.length > 0;
    }
  }
  if (!catalogReady) {
    renderTeamPresetSelect();
    toast("席位目录加载超时，请稍后重选预设", "warning", 6000);
    return;
  }
  memberLibrary?.setSurface("orchestration", { focus: false });
  fillTeamForm(null);
  const { members, coordinator, dropped } = resolvePreset(preset, knownProviderOptions(null));
  elements["team-name-input"].value = preset.name;
  elements["team-description-input"].value = preset.description;
  elements["team-prompt-input"].value = preset.systemPrompt;
  elements["team-form"].dataset.coordinator = coordinator;
  renderTeamMemberOptions(null, { members: new Set(members), activeCoordinator: coordinator, readOnly: false });
  renderTeamChips([], [], false);
  teamFormDirty = true;
  teamFormRevision += 1;
  updateTeamFormStatus();
  renderTeamPresetSelect();
  if (!members.length) {
    toast(`预设「${preset.label}」的席位在本机目录全不可用，请手动勾选成员`, "warning", 6000);
  } else if (dropped.length) {
    toast(`已套用预设「${preset.label}」；本机缺席席位已跳过：${dropped.join("、")}`, "warning", 6000);
  } else {
    toast(`已套用预设「${preset.label}」——可改后保存`, "success");
  }
}

async function exportEditingTeam() {
  const team = teamById(state.editingTeamId) ?? currentTeam();
  if (!team) {
    toast("没有可导出的团队", "warning");
    return;
  }
  try {
    const payload = await request(API.teamMembers);
    const catalog = unwrapList(payload, ["members"]);
    const pack = buildTeamPack({ team, catalog });
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `514cc-team-${String(team.name).replace(/[\\/:*?"<>|]/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    if (teamFormDirty && team.id === state.editingTeamId) {
      toast("已导出「已保存」版本——未保存的草稿修改不在包内", "warning", 6000);
    } else {
      toast(`团队「${team.name}」已导出（含 ${pack.members.custom.length} 个自定义成员定义）`, "success");
    }
  } catch (error) {
    toast(`导出失败：${error.message}`, "error");
  }
}

async function importTeamPack(file) {
  let pack;
  try {
    pack = parseTeamPack(await file.text());
  } catch (error) {
    toast(`导入失败：${error.message}`, "error", 6000);
    return;
  }
  if (!await confirmDiscardTeamDraft()) return;
  setTeamFormBusy(true);
  try {
    const payload = await request(API.teamMembers);
    const plan = planMemberResolution(pack, unwrapList(payload, ["members"]));
    const idMap = { ...plan.idMap };
    const createdLabels = [];
    const failedNotes = [];
    for (const def of plan.toCreate) {
      try {
        const created = await request(API.teamMembers, {
          method: "POST",
          body: {
            runtimeProfileId: def.runtimeProfileId,
            label: def.label,
            shortLabel: def.shortLabel,
            role: def.role,
            description: def.description,
            systemPrompt: def.systemPrompt,
            capabilities: def.capabilities,
            defaultModel: def.defaultModel,
            defaultEffort: def.defaultEffort,
            mainBrainAllowed: def.mainBrainAllowed,
          },
        });
        idMap[def.id] = created.id;
        createdLabels.push(def.label || def.id);
      } catch (error) {
        failedNotes.push(`${def.label || def.id}（${error.message}）`);
      }
    }
    const body = remappedTeamPayload(pack, idMap);
    const skippedNotes = [...plan.skipped.map((item) => `${item.id}（${item.reason}）`), ...failedNotes];
    if (!body) {
      toast(`导入中止：团队成员在本机无一可用——${skippedNotes.join("、") || "包内成员列表为空"}`, "error", 8000);
      return;
    }
    if (state.teams.some((team) => team.name === body.name)) body.name = `${body.name}（导入）`;
    const createdTeam = await request(API.teams, { method: "POST", body });
    await loadTeams({ fresh: true });
    fillTeamForm(teamById(createdTeam.id) ?? createdTeam);
    void refreshCollabFlow();
    if (skippedNotes.length) {
      toast(`团队「${createdTeam.name}」已导入；跳过：${skippedNotes.join("、")}`, "warning", 8000);
    } else {
      toast(`团队「${createdTeam.name}」已导入（新建成员 ${createdLabels.length} 个、复用 ${Object.keys(plan.idMap).length} 个）`, "success", 6000);
    }
  } catch (error) {
    toast(`导入失败：${error.message}`, "error", 8000);
  } finally {
    setTeamFormBusy(false);
  }
}


// ── 供应商方案（cc-switch 式统一档案）：面板渲染 + 对话框 CRUD + 一键切换 + 团队方案应用 ──
const PROVIDER_APP_META = Object.freeze([
  { app: "claude", label: "Claude Code", icon: "sparkles", modelHint: (p) => p.models?.claude?.model },
  { app: "claude-desktop", label: "Claude Desktop", icon: "monitor", modelHint: (p) => p.models?.["claude-desktop"]?.model },
  { app: "codex", label: "Codex", icon: "brain", modelHint: (p) => p.models?.codex?.model },
  { app: "gemini", label: "Gemini", icon: "diamond", modelHint: (p) => p.models?.gemini?.model },
  { app: "grokbuild", label: "Grok Build", icon: "terminal", modelHint: (p) => p.models?.grokbuild?.model },
  { app: "kimi", label: "Kimi Code", icon: "moon", modelHint: (p) => p.models?.kimi?.model },
  { app: "opencode", label: "OpenCode", icon: "code-2", modelHint: (p) => p.models?.opencode?.model, cumulative: true },
  { app: "openclaw", label: "OpenClaw", icon: "box", modelHint: (p) => p.models?.openclaw?.model, cumulative: true },
  { app: "hermes", label: "Hermes", icon: "bot", modelHint: (p) => p.models?.hermes?.model, cumulative: true },
]);
const PROVIDER_APPS = Object.freeze(PROVIDER_APP_META.map((entry) => entry.app));
const PROVIDER_COMMON_APPS = Object.freeze(PROVIDER_APPS.filter((app) => app !== "claude-desktop"));

// 供应商列表聚焦 app（CC Switch 形态：一次只看一个应用）：localStorage 持久化，不可用则退化内存态
const PROVIDER_ACTIVE_APP_KEY = "514cc-control-provider-app";
try {
  const storedProviderApp = localStorage.getItem(PROVIDER_ACTIVE_APP_KEY);
  if (PROVIDER_APPS.includes(storedProviderApp)) state.providerActiveApp = storedProviderApp;
} catch {
  // localStorage 不可用（隐私模式等）：保持默认 claude
}

function providerActiveApp() {
  return PROVIDER_APPS.includes(state.providerActiveApp) ? state.providerActiveApp : "claude";
}

function setProviderActiveApp(app) {
  if (!PROVIDER_APPS.includes(app)) return;
  state.providerActiveApp = app;
  try {
    localStorage.setItem(PROVIDER_ACTIVE_APP_KEY, app);
  } catch {
    // 同上：仅内存态
  }
  renderProviders();
}

let providersLoadPromise = null;
let providersQueuedFreshPromise = null;
let providersFreshRequested = false;
let providersLoadEpoch = 0;

function startProvidersLoad() {
  const epoch = ++providersLoadEpoch;
  state.providersLoading = true;
  let requestPromise;
  requestPromise = (async () => {
    try {
      const payload = await request(API.providers);
      if (epoch !== providersLoadEpoch) return successfulLoadResult(payload, { stale: true });
      state.providersData = payload;
      return successfulLoadResult(state.providersData);
    } catch (error) {
      if (epoch !== providersLoadEpoch) return successfulLoadResult(null, { stale: true });
      state.providersData = { error: error.message, providers: [], current: {}, live: {} };
      return failedLoadResult(error);
    } finally {
      if (epoch === providersLoadEpoch) {
        state.providersLoading = false;
        renderProviders();
        renderConfigTopology();
        runtimeSeatManager?.syncProviders();
        reconcileUsageAutoQuery();
        // 团队设置已并入团队页；档案晚到或改名时同步刷新绑定下拉。
        if (elements["team-settings-panel"]) {
          const editing = state.teams.find((team) => team.id === state.editingTeamId) ?? null;
          const bindings = teamFormDirty ? collectTeamProviderBindings() : (editing?.providers ?? {});
          populateTeamProviderSelects(bindings);
          renderTeamActivation();
        }
      }
    }
  })().finally(() => {
    if (providersLoadPromise === requestPromise) providersLoadPromise = null;
  });
  providersLoadPromise = requestPromise;
  return requestPromise;
}

function loadProviders({ fresh = false } = {}) {
  if (providersQueuedFreshPromise) {
    if (fresh) {
      providersFreshRequested = true;
      if (providersLoadPromise) providersLoadEpoch += 1;
    }
    return providersQueuedFreshPromise;
  }
  if (!providersLoadPromise) return startProvidersLoad();
  if (!fresh) return providersLoadPromise;

  providersFreshRequested = true;
  providersLoadEpoch += 1;
  const activeLoad = providersLoadPromise;
  let queuedPromise;
  queuedPromise = (async () => {
    try {
      let result = await activeLoad;
      while (providersFreshRequested) {
        providersFreshRequested = false;
        result = await startProvidersLoad();
      }
      return result;
    } finally {
      if (providersQueuedFreshPromise === queuedPromise) providersQueuedFreshPromise = null;
    }
  })();
  providersQueuedFreshPromise = queuedPromise;
  return providersQueuedFreshPromise;
}

// cc-switch autoQueryInterval：启用且间隔>0 的档案按分钟级定时自动查用量（会话级，关页即停）
const usageAutoTimers = new Map();
function reconcileUsageAutoQuery() {
  const providers = state.providersData?.providers ?? [];
  const wanted = new Map();
  for (const item of providers) {
    const script = item.meta?.usageScript;
    if (script?.enabled && Number(script.autoQueryInterval) > 0) wanted.set(item.id, Number(script.autoQueryInterval));
  }
  for (const [id, entry] of usageAutoTimers) {
    if (!wanted.has(id)) {
      clearInterval(entry.timer);
      usageAutoTimers.delete(id);
    }
  }
  for (const [id, minutes] of wanted) {
    const existing = usageAutoTimers.get(id);
    if (existing?.minutes === minutes) continue;
    if (existing) clearInterval(existing.timer);
    void queryProviderUsageNow(id); // 立即查一次，后续按间隔
    usageAutoTimers.set(id, {
      minutes,
      timer: setInterval(() => void queryProviderUsageNow(id), Math.min(1440, minutes) * 60_000),
    });
  }
}

function providerById(id) {
  return (state.providersData?.providers ?? []).find((item) => item.id === id) ?? null;
}

function providerOptionMarkup(app, selectedId) {
  const options = (state.providersData?.providers ?? []).filter((item) => item.apps?.[app]);
  const rows = [`<option value="">跟随当前全局</option>`];
  let selectedMissing = Boolean(selectedId);
  for (const item of options) {
    if (item.id === selectedId) selectedMissing = false;
    rows.push(`<option value="${escapeHtml(item.id)}"${item.id === selectedId ? " selected" : ""}>${escapeHtml(item.name)}</option>`);
  }
  // 绑了已删档案：如实示形「失效绑定」，绝不静默抹掉（与幽灵芯片同一原则）
  if (selectedMissing) rows.push(`<option value="${escapeHtml(selectedId)}" selected>失效绑定（${escapeHtml(selectedId.slice(0, 18))}…）</option>`);
  return rows.join("");
}

function collectTeamProviderBindings() {
  const bindings = {};
  for (const app of PROVIDER_APPS) {
    const value = elements[`team-provider-${app}`]?.value ?? "";
    if (value) bindings[app] = value; // 空 = 跟随当前全局，不落键
  }
  return bindings;
}

function populateTeamProviderSelects(bindings = {}) {
  for (const app of PROVIDER_APPS) {
    const select = elements[`team-provider-${app}`];
    if (select) select.innerHTML = providerOptionMarkup(app, bindings[app] ?? "");
  }
}

/** 健康状态点：灰=未查 / 绿=operational / 黄=degraded / 红=failed（stream_check 三档语义）。 */
function healthBadgeOf(providerId) {
  const health = state.providerHealth[providerId];
  if (!health) return { level: "unknown", title: "未检查——点击卡片上的检查按钮探测可达性" };
  const latency = health.responseTimeMs != null ? `${health.responseTimeMs}ms` : "—";
  if (health.status === "operational") return { level: "operational", title: `可达（${latency}）` };
  if (health.status === "degraded") return { level: "degraded", title: `较慢（${latency}，超降级阈值）` };
  return { level: "failed", title: `不可达：${health.message ?? "连接失败"}` };
}

/** 用量行（cc-switch UsageFooter 语义）：planName + used/total unit 或剩余。 */
function usageLineOf(item) {
  const script = item.meta?.usageScript;
  if (!script?.enabled) return "";
  const usage = state.providerUsage[item.id];
  if (!usage) {
    return `<p class="provider-usage-line"><button class="provider-usage-query" type="button" data-provider-usage="${escapeHtml(item.id)}">查询用量</button></p>`;
  }
  if (!usage.success) {
    return `<p class="provider-usage-line is-error" title="${escapeHtml(usage.error ?? "")}">用量查询失败：${escapeHtml((usage.error ?? "").slice(0, 42))} <button class="provider-usage-query" type="button" data-provider-usage="${escapeHtml(item.id)}">重试</button></p>`;
  }
  const parts = (usage.data ?? []).map((entry) => {
    const unit = entry.unit ?? "";
    if (entry.remaining != null) return `${entry.planName ? `${escapeHtml(entry.planName)} ` : ""}余 ${entry.remaining}${unit}`;
    if (entry.used != null && entry.total != null) return `${entry.planName ? `${escapeHtml(entry.planName)} ` : ""}${entry.used}/${entry.total}${unit}`;
    if (entry.isValid === false) return escapeHtml(entry.invalidMessage ?? "凭据无效");
    return escapeHtml(entry.extra ?? "已查询");
  });
  return `<p class="provider-usage-line" title="用量（点击刷新）">${parts.join("；")} <button class="provider-usage-query" type="button" data-provider-usage="${escapeHtml(item.id)}" aria-label="刷新用量"><svg class="icon lucide"><use href="#lucide-refresh-cw"></use></svg></button></p>`;
}

/** failover 管理条（每应用列头下）：队列 P1..Pn + 自动转移开关。 */
function failoverBarMarkup(app, data, compatibleProviderCount = 0) {
  const queue = data.failoverQueue?.[app] ?? [];
  const auto = Boolean(data.autoFailover?.[app]);
  if (!queue.length && !auto && compatibleProviderCount < 2) return "";
  const names = queue
    .map((id, index) => {
      const provider = providerById(id);
      return `<span class="provider-failover-chip" title="${provider ? escapeHtml(provider.name) : "失效档案"}">P${index + 1} ${provider ? escapeHtml(provider.name) : "失效"}</span>`;
    })
    .join("");
  return `<div class="provider-failover-bar">
    <label class="provider-failover-toggle" title="健康检查失败时自动切换到队列下一可用项">
      <input type="checkbox" data-failover-toggle="${escapeHtml(app)}"${auto ? " checked" : ""} />
      <svg class="icon lucide"><use href="#lucide-repeat"></use></svg>
      <span>自动转移</span>
    </label>
    <span class="provider-failover-queue">${names || '<span class="subtle">使用卡片上的循环图标加入队列</span>'}</span>
  </div>`;
}

/** app 图标条（CC Switch 顶栏形态）：品牌图标优先（铁律不臆造，无品牌回落 lucide）；角标 = 该应用已关联档案数。 */
function renderProviderAppBar() {
  const appBar = elements["provider-app-bar"];
  if (!appBar) return;
  const providers = state.providersData?.providers ?? [];
  const current = state.providersData?.current ?? {};
  const active = providerActiveApp();
  appBar.innerHTML = PROVIDER_APP_META.map((meta) => {
    const brandCli = meta.app === "grokbuild" ? "grok" : CLI_ICONS[meta.app] ? meta.app : null;
    const logo = brandCli
      ? cliIconMarkup(brandCli, "cli-logo provider-app-tab-logo")
      : `<svg class="icon lucide" aria-hidden="true"><use href="#lucide-${meta.icon}"></use></svg>`;
    const count = providers.filter((item) => item.apps?.[meta.app]).length;
    const currentName = providerById(current[meta.app])?.name ?? "";
    const isActive = meta.app === active;
    return `<button class="provider-app-tab${isActive ? " is-active" : ""}" type="button" role="tab" aria-selected="${isActive}" data-provider-app-tab="${meta.app}" title="${escapeHtml(meta.label)}${currentName ? ` · 当前：${escapeHtml(currentName)}` : ""}">${logo}<span class="provider-app-tab-label">${escapeHtml(meta.label)}</span>${count ? `<span class="provider-app-tab-count">${count}</span>` : ""}</button>`;
  }).join("");
}

/** 官方登录态虚拟行（live 检出 CLI 托管官方登录，如 kimi managed:kimi-code，且档案库无同端点档案）：
 *  形态对齐真实档案行让「正在使用」一眼可见；操作面只给「存为档案」——OAuth 凭据绝不落档案。 */
function officialLiveRowMarkup({ app, liveInfo }) {
  const label = PROVIDER_APP_META.find((entry) => entry.app === app)?.label ?? app;
  const letter = escapeHtml(label.trim().charAt(0).toUpperCase() || "?");
  const link = liveInfo.baseUrl || "官方默认端点";
  return `<article class="provider-row is-current" data-provider-official-row="${escapeHtml(app)}">
    <span class="provider-drag-handle" title="虚拟行——存为档案后可排序" aria-hidden="true"><span class="provider-drag-glyph">⠿</span></span>
    <span class="provider-row-icon">${letter}</span>
    <div class="provider-row-main">
      <div class="provider-row-title">
        <strong>${escapeHtml(label)} 官方登录</strong>
        <span class="provider-health-dot is-unknown" title="CLI 托管登录态——可达性以 CLI 自测为准" role="status"></span>
        <span class="provider-badge is-live" title="live 配置正使用 CLI 托管的官方登录（凭据不落档案）">live</span>
        <span class="provider-badge is-category">官方</span>
      </div>
      <span class="provider-row-link" title="${escapeHtml(link)}">${escapeHtml(link)}</span>
      <span class="provider-meta-line">模型：${escapeHtml(liveInfo.model ?? "不动现有")} · 凭据 CLI 托管</span>
    </div>
    <div class="provider-row-actions">
      <button class="button secondary provider-card-action" type="button" data-provider-archive-official="${escapeHtml(app)}">存为档案</button>
    </div>
  </article>`;
}

/** 单个供应商行（CC Switch 行式卡片）：拖拽手柄 + 字母图标徽章 + 名称/badge + accent 链接文本 + 右侧操作。 */
function providerRowMarkup({ item, index, total, meta, app, current, liveInfo, queue, sortMode, storeBlocked }) {
  const isCurrent = current[app] === item.id;
  const isLiveMatch = liveInfo.matchedProviderId === item.id && !isCurrent;
  // 生效行 = store 当前 或 live 认亲（外部切换后 store 未认时，live 才是真相）
  const isActive = isCurrent || isLiveMatch;
  const model = meta.modelHint(item);
  const health = healthBadgeOf(item.id);
  const queueIndex = queue.indexOf(item.id);
  const latency = item.baseUrl ? state.providerLatency[item.baseUrl] : null;
  const letter = escapeHtml((item.name || "?").trim().charAt(0).toUpperCase() || "?");
  const categoryLabel = PRESET_CATEGORY_LABELS[item.category] ?? item.category;
  const sortControls = sortMode
    ? `<button class="icon-button provider-card-action" type="button" data-provider-move="${escapeHtml(app)}::${escapeHtml(item.id)}::-1" title="上移" aria-label="上移"${index === 0 ? " disabled" : ""}><svg class="icon lucide"><use href="#lucide-arrow-up"></use></svg></button>
       <button class="icon-button provider-card-action" type="button" data-provider-move="${escapeHtml(app)}::${escapeHtml(item.id)}::1" title="下移" aria-label="下移"${index === total - 1 ? " disabled" : ""}><svg class="icon lucide"><use href="#lucide-arrow-down"></use></svg></button>`
    : "";
  const failoverButton = queueIndex === -1
    ? `<button class="icon-button provider-card-action" type="button" data-provider-failover-add="${escapeHtml(app)}::${escapeHtml(item.id)}" title="加入故障转移队列" aria-label="加入故障转移队列"><svg class="icon lucide"><use href="#lucide-repeat"></use></svg></button>`
    : `<button class="icon-button provider-card-action is-in-queue" type="button" data-provider-failover-remove="${escapeHtml(app)}::${escapeHtml(item.id)}" title="移出故障转移队列" aria-label="移出故障转移队列"><svg class="icon lucide"><use href="#lucide-repeat"></use></svg></button>`;
  const primaryLabel = item.category === "omo" || item.category === "omo-slim"
    ? "启用插件"
    : meta.cumulative
      ? "加入配置"
      : "启用";
  // 生效行右侧 = 可点的实心状态丸（store 当前 或 live 认亲都算）——一眼锁定「正在用」，
  // 同时保留重新投影入口：编辑档案后 live 不会自动跟进，必须能再点一次重新启用。
  const currentStateLabel = item.category === "omo" || item.category === "omo-slim"
    ? "插件启用中"
    : meta.cumulative
      ? "已加入配置"
      : "使用中";
  const primaryAction = isActive
    ? `<button class="provider-state-pill" type="button" data-provider-switch="${escapeHtml(app)}::${escapeHtml(item.id)}"${storeBlocked ? " disabled" : ""} title="${isCurrent ? "live 配置当前指向此档案" : "live 配置与此档案一致（外部切换认亲）"}——点击重新投影（编辑档案后需重新启用）"><span class="provider-state-pill-check" aria-hidden="true">✓</span>${escapeHtml(currentStateLabel)}</button>`
    : `<button class="button secondary provider-card-action" type="button" data-provider-switch="${escapeHtml(app)}::${escapeHtml(item.id)}"${storeBlocked ? " disabled" : ""}>${primaryLabel}</button>`;
  const link = item.websiteUrl || item.baseUrl || "官方默认端点";
  const draggable = !sortMode && !storeBlocked;
  return `<article class="provider-row${isActive ? " is-current" : ""}" data-provider-row="${escapeHtml(item.id)}"${draggable ? ' draggable="true"' : ""}>
    <span class="provider-drag-handle" title="${draggable ? "拖拽排序" : "排序模式：用右侧箭头移动"}" aria-hidden="true"><span class="provider-drag-glyph">⠿</span></span>
    <span class="provider-row-icon"${item.iconColor ? ` data-provider-color="${escapeHtml(item.iconColor)}"` : ""}>${letter}</span>
    <div class="provider-row-main">
      <div class="provider-row-title">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="provider-health-dot is-${health.level}" title="${escapeHtml(health.title)}" role="status"></span>
        ${isCurrent ? '<span class="provider-badge is-current">当前</span>' : ""}
        ${isLiveMatch ? '<span class="provider-badge is-live" title="live 配置与此档案一致（外部切换认亲）">live</span>' : ""}
        ${queueIndex !== -1 ? `<span class="provider-badge is-failover" title="故障转移队列优先级">P${queueIndex + 1}</span>` : ""}
        ${item.category && item.category !== "custom" ? `<span class="provider-badge is-category">${escapeHtml(categoryLabel)}</span>` : ""}
      </div>
      <span class="provider-row-link" title="${escapeHtml(link)}">${escapeHtml(link)}${latency ? ` <span class="provider-latency">${latency.latency != null ? `${latency.latency}ms` : escapeHtml(latency.error ?? "失败")}</span>` : ""}</span>
      <span class="provider-meta-line">${escapeHtml(model || "模型：不动现有")}${item.hasApiKey ? ` · Key ${escapeHtml(item.apiKeyMasked)}` : " · 无 Key"}</span>
      ${usageLineOf(item)}
    </div>
    <div class="provider-row-actions">
      ${sortControls || primaryAction}
      <button class="icon-button provider-card-action" type="button" data-provider-check="${escapeHtml(item.id)}" title="连通性检查" aria-label="连通性检查"><svg class="icon lucide"><use href="#lucide-activity"></use></svg></button>
      ${item.baseUrl ? `<button class="icon-button provider-card-action" type="button" data-provider-speed="${escapeHtml(item.id)}" title="端点测速" aria-label="端点测速"><svg class="icon lucide"><use href="#lucide-gauge"></use></svg></button>` : ""}
      ${failoverButton}
      <button class="icon-button provider-card-action" type="button" data-provider-edit="${escapeHtml(item.id)}" title="编辑档案" aria-label="编辑档案"><svg class="icon lucide"><use href="#lucide-settings"></use></svg></button>
      <button class="icon-button provider-card-action" type="button" data-provider-delete="${escapeHtml(item.id)}" title="删除档案" aria-label="删除档案"><svg class="icon lucide"><use href="#lucide-trash-2"></use></svg></button>
    </div>
  </article>`;
}

/** 拖拽排序（HTML5 DnD）：dragover 标记插入位（前/后半行），drop 后按视觉顺序落 appOrder。 */
let providerDragId = null;

function clearProviderDragState() {
  providerDragId = null;
  const columns = elements["provider-columns"];
  if (!columns) return;
  for (const row of columns.querySelectorAll(".is-dragging, .is-dragover-before, .is-dragover-after")) {
    row.classList.remove("is-dragging", "is-dragover-before", "is-dragover-after");
  }
}

async function dropProviderRow(dragId, targetId, insertAfter) {
  const app = providerActiveApp();
  const eligible = (state.providersData?.providers ?? []).filter((item) => item.apps?.[app]).map((item) => item.id);
  const ordered = (state.providersData?.appOrder?.[app] ?? []).filter((providerId) => eligible.includes(providerId));
  for (const providerId of eligible) if (!ordered.includes(providerId)) ordered.push(providerId);
  const from = ordered.indexOf(dragId);
  if (from === -1) return;
  const [moved] = ordered.splice(from, 1);
  let insertAt = targetId ? ordered.indexOf(targetId) : ordered.length;
  if (insertAt === -1) insertAt = ordered.length;
  else if (insertAfter) insertAt += 1;
  ordered.splice(insertAt, 0, moved);
  try {
    await request(API.providerSort, { method: "POST", body: { app, orderedIds: ordered } });
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`排序失败：${error.message}`, "error");
  }
}

function renderProviders() {
  const columns = elements["provider-columns"];
  if (!columns) return;
  renderProviderAppBar();
  const data = state.providersData;
  if (!data) {
    columns.innerHTML = '<p class="subtle provider-deck-placeholder">正在读取供应商档案…</p>';
    void loadProviders();
    return;
  }
  if (data.error) {
    if (elements["provider-add-button"]) elements["provider-add-button"].hidden = true;
    columns.innerHTML = `<p class="subtle provider-deck-placeholder">档案读取失败：${escapeHtml(data.error)}</p>`;
    return;
  }
  const providers = data.providers ?? [];
  const current = data.current ?? {};
  const live = data.live ?? {};
  const sortMode = Boolean(state.providerSortMode);
  const storeBlocked = data.storeStatus?.state === "blocked";
  const blockedBanner = storeBlocked
    ? `<div class="provider-store-blocked" role="alert"><strong>供应商档案已冻结</strong><span>${escapeHtml(data.storeStatus.message || "现有 providers.json 无法安全读取")}</span><span>为防覆盖原文件，新增、编辑、排序和切换均已阻止。</span></div>`
    : "";
  const appHasRuntimeState = (app) => Boolean(
    current[app]
    || live[app]?.baseUrl
    || (data.failoverQueue?.[app] ?? []).length
    || data.autoFailover?.[app],
  );
  const globallyEmpty = providers.length === 0 && !PROVIDER_APPS.some(appHasRuntimeState);
  // 空库只保留内容区内的主 CTA；避免页头与空态重复出现两个“新增供应商”。
  if (elements["provider-add-button"]) elements["provider-add-button"].hidden = globallyEmpty || storeBlocked;
  let deckMarkup = "";
  if (globallyEmpty) {
    deckMarkup = `<section class="provider-global-empty" aria-labelledby="provider-global-empty-title">
      <svg class="icon lucide" aria-hidden="true"><use href="#lucide-plug-zap"></use></svg>
      <div><strong id="provider-global-empty-title">尚未创建供应商连接</strong><span>Provider 保存端点与私密凭据；运行席位只绑定 Provider ID。</span></div>
      ${storeBlocked ? "" : '<button class="button primary" type="button" data-provider-add-app=""><svg class="icon lucide"><use href="#lucide-plus"></use></svg>新增供应商</button>'}
    </section>`;
  } else {
    const app = providerActiveApp();
    const meta = PROVIDER_APP_META.find((entry) => entry.app === app) ?? PROVIDER_APP_META[0];
    const liveInfo = live[app] ?? {};
    const queue = data.failoverQueue?.[app] ?? [];
    const order = data.appOrder?.[app] ?? [];
    const orderRank = new Map(order.map((id, index) => [id, index]));
    const appProviders = providers
      .filter((item) => item.apps?.[app])
      .sort((a, b) => (orderRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderRank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    const rows = appProviders
      .map((item, index) => providerRowMarkup({ item, index, total: appProviders.length, meta, app, current, liveInfo, queue, sortMode, storeBlocked }))
      .join("");
    // 官方登录态虚拟行置顶——同端点档案已在列表（认亲成功）时不重复合成
    const officialRow = liveInfo.official && !appProviders.some((item) => item.id === liveInfo.matchedProviderId)
      ? officialLiveRowMarkup({ app, liveInfo })
      : "";
    const liveLine = liveInfo.official
      ? `live：官方登录（managed:kimi-code）${liveInfo.baseUrl ? ` · ${escapeHtml(liveInfo.baseUrl)}` : ""}${liveInfo.model ? ` · 模型 ${escapeHtml(liveInfo.model)}` : ""}${liveInfo.matchedProviderId ? " · 端点已认亲" : " · 未关联档案"}`
      : liveInfo.baseUrl
        ? `live：${escapeHtml(liveInfo.baseUrl)}${liveInfo.matchedProviderId ? "" : "（未认亲——外部手改或非档案切换）"}`
        : "未检测到自定义端点（CLI 可能使用官方登录）";
    const emptyOtherApps = PROVIDER_APP_META.filter((entry) => entry.app !== app
      && !providers.some((item) => item.apps?.[entry.app])
      && !appHasRuntimeState(entry.app));
    deckMarkup = `<div class="provider-app-strip">
      <p class="provider-live-line" title="${liveLine}">${liveLine}</p>
      ${failoverBarMarkup(app, data, appProviders.length)}
      <div class="provider-row-list" data-provider-app-list="${escapeHtml(app)}">
        ${(officialRow + rows) || `<p class="subtle provider-deck-placeholder">${appHasRuntimeState(app) ? "检测到外部 live 状态，尚未关联供应商档案。" : "该应用还没有关联供应商档案。"} <button class="provider-link-button" type="button" data-provider-add-app="${escapeHtml(app)}">新增/关联</button></p>`}
      </div>
    </div>`;
    if (emptyOtherApps.length) {
      deckMarkup += `<details class="provider-empty-apps">
        <summary>还有 ${emptyOtherApps.length} 个应用未关联供应商</summary>
        <div class="provider-empty-app-list">
          ${emptyOtherApps.map((entry) => `<div><span><svg class="icon lucide" aria-hidden="true"><use href="#lucide-${entry.icon}"></use></svg>${escapeHtml(entry.label)}</span><span class="provider-empty-app-actions"><button class="button secondary" type="button" data-provider-app-tab="${escapeHtml(entry.app)}">切换过去</button><button class="button secondary" type="button" data-provider-add-app="${escapeHtml(entry.app)}">关联</button></span></div>`).join("")}
        </div>
      </details>`;
    }
  }
  columns.innerHTML = blockedBanner + deckMarkup;
  // 品牌点颜色走 CSSOM（铁规：禁内联 style 属性，setProperty 可）
  for (const dot of columns.querySelectorAll("[data-provider-color]")) {
    dot.style.setProperty("background", dot.dataset.providerColor);
  }
  // 团队方案应用条
  const teamSelect = elements["provider-team-select"];
  if (teamSelect) {
    const boundTeams = state.teams.filter((team) => Object.keys(team.providers ?? {}).length > 0);
    const previous = teamSelect.value;
    teamSelect.innerHTML = boundTeams.length
      ? boundTeams.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.name)}（${Object.keys(team.providers).length} 绑）</option>`).join("")
      : '<option value="">无绑定团队</option>';
    if (boundTeams.some((team) => team.id === previous)) teamSelect.value = previous;
    elements["provider-apply-team-button"].disabled = boundTeams.length === 0;
  }
  elements["provider-sort-button"]?.classList.toggle("is-active", sortMode);
  for (const id of ["provider-add-button", "provider-import-button", "provider-sort-button"]) {
    if (elements[id]) elements[id].disabled = storeBlocked;
  }
}

function setProviderDialogTab(tab) {
  state.providerDialogTab = tab;
  const dialog = elements["provider-dialog"];
  for (const button of dialog.querySelectorAll("[data-provider-tab]")) {
    const active = button.dataset.providerTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of dialog.querySelectorAll("[data-provider-panel]")) {
    panel.hidden = panel.dataset.providerPanel !== tab;
  }
}

function fillProviderDialog(provider, { app: preferredApp = null, prefill = null } = {}) {
  state.editingProviderId = provider?.id ?? null;
  elements["provider-dialog-title"].textContent = provider ? `编辑供应商 · ${provider.name}` : "新增供应商";
  elements["provider-name-input"].value = provider?.name ?? prefill?.name ?? "";
  elements["provider-baseurl-input"].value = provider?.baseUrl ?? prefill?.baseUrl ?? "";
  elements["provider-key-input"].value = "";
  elements["provider-key-input"].placeholder = provider?.hasApiKey ? `现有 ${provider.apiKeyMasked}——留空保持不变` : "sk-…";
  elements["provider-website-input"].value = provider?.websiteUrl ?? prefill?.websiteUrl ?? "";
  elements["provider-notes-input"].value = provider?.notes ?? prefill?.notes ?? "";
  for (const { app } of PROVIDER_APP_META) {
    const checked = Boolean(provider ? provider.apps?.[app] : preferredApp ? app === preferredApp : app === "claude");
    elements[`provider-app-${app}`].checked = checked;
    elements[`provider-models-${app}`].hidden = !checked;
  }
  elements["provider-claude-model"].value = provider?.models?.claude?.model ?? "";
  elements["provider-claude-haiku"].value = provider?.models?.claude?.haikuModel ?? "";
  elements["provider-claude-sonnet"].value = provider?.models?.claude?.sonnetModel ?? "";
  elements["provider-claude-opus"].value = provider?.models?.claude?.opusModel ?? "";
  elements["provider-claude-fable"].value = provider?.models?.claude?.fableModel ?? "";
  elements["provider-claude-subagent"].value = provider?.models?.claude?.subagentModel ?? "";
  // 模型映射（高级 tab）：显示名 + 1M 声明
  for (const role of ["sonnet", "opus", "fable", "haiku"]) {
    elements[`provider-claude-${role}-name`].value = provider?.models?.claude?.[`${role}ModelName`] ?? "";
  }
  elements["provider-claude-model-1m"].checked = provider?.models?.claude?.model1m === "1";
  for (const role of ["sonnet", "opus", "fable", "haiku", "subagent"]) {
    elements[`provider-claude-${role}-1m`].checked = provider?.models?.claude?.[`${role}Model1m`] === "1";
  }
  elements["provider-codex-model"].value = provider?.models?.codex?.model ?? "";
  elements["provider-codex-effort"].value = provider?.models?.codex?.reasoningEffort ?? "";
  elements["provider-gemini-model"].value = provider?.models?.gemini?.model ?? "";
  for (const app of ["claude-desktop", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]) {
    elements[`provider-${app}-model`].value = provider?.models?.[app]?.model ?? "";
  }
  elements["provider-delete-button"].hidden = !provider;
  // ── cc-switch 二波分区 ──
  const meta = provider?.meta ?? {};
  state.providerDialogEndpoints = (meta.customEndpoints ?? []).map((entry) => ({ ...entry }));
  elements["provider-endpoint-autoselect"].checked = Boolean(meta.endpointAutoSelect);
  renderProviderEndpoints();
  const usage = meta.usageScript ?? {};
  elements["provider-usage-enabled"].checked = Boolean(usage.enabled);
  elements["provider-usage-template"].value = usage.templateType ?? "custom";
  elements["provider-usage-timeout"].value = usage.timeout ?? 10;
  elements["provider-usage-interval"].value = usage.autoQueryInterval ?? 0;
  elements["provider-usage-userid"].value = usage.userId ?? "";
  elements["provider-usage-apikey"].value = "";
  elements["provider-usage-apikey"].placeholder = usage.hasApiKey ? `现有 ${usage.apiKeyMasked}——留空保持不变` : "留空 = 用主 Key";
  elements["provider-usage-baseurl"].value = usage.baseUrl ?? "";
  elements["provider-usage-token"].value = "";
  elements["provider-usage-token"].placeholder = usage.hasAccessToken ? `现有 ${usage.accessTokenMasked}——留空保持不变` : "New API 后台令牌";
  elements["provider-usage-code"].value = usage.code ?? "";
  elements["provider-usage-test-result"].textContent = "";
  const proxy = meta.proxyConfig ?? {};
  elements["provider-proxy-enabled"].checked = Boolean(proxy.enabled);
  elements["provider-proxy-type"].value = proxy.proxyType ?? "http";
  elements["provider-proxy-host"].value = proxy.host ?? "";
  elements["provider-proxy-port"].value = proxy.port ?? "";
  elements["provider-proxy-username"].value = proxy.username ?? "";
  elements["provider-proxy-password"].value = "";
  elements["provider-proxy-password"].placeholder = proxy.hasPassword ? "已设置——留空保持不变" : "可选";
  const test = meta.testConfig ?? {};
  elements["provider-test-timeout"].value = test.timeoutSecs ?? 8;
  elements["provider-test-retries"].value = test.maxRetries ?? 1;
  elements["provider-test-degraded"].value = test.degradedThresholdMs ?? 6000;
  elements["provider-test-model"].value = test.testModel ?? "";
  elements["provider-test-prompt"].value = test.testPrompt ?? "";
  elements["provider-model-test-result"].textContent = "";
  elements["provider-category"].value = provider?.category ?? prefill?.category ?? "custom";
  elements["provider-apikey-field"].value = meta.apiKeyField ?? "ANTHROPIC_AUTH_TOKEN";
  elements["provider-api-format"].value = meta.apiFormat ?? "anthropic";
  // 本地代理请求覆盖（JSON 文本区回显美化；空 = 不覆盖）
  const proxyOverrides = meta.proxyOverrides ?? {};
  elements["provider-proxy-ua"].value = proxyOverrides.userAgent ?? "";
  elements["provider-proxy-headers"].value = proxyOverrides.headers ? JSON.stringify(proxyOverrides.headers, null, 2) : "";
  elements["provider-proxy-body"].value = proxyOverrides.body ? JSON.stringify(proxyOverrides.body, null, 2) : "";
  elements["provider-cost-multiplier"].value = meta.costMultiplier ?? "";
  elements["provider-limit-daily"].value = meta.limitDailyUsd ?? "";
  elements["provider-limit-monthly"].value = meta.limitMonthlyUsd ?? "";
  // ── 三波预设选择器：仅新建模式可见；编辑模式隐藏（预设附加 meta 已在档案里）──
  state.providerPresetSelected = null;
  state.providerPresetQuery = "";
  const presetBlock = elements["provider-preset-block"];
  if (presetBlock) presetBlock.hidden = Boolean(provider);
  const presetSearch = elements["provider-preset-search"];
  if (presetSearch) presetSearch.value = "";
  const presetHint = elements["provider-preset-hint"];
  if (presetHint) {
    presetHint.hidden = true;
    presetHint.textContent = "";
  }
  const catalogList = elements["provider-catalog-list"];
  if (catalogList) catalogList.innerHTML = "";
  // 提示条与「配置 JSON」区块跟随聚焦应用（截图 2 形态：按应用给端点填写提示）
  const hintApp = preferredApp && PROVIDER_APPS.includes(preferredApp) ? preferredApp : providerActiveApp();
  const hintLabel = PROVIDER_APP_META.find((entry) => entry.app === hintApp)?.label ?? "Claude";
  const baseurlHint = elements["provider-baseurl-hint"];
  if (baseurlHint) baseurlHint.textContent = `填写兼容 ${hintLabel} API 的服务端点地址，不要以斜杠结尾；留空 = 官方默认端点`;
  // 「配置预览」区块：聚焦应用 + 首轮干跑生成（之后随表单输入防抖刷新）；手改/明文/重置状态全部清零
  const previewBlock = elements["provider-config-json-block"];
  if (previewBlock) previewBlock.dataset.previewApp = hintApp;
  providerPreviewState.files = [];
  providerPreviewState.active = 0;
  providerPreviewState.note = "预览生成中…";
  providerPreviewState.edits = {};
  providerPreviewState.revealed = {};
  providerPreviewState.resets = new Set();
  providerPreviewState.rawDirty = false;
  renderProviderPreview();
  void loadProviderConfigPreview();
  setProviderDialogTab("basic");
}

/** 端点列表渲染：url + 添加时间 + 测速结果 + 设为主端点/移除。 */
function renderProviderEndpoints() {
  const list = elements["provider-endpoint-list"];
  if (!list) return;
  const endpoints = state.providerDialogEndpoints ?? [];
  if (!endpoints.length) {
    list.innerHTML = '<p class="subtle provider-deck-placeholder">无备选端点——下方添加后可测速选优</p>';
    return;
  }
  list.innerHTML = endpoints.map((entry, index) => {
    const latency = state.providerLatency[entry.url];
    const latencyText = latency
      ? latency.latency != null
        ? `<span class="provider-latency">${latency.latency}ms</span>`
        : `<span class="provider-latency is-error">${escapeHtml(latency.error ?? "失败")}</span>`
      : "";
    return `<div class="provider-endpoint-row">
      <span class="provider-endpoint-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</span>
      ${latencyText}
      <button class="button secondary provider-endpoint-use" type="button" data-endpoint-use="${index}">设为主端点</button>
      <button class="icon-button" type="button" data-endpoint-remove="${index}" title="移除" aria-label="移除端点"><svg class="icon lucide"><use href="#lucide-x"></use></svg></button>
    </div>`;
  }).join("");
}

let providerRevealSeq = 0;

async function openProviderDialog(provider = null, options = {}) {
  const seq = ++providerRevealSeq;
  let editableProvider = provider;
  if (provider?.id) {
    try {
      editableProvider = await request(`${API.providers}/${encodeURIComponent(provider.id)}?includeSecrets=1`);
    } catch (error) {
      if (seq === providerRevealSeq) toast(`供应商配置载入失败：${error.message}`, "error", 5000);
      return;
    }
    if (seq !== providerRevealSeq) return;
  }
  fillProviderDialog(editableProvider, options);
  // 模板库晚到不阻塞：新建档案先给 custom 骨架，模板就位后仅在内容未手改时替换
  void ensureUsageTemplates().then((templates) => {
    if (!state.editingProviderId && !elements["provider-usage-code"].value.trim()) {
      elements["provider-usage-code"].value = templates[elements["provider-usage-template"].value] ?? templates.custom ?? "";
    }
  }).catch(() => {});
  // 预设目录晚到不阻塞：就位后渲染网格（仅新建模式）
  if (!provider) {
    renderProviderPresetGrid();
    void ensureProviderPresets().then(() => renderProviderPresetGrid()).catch((error) => {
      const grid = elements["provider-preset-grid"];
      if (grid) grid.innerHTML = `<p class="subtle provider-deck-placeholder">预设目录加载失败：${escapeHtml(error.message)}</p>`;
    });
  }
  const dialog = elements["provider-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

function closeProviderDialog() {
  elements["provider-dialog"].close();
  state.editingProviderId = null;
}

/** 本地代理请求覆盖收集：两个 JSON 文本区解析（空=不设），非法 JSON 抛错由 save 兜底 toast。 */
function collectProviderProxyOverrides() {
  const parseObject = (raw, label) => {
    const text = raw.trim();
    if (!text) return undefined;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${label} 不是合法 JSON`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 对象`);
    return parsed;
  };
  return {
    userAgent: elements["provider-proxy-ua"].value.trim(),
    headers: parseObject(elements["provider-proxy-headers"].value, "Header 覆盖"),
    body: parseObject(elements["provider-proxy-body"].value, "Body 覆盖"),
  };
}

function collectProviderForm() {
  const apps = {};
  for (const { app } of PROVIDER_APP_META) apps[app] = elements[`provider-app-${app}`].checked;
  const numberOrNull = (value) => {
    const text = String(value ?? "").trim();
    return text === "" ? null : Number(text);
  };
  // 预设带入的附加 meta（仅新建时选中预设才有；apiKeyField/apiFormat 以表单当前值为准）
  const presetExtras = {};
  if (state.providerPresetSelected) {
    for (const key of ["extraEnv", "extraSettings", "codexTop", "codexProviderExtra", "modelCatalog", "appConfig"]) {
      if (state.providerPresetSelected[key] != null) presetExtras[key] = state.providerPresetSelected[key];
    }
  }
  const payload = {
    name: elements["provider-name-input"].value.trim(),
    baseUrl: elements["provider-baseurl-input"].value.trim(),
    apiKey: elements["provider-key-input"].value, // 留空=保留原值（服务端语义），绝不预填
    websiteUrl: elements["provider-website-input"].value.trim(),
    notes: elements["provider-notes-input"].value.trim(),
    apps,
    category: elements["provider-category"].value,
    models: {
      claude: {
        model: elements["provider-claude-model"].value.trim(),
        haikuModel: elements["provider-claude-haiku"].value.trim(),
        sonnetModel: elements["provider-claude-sonnet"].value.trim(),
        opusModel: elements["provider-claude-opus"].value.trim(),
        fableModel: elements["provider-claude-fable"].value.trim(),
        subagentModel: elements["provider-claude-subagent"].value.trim(),
        sonnetModelName: elements["provider-claude-sonnet-name"].value.trim(),
        opusModelName: elements["provider-claude-opus-name"].value.trim(),
        fableModelName: elements["provider-claude-fable-name"].value.trim(),
        haikuModelName: elements["provider-claude-haiku-name"].value.trim(),
        model1m: elements["provider-claude-model-1m"].checked ? "1" : "",
        haikuModel1m: elements["provider-claude-haiku-1m"].checked ? "1" : "",
        sonnetModel1m: elements["provider-claude-sonnet-1m"].checked ? "1" : "",
        opusModel1m: elements["provider-claude-opus-1m"].checked ? "1" : "",
        fableModel1m: elements["provider-claude-fable-1m"].checked ? "1" : "",
        subagentModel1m: elements["provider-claude-subagent-1m"].checked ? "1" : "",
      },
      codex: { model: elements["provider-codex-model"].value.trim(), reasoningEffort: elements["provider-codex-effort"].value },
      gemini: { model: elements["provider-gemini-model"].value.trim() },
      "claude-desktop": { model: elements["provider-claude-desktop-model"].value.trim() },
      grokbuild: { model: elements["provider-grokbuild-model"].value.trim() },
      kimi: { model: elements["provider-kimi-model"].value.trim() },
      opencode: { model: elements["provider-opencode-model"].value.trim() },
      openclaw: { model: elements["provider-openclaw-model"].value.trim() },
      hermes: { model: elements["provider-hermes-model"].value.trim() },
    },
    meta: {
      ...presetExtras,
      customEndpoints: (state.providerDialogEndpoints ?? []).map((entry) => ({ url: entry.url, addedAt: entry.addedAt, lastUsed: entry.lastUsed ?? null })),
      endpointAutoSelect: elements["provider-endpoint-autoselect"].checked,
      usageScript: {
        enabled: elements["provider-usage-enabled"].checked,
        templateType: elements["provider-usage-template"].value,
        code: elements["provider-usage-code"].value,
        timeout: Number(elements["provider-usage-timeout"].value) || 10,
        autoQueryInterval: Number(elements["provider-usage-interval"].value) || 0,
        userId: elements["provider-usage-userid"].value.trim(),
        apiKey: elements["provider-usage-apikey"].value, // 留空=保留
        baseUrl: elements["provider-usage-baseurl"].value.trim(),
        accessToken: elements["provider-usage-token"].value, // 留空=保留
      },
      proxyConfig: {
        enabled: elements["provider-proxy-enabled"].checked,
        proxyType: elements["provider-proxy-type"].value,
        host: elements["provider-proxy-host"].value.trim(),
        port: Number(elements["provider-proxy-port"].value) || 0,
        username: elements["provider-proxy-username"].value.trim(),
        password: elements["provider-proxy-password"].value, // 留空=保留
      },
      testConfig: {
        timeoutSecs: Number(elements["provider-test-timeout"].value) || 8,
        maxRetries: Number(elements["provider-test-retries"].value) || 0,
        degradedThresholdMs: Number(elements["provider-test-degraded"].value) || 6000,
        testModel: elements["provider-test-model"].value.trim(),
        testPrompt: elements["provider-test-prompt"].value.trim(),
      },
      apiKeyField: elements["provider-apikey-field"].value,
      apiFormat: elements["provider-api-format"].value,
      proxyOverrides: collectProviderProxyOverrides(),
      costMultiplier: numberOrNull(elements["provider-cost-multiplier"].value) ?? undefined,
      limitDailyUsd: numberOrNull(elements["provider-limit-daily"].value),
      limitMonthlyUsd: numberOrNull(elements["provider-limit-monthly"].value),
    },
  };
  // 预设图标一并落档案（列表卡片色点/图标用）
  if (state.providerPresetSelected?.icon) payload.icon = state.providerPresetSelected.icon;
  if (/^#[0-9a-fA-F]{6}$/.test(state.providerPresetSelected?.iconColor ?? "")) payload.iconColor = state.providerPresetSelected.iconColor;
  return payload;
}

async function saveProviderForm(event) {
  event.preventDefault();
  if (elements["provider-save-button"].disabled) return;
  let payload;
  try {
    payload = collectProviderForm();
  } catch (error) {
    toast(error.message, "error", 5000);
    return;
  }
  // 配置预览手改：rawConfig 补丁随档案保存（编辑=明文覆盖，重置=删除）；服务端合并校验
  const rawPatch = providerPreviewState.rawDirty ? collectRawConfigPatch() : undefined;
  if (rawPatch) payload.meta = { ...payload.meta, rawConfig: rawPatch };
  if (!payload.name) {
    toast("供应商名称不能为空", "error");
    return;
  }
  if (!Object.values(payload.apps).some(Boolean)) {
    toast("至少勾选一个应用（Claude / Codex / Gemini）", "error");
    return;
  }
  elements["provider-save-button"].disabled = true;
  try {
    const editingId = state.editingProviderId;
    if (editingId) {
      await request(`${API.providers}/${encodeURIComponent(editingId)}`, { method: "PUT", body: payload });
      toast("供应商档案已更新", "success");
    } else {
      await request(API.providers, { method: "POST", body: payload });
      toast("供应商档案已创建——点「启用」投影到 live 配置", "success");
    }
    closeProviderDialog();
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`保存失败：${error.message}`, "error", 6000);
  } finally {
    elements["provider-save-button"].disabled = false;
  }
}

async function deleteProvider(id) {
  const provider = providerById(id);
  if (!provider) return;
  const activeApps = PROVIDER_APPS.filter((app) => state.providersData?.current?.[app] === id);
  if (activeApps.length) {
    toast(`不能删除正在使用的档案：请先切换 ${activeApps.map((app) => PROVIDER_APP_META.find((item) => item.app === app)?.label ?? app).join("、")}`, "warning", 7000);
    return;
  }
  const boundTeams = state.teams.filter((team) => Object.values(team.providers ?? {}).includes(id));
  const proceed = await confirmAction({
    eyebrow: "删除供应商",
    title: `删除供应商「${provider.name}」？`,
    rows: [
      ["影响", "仅删除未在使用的档案；live 配置不会留下失去归属的当前项"],
      ["团队绑定", boundTeams.length ? `${boundTeams.map((team) => team.name).join("、")} 的绑定将失效` : "无团队绑定"],
    ],
    warning: "档案删除后无法恢复（Key 随档案一并销毁）。",
    confirmLabel: "删除",
    danger: true,
  });
  if (!proceed) return;
  try {
    await request(`${API.providers}/${encodeURIComponent(id)}`, { method: "DELETE" });
    toast(`供应商「${provider.name}」已删除`, "success");
    if (state.editingProviderId === id) closeProviderDialog();
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`删除失败：${error.message}`, "error");
  }
}

async function switchProvider(app, providerId) {
  const provider = providerById(providerId);
  if (!provider) return;
  const meta = PROVIDER_APP_META.find((entry) => entry.app === app);
  const action = meta.cumulative ? "加入配置" : "切换供应商";
  const proceed = await confirmAction({
    eyebrow: action,
    title: meta.cumulative ? `将「${provider.name}」加入 ${meta.label} 配置？` : `将 ${meta.label} 切换到「${provider.name}」？`,
    rows: [
      ["Base URL", provider.baseUrl || "官方默认端点"],
      ["模型", meta.modelHint(provider) || "不动现有"],
      ["备份", "切换前自动对现有 live 配置留时间戳备份"],
    ],
    warning: `${meta.label} 的 live 配置将被${meta.cumulative ? "合并" : "投影"}改写（可回滚：备份在数据目录 backups/providers/）。`,
    confirmLabel: meta.cumulative ? "加入配置" : "启用",
  });
  if (!proceed) return;
  try {
    await request(API.providerSwitch, { method: "POST", body: { app, providerId } });
    toast(`${meta.label} 已切换到「${provider.name}」`, "success");
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`切换失败：${error.message}`, "error", 6000);
  }
}

async function applyTeamProviders(teamId = elements["provider-team-select"].value) {
  if (teamFormDirty && teamId === state.editingTeamId) {
    toast("先保存团队修改，再应用供应商方案", "warning");
    return;
  }
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return;
  const bindings = team.providers ?? {};
  const lines = Object.entries(bindings).map(([app, id]) => [app, providerById(id)?.name ?? `失效绑定（${id.slice(0, 18)}…）`]);
  const proceed = await confirmAction({
    eyebrow: "应用团队方案",
    title: `按团队「${team.name}」的绑定逐应用切换？`,
    rows: [...lines, ["备份", "每个应用切换前自动留时间戳备份"]],
    warning: "对应应用的 live 配置将被投影改写；部分失败会如实逐项回报。",
    confirmLabel: "一键应用",
  });
  if (!proceed) return;
  try {
    const report = await request(API.providerApplyTeam, { method: "POST", body: { teamId } });
    const failures = (report.applied ?? []).filter((entry) => !entry.ok);
    if (report.skipped) toast("该团队没有供应商绑定", "warning");
    else if (failures.length) toast(`部分失败：${failures.map((entry) => `${entry.app}（${entry.error}）`).join("；")}`, "error", 8000);
    else toast(`团队「${team.name}」方案已应用（${report.applied.length} 个应用）`, "success");
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`应用失败：${error.message}`, "error", 6000);
  }
}

// ── cc-switch 二波动作面：检查/测速/用量/排序/failover/导入导出/深链接/环境检查 ──

async function checkProviderHealth(id) {
  const provider = providerById(id);
  if (!provider) return;
  state.providerHealth[id] = { status: "checking", message: "检查中…" };
  renderProviders();
  try {
    const result = await request(API.providerCheck(id), { method: "POST", body: {} });
    state.providerHealth[id] = result;
    if (result.failover?.switched) {
      const target = providerById(result.failover.to);
      toast(`「${provider.name}」不可达——已自动故障转移到「${target?.name ?? result.failover.to}」`, "warning", 6000);
      await loadProviders({ fresh: true });
      return;
    }
  } catch (error) {
    state.providerHealth[id] = { status: "failed", message: error.message };
  }
  renderProviders();
}

async function speedTestProvider(id) {
  const provider = providerById(id);
  if (!provider?.baseUrl) return;
  state.providerLatency[provider.baseUrl] = { latency: null, error: "测速中…" };
  renderProviders();
  try {
    const { results } = await request(API.providerTestEndpoints, { method: "POST", body: { urls: [provider.baseUrl] } });
    state.providerLatency[provider.baseUrl] = results?.[0] ?? { latency: null, error: "无结果" };
  } catch (error) {
    state.providerLatency[provider.baseUrl] = { latency: null, error: error.message };
  }
  renderProviders();
}

async function queryProviderUsageNow(id) {
  const provider = providerById(id);
  if (!provider) return;
  try {
    state.providerUsage[id] = await request(API.providerUsage(id), { method: "POST", body: {} });
  } catch (error) {
    state.providerUsage[id] = { success: false, error: error.message };
  }
  renderProviders();
}

async function moveProvider(app, id, direction) {
  const eligible = (state.providersData?.providers ?? []).filter((item) => item.apps?.[app]).map((item) => item.id);
  const ordered = (state.providersData?.appOrder?.[app] ?? []).filter((providerId) => eligible.includes(providerId));
  for (const providerId of eligible) if (!ordered.includes(providerId)) ordered.push(providerId);
  const index = ordered.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  try {
    await request(API.providerSort, { method: "POST", body: { app, orderedIds: ordered } });
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`排序失败：${error.message}`, "error");
  }
}

async function failoverSetMembership(app, id, inQueue) {
  const queue = [...(state.providersData?.failoverQueue?.[app] ?? [])];
  const next = inQueue ? [...queue, id] : queue.filter((qid) => qid !== id);
  try {
    await request(API.providerFailover(app), { method: "PUT", body: { queue: next } });
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`故障转移队列更新失败：${error.message}`, "error");
  }
}

async function failoverToggleAuto(app, enabled) {
  try {
    await request(API.providerFailover(app), { method: "PUT", body: { autoFailover: enabled } });
    await loadProviders({ fresh: true });
    toast(enabled ? "自动故障转移已开启——当前供应商不可达时自动切下一队列项" : "自动故障转移已关闭（队列保留）", "success");
  } catch (error) {
    toast(`开关失败：${error.message}`, "error");
    renderProviders(); // 回弹开关态
  }
}

async function exportProviders() {
  try {
    const payload = await request(API.providerExport);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `514forge-providers-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    toast("已导出（Key 默认掩码——明文备份请用数据目录 backups/）", "success");
  } catch (error) {
    toast(`导出失败：${error.message}`, "error");
  }
}

function importProvidersFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const replace = await confirmAction({
        eyebrow: "导入供应商配置",
        title: `导入 ${payload.providers?.length ?? 0} 个供应商档案？`,
        rows: [
          ["合并", "同名同 id 更新、新档案追加（推荐）"],
          ["替换", "清空现有档案后全量重建（危险）"],
        ],
        warning: "点「确定」走合并导入；要全量替换请在下个确认里再选。",
        confirmLabel: "合并导入",
      });
      if (!replace) return;
      const modeReplace = await confirmAction({
        eyebrow: "导入模式",
        title: "合并还是替换？",
        rows: [["合并", "保留现有 + 导入增量"], ["替换", "清空后全量重建"]],
        warning: "选择「替换」将删除全部现有供应商档案（Key 一并销毁）。",
        confirmLabel: "替换全部",
        danger: true,
        cancelLabel: "合并",
      });
      const result = await request(API.providerImport, { method: "POST", body: { ...payload, mode: modeReplace ? "replace" : "merge" } });
      toast(`导入完成：新增 ${result.added}、更新 ${result.updated}（共 ${result.total}）`, "success");
      await loadProviders({ fresh: true });
    } catch (error) {
      toast(`导入失败：${error.message}`, "error", 6000);
    }
  });
  input.click();
}

async function openProviderDeeplink(url = "") {
  state.providerDeeplinkPreview = null;
  elements["provider-deeplink-input"].value = String(url ?? "").trim();
  elements["provider-deeplink-preview"].textContent = "输入链接后先预览；不会自动导入。";
  elements["provider-deeplink-import-button"].disabled = true;
  const dialog = elements["provider-deeplink-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  if (url) await previewProviderDeeplink();
}

let ccSwitchDeeplinkQueue = Promise.resolve();
function enqueueCcSwitchDeeplink(url) {
  const normalizedUrl = String(url ?? "").trim();
  if (!normalizedUrl) return ccSwitchDeeplinkQueue;
  ccSwitchDeeplinkQueue = ccSwitchDeeplinkQueue.then(async () => {
    try {
      setView("config", { configSurface: "providers", focus: false });
      if (window.__forgeCcSwitchPanel?.openDeeplink) await window.__forgeCcSwitchPanel.openDeeplink(normalizedUrl);
      else await openProviderDeeplink(normalizedUrl);
    } catch (error) {
      toast(`深链接打开失败：${error.message}`, "error", 6000);
      appendDiagnostic(`CC-Switch 深链接打开失败：${error.message}`, "error");
    }
  });
  return ccSwitchDeeplinkQueue;
}

async function previewProviderDeeplink() {
  const url = elements["provider-deeplink-input"].value.trim();
  if (!url) return;
  elements["provider-deeplink-preview"].textContent = "正在解析…";
  elements["provider-deeplink-import-button"].disabled = true;
  state.providerDeeplinkPreview = null;
  try {
    const parsed = await request(API.providerParseDeeplink, { method: "POST", body: { url } });
    state.providerDeeplinkPreview = { url, parsed };
    const preview = parsed.preview ?? {};
    const apps = Object.entries(preview.apps ?? {}).filter(([, enabled]) => enabled).map(([app]) => app).join("、") || "未声明";
    elements["provider-deeplink-preview"].innerHTML = `<dl>
      <div><dt>资源</dt><dd>${escapeHtml(parsed.resource ?? "provider")}</dd></div>
      <div><dt>名称</dt><dd>${escapeHtml(preview.name ?? "未命名")}</dd></div>
      <div><dt>应用</dt><dd>${escapeHtml(apps)}</dd></div>
      <div><dt>Base URL</dt><dd>${escapeHtml(preview.baseUrl ?? "官方默认")}</dd></div>
      <div><dt>凭据</dt><dd>${escapeHtml(preview.apiKey ?? "未携带")}</dd></div>
    </dl><pre>${escapeHtml(JSON.stringify(preview, null, 2))}</pre>`;
    elements["provider-deeplink-import-button"].disabled = false;
  } catch (error) {
    elements["provider-deeplink-preview"].textContent = `解析失败：${error.message}`;
  }
}

async function importProviderDeeplink(event) {
  event?.preventDefault();
  const url = elements["provider-deeplink-input"].value.trim();
  if (!state.providerDeeplinkPreview || state.providerDeeplinkPreview.url !== url) {
    await previewProviderDeeplink();
    return;
  }
  try {
    elements["provider-deeplink-import-button"].disabled = true;
    const created = await request(API.providerImportDeeplink, { method: "POST", body: { url } });
    toast(`已从深链接导入「${created.name}」`, "success");
    elements["provider-deeplink-dialog"].close();
    await loadProviders({ fresh: true });
  } catch (error) {
    toast(`深链接导入失败：${error.message}`, "error", 6000);
  } finally {
    elements["provider-deeplink-import-button"].disabled = false;
  }
}

async function checkProviderEnvConflicts() {
  try {
    const { conflicts } = await request(API.providerEnvConflicts);
    if (!conflicts.length) {
      toast("环境变量无冲突——系统环境与 live 配置不撞车", "success");
      return;
    }
    const lines = conflicts.map((item) => `${item.app} 的 ${item.key}（${item.valueMasked}）`).join("\n");
    toast(`发现 ${conflicts.length} 处环境变量冲突：\n${lines}\n系统环境变量可能覆盖 live 配置——建议在系统设置里清除后重启终端`, "warning", 10000);
  } catch (error) {
    toast(`环境检查失败：${error.message}`, "error");
  }
}

// ── 对话框内动作：端点增删/测速/设主、模板联动、脚本测试 ──

function addProviderEndpoint() {
  const input = elements["provider-endpoint-input"];
  const url = input.value.trim().replace(/\/+$/, "");
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    toast("端点必须是 http(s) URL", "error");
    return;
  }
  if (state.providerDialogEndpoints.some((entry) => entry.url === url)) {
    toast("端点已存在", "warning");
    return;
  }
  state.providerDialogEndpoints.push({ url, addedAt: new Date().toISOString(), lastUsed: null });
  input.value = "";
  renderProviderEndpoints();
}

async function testProviderEndpoints() {
  const urls = [elements["provider-baseurl-input"].value.trim(), ...state.providerDialogEndpoints.map((entry) => entry.url)].filter(Boolean);
  if (!urls.length) {
    toast("先填 Base URL 或备选端点", "warning");
    return;
  }
  elements["provider-endpoint-test-button"].disabled = true;
  try {
    const { results } = await request(API.providerTestEndpoints, { method: "POST", body: { urls } });
    let fastest = null;
    for (const result of results ?? []) {
      state.providerLatency[result.url] = result;
      if (result.latency != null && (!fastest || result.latency < fastest.latency)) fastest = result;
    }
    renderProviderEndpoints();
    // endpointAutoSelect：最快端点与主 Base URL 不同则自动换主（cc-switch 同款）
    if (elements["provider-endpoint-autoselect"].checked && fastest && fastest.url !== elements["provider-baseurl-input"].value.trim()) {
      const previous = elements["provider-baseurl-input"].value.trim();
      elements["provider-baseurl-input"].value = fastest.url;
      if (previous && !state.providerDialogEndpoints.some((entry) => entry.url === previous)) {
        state.providerDialogEndpoints.push({ url: previous, addedAt: new Date().toISOString(), lastUsed: null });
      }
      state.providerDialogEndpoints = state.providerDialogEndpoints.filter((entry) => entry.url !== fastest.url);
      renderProviderEndpoints();
      toast(`已自动选用最快端点（${fastest.latency}ms）`, "success");
    } else {
      toast(fastest ? `最快：${fastest.url}（${fastest.latency}ms）` : "全部不可达", fastest ? "success" : "warning");
    }
  } catch (error) {
    toast(`测速失败：${error.message}`, "error");
  } finally {
    elements["provider-endpoint-test-button"].disabled = false;
  }
}

async function ensureUsageTemplates() {
  if (state.usageTemplates) return state.usageTemplates;
  const { templates } = await request(API.providerUsageTemplates);
  state.usageTemplates = templates ?? {};
  return state.usageTemplates;
}

// ── cc-switch 3.18 预设供应商目录：搜索 + 网格 + 一键自动填充 ──
async function ensureProviderPresets() {
  if (state.providerPresets) return state.providerPresets;
  const catalog = await request(API.providerPresets);
  state.providerPresets = catalog ?? Object.fromEntries(PROVIDER_APPS.map((app) => [app, []]));
  return state.providerPresets;
}

const PRESET_CATEGORY_LABELS = Object.freeze({
  official: "官方",
  cn_official: "国产官方",
  cloud_provider: "云平台",
  aggregator: "聚合",
  third_party: "第三方",
  custom: "自定义",
  omo: "OMO",
  "omo-slim": "OMO Slim",
});

/** 网格过滤：勾选应用的并集 ∩ 搜索词（name/websiteUrl）；官方置顶、primePartner 次之。 */
function presetGridEntries() {
  const catalog = state.providerPresets ?? Object.fromEntries(PROVIDER_APPS.map((app) => [app, []]));
  const query = state.providerPresetQuery.trim().toLowerCase();
  const entries = [];
  for (const { app, label } of PROVIDER_APP_META) {
    if (!elements[`provider-app-${app}`]?.checked) continue;
    for (const preset of catalog[app] ?? []) {
      if (query && !`${preset.name} ${preset.websiteUrl ?? ""}`.toLowerCase().includes(query)) continue;
      entries.push({ app, appLabel: label, preset });
    }
  }
  const rank = (e) => (e.preset.isOfficial ? 0 : e.preset.primePartner ? 1 : e.preset.isPartner ? 2 : 3);
  return entries.sort((a, b) => rank(a) - rank(b) || a.preset.name.localeCompare(b.preset.name));
}

function renderProviderPresetGrid() {
  const grid = elements["provider-preset-grid"];
  if (!grid) return;
  const entries = presetGridEntries();
  if (!state.providerPresets) {
    grid.innerHTML = '<p class="subtle provider-deck-placeholder">预设目录加载中…</p>';
    return;
  }
  if (!entries.length) {
    grid.innerHTML = '<p class="subtle provider-deck-placeholder">无匹配预设——换关键词或勾选其他应用</p>';
    return;
  }
  grid.innerHTML = entries.map(({ app, appLabel, preset }, index) => {
    const key = `${app}:${preset.name}`;
    const active = state.providerPresetSelected?.key === key ? " is-active" : "";
    return `<button class="provider-preset-card${active}" type="button" role="option" aria-selected="${active ? "true" : "false"}" data-preset-key="${escapeHtml(key)}" title="${escapeHtml(preset.websiteUrl ?? preset.name)}">
      <span class="provider-preset-dot" data-preset-dot="${index}"></span>
      <span class="provider-preset-name">${escapeHtml(preset.name)}</span>
      <span class="provider-preset-meta">${appLabel} · ${PRESET_CATEGORY_LABELS[preset.category] ?? preset.category ?? "第三方"}</span>
    </button>`;
  }).join("");
  // 图标色点走 CSSOM（不落内联 style 属性）
  for (const dot of grid.querySelectorAll("[data-preset-dot]")) {
    const entry = entries[Number(dot.dataset.presetDot)];
    const color = /^#[0-9a-fA-F]{6}$/.test(entry?.preset.iconColor ?? "") ? entry.preset.iconColor : null;
    if (color) dot.style.setProperty("--preset-dot", color);
  }
}

/** 预设一键填充：基本字段 + 模型 + 附加 meta 暂存（保存时并入 payload），只留 API Key 给用户。 */
function applyProviderPreset(app, preset) {
  state.providerPresetSelected = {
    key: `${app}:${preset.name}`,
    apiFormat: preset.apiFormat,
    extraEnv: preset.extraEnv,
    extraSettings: preset.extraSettings,
    codexTop: preset.codexTop,
    codexProviderExtra: preset.codexProviderExtra,
    modelCatalog: preset.modelCatalog,
    icon: preset.icon,
    iconColor: preset.iconColor,
    appConfig: preset.appConfig ? { [app]: preset.appConfig } : undefined,
  };
  elements["provider-name-input"].value = preset.name;
  elements["provider-baseurl-input"].value = preset.baseUrl ?? "";
  elements["provider-website-input"].value = preset.websiteUrl ?? "";
  if (preset.category && elements["provider-category"].querySelector(`option[value="${preset.category}"]`)) {
    elements["provider-category"].value = preset.category;
  }
  if (preset.apiKeyField) elements["provider-apikey-field"].value = preset.apiKeyField;
  elements["provider-api-format"].value = preset.apiFormat ?? "anthropic";
  // 只勾选预设所属应用（用户仍可手改）
  for (const { app: candidate } of PROVIDER_APP_META) {
    const checked = candidate === app;
    elements[`provider-app-${candidate}`].checked = checked;
    elements[`provider-models-${candidate}`].hidden = !checked;
  }
  const models = preset.models ?? {};
  if (app === "claude") {
    elements["provider-claude-model"].value = models.model ?? "";
    elements["provider-claude-haiku"].value = models.haikuModel ?? "";
    elements["provider-claude-sonnet"].value = models.sonnetModel ?? "";
    elements["provider-claude-opus"].value = models.opusModel ?? "";
  } else if (app === "codex") {
    elements["provider-codex-model"].value = models.model ?? "";
    if (models.reasoningEffort) elements["provider-codex-effort"].value = models.reasoningEffort;
  } else if (app === "gemini") {
    elements["provider-gemini-model"].value = models.model ?? "";
  } else {
    elements[`provider-${app}-model`].value = models.model ?? "";
  }
  // 模型目录 → datalist 候选
  const catalogList = elements["provider-catalog-list"];
  if (catalogList) {
    catalogList.innerHTML = (preset.modelCatalog ?? [])
      .map((entry) => `<option value="${escapeHtml(entry.model)}">${escapeHtml(entry.displayName ?? entry.model)}</option>`)
      .join("");
  }
  // endpointCandidates（除主 baseUrl）→ 备选端点
  const candidates = (preset.endpointCandidates ?? []).filter((url) => url && url !== preset.baseUrl);
  const existing = new Set(state.providerDialogEndpoints.map((entry) => entry.url));
  for (const url of candidates) {
    if (existing.has(url)) continue;
    state.providerDialogEndpoints.push({ url, addedAt: new Date().toISOString(), lastUsed: null });
  }
  renderProviderEndpoints();
  // 提示行：获取 Key 链接 + 只欠 Key 的事实
  const hint = elements["provider-preset-hint"];
  if (hint) {
    hint.hidden = false;
    const keyLink = preset.apiKeyUrl
      ? ` <a href="${escapeHtml(preset.apiKeyUrl)}" target="_blank" rel="noreferrer noopener">获取 API Key</a>`
      : "";
    hint.innerHTML = `已按「${escapeHtml(preset.name)}」预设填充——只需填写 API Key。${keyLink}`;
  }
  elements["provider-key-input"].focus();
  renderProviderPresetGrid();
}

// ── 应用通用配置对话框（cc-switch CommonConfigEditor 对齐）──
const COMMON_TOGGLE_DEFS = Object.freeze([
  {
    id: "common-toggle-attribution",
    read: (obj) => obj.attribution != null && typeof obj.attribution === "object" && obj.attribution.commit === "" && obj.attribution.pr === "",
    apply: (obj, on) => {
      if (on) obj.attribution = { commit: "", pr: "" };
      else delete obj.attribution;
    },
  },
  ...[
    ["common-toggle-teams", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1"],
    ["common-toggle-toolsearch", "ENABLE_TOOL_SEARCH", "true"],
    ["common-toggle-effort", "CLAUDE_CODE_EFFORT_LEVEL", "max"],
    ["common-toggle-autoupdate", "DISABLE_AUTOUPDATER", "1"],
  ].map(([id, key, value]) => ({
    id,
    read: (obj) => obj.env?.[key] === value,
    apply: (obj, on) => {
      if (on) {
        if (typeof obj.env !== "object" || obj.env === null || Array.isArray(obj.env)) obj.env = {};
        obj.env[key] = value;
      } else if (obj.env && typeof obj.env === "object") {
        delete obj.env[key];
        if (Object.keys(obj.env).length === 0) delete obj.env; // env 空了连 env 一起删（cc-switch 同款）
      }
    },
  })),
]);

function parseJsonObjectText(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
  return parsed;
}

/** JSON → 开关回读（通用配置对话框与供应商对话框「配置 JSON」区块共用）；JSON 非法时开关置灰只读（cc-switch 同款降级）。 */
function syncTogglesFromJson(textarea, toggleElements) {
  let obj = null;
  try {
    obj = parseJsonObjectText(textarea.value);
  } catch {
    obj = null;
  }
  COMMON_TOGGLE_DEFS.forEach((def, index) => {
    const toggle = toggleElements[index];
    if (!toggle) return;
    toggle.disabled = obj === null;
    if (obj !== null) toggle.checked = Boolean(def.read(obj));
  });
}

/** 开关 → JSON 落笔（JSON 非法时不写文本，等用户修 JSON）。 */
function applyToggleToJson(textarea, def, on) {
  let obj;
  try {
    obj = parseJsonObjectText(textarea.value);
  } catch {
    return;
  }
  def.apply(obj, on);
  textarea.value = Object.keys(obj).length ? JSON.stringify(obj, null, 2) : "";
  textarea.dispatchEvent(new Event("input", { bubbles: true })); // 程序化落笔也要刷新行号 gutter 与开关回读
}

function syncCommonTogglesFromJson() {
  syncTogglesFromJson(elements["common-config-claude"], COMMON_TOGGLE_DEFS.map((def) => elements[def.id]));
}

function applyCommonToggleToJson(def) {
  applyToggleToJson(elements["common-config-claude"], def, elements[def.id].checked);
}

let providerCommonJsonEditorHandle = null;
let commonClaudeJsonEditorHandle = null;

// ── 配置预览（服务端干跑）：表单草稿 → /api/providers/preview → 回显启用后该应用的完整 live 文件 ──
// 可编辑：聚焦文本区取明文（显式 opt-in）→ 手改进 edits（原文覆盖，随保存落档案 meta.rawConfig）；
// 重置进 resets（保存后回到投影）。预览请求始终携带手改补丁，服务端补丁合并后干跑。
let providerPreviewSeq = 0;
let providerPreviewTimer = null;
const providerPreviewState = {
  files: [],
  active: 0,
  note: "",
  edits: {},      // path → 明文原文（用户手改）
  revealed: {},   // path → 明文原文（聚焦时取回，未改）
  resets: new Set(), // path → 保存后删除覆盖、回到投影
  rawDirty: false,
  revealing: false,
};

/** 表单任一字段变化：防抖 350ms 后向内核请求干跑预览。 */
function refreshProviderConfigPreview() {
  clearTimeout(providerPreviewTimer);
  providerPreviewTimer = setTimeout(() => void loadProviderConfigPreview(), 350);
}

function providerPreviewApp() {
  const app = elements["provider-config-json-block"]?.dataset.previewApp;
  return PROVIDER_APPS.includes(app) ? app : "claude";
}

function providerPreviewCurrent() {
  const { files, active } = providerPreviewState;
  if (!files.length) return null;
  return files[Math.min(active, files.length - 1)] ?? files[0];
}

/** 当前生效的手改文件集合：已存覆盖（rawConfigPaths）− 重置 + 本轮编辑。 */
function providerPreviewRawPaths() {
  const stored = providerById(state.editingProviderId)?.meta?.rawConfigPaths?.[providerPreviewApp()] ?? [];
  const set = new Set(stored);
  for (const path of providerPreviewState.resets) set.delete(path);
  for (const path of Object.keys(providerPreviewState.edits)) set.add(path);
  return set;
}

/** 手改补丁：编辑=明文覆盖，重置=null 删除；服务端 mergeRawConfigPatch 同律。 */
function collectRawConfigPatch() {
  const files = {};
  for (const [path, text] of Object.entries(providerPreviewState.edits)) files[path] = text;
  for (const path of providerPreviewState.resets) files[path] = null;
  return Object.keys(files).length ? { [providerPreviewApp()]: files } : undefined;
}

function providerPreviewPayload() {
  const payload = { ...collectProviderForm(), id: state.editingProviderId ?? undefined };
  const patch = collectRawConfigPatch();
  if (patch) payload.meta = { ...payload.meta, rawConfig: patch };
  return payload;
}

/** 预览渲染：多文件页签（✎=原文覆盖）+ 行号编辑器；显示优先级 手改 > 已取明文 > 掩码投影。 */
function renderProviderPreview() {
  const textarea = elements["provider-common-json"];
  const tabs = elements["provider-preview-tabs"];
  if (!textarea || !tabs) return;
  const { files, active, note, edits, revealed } = providerPreviewState;
  const rawPaths = providerPreviewRawPaths();
  if (!files.length) {
    tabs.hidden = true;
    tabs.innerHTML = "";
    textarea.readOnly = true;
    const text = note || "（填写表单后自动生成预览）";
    if (textarea.value !== text) textarea.value = text;
  } else {
    const current = files[Math.min(active, files.length - 1)] ?? files[0];
    const currentIndex = files.indexOf(current);
    tabs.hidden = false;
    tabs.innerHTML = files.map((file, index) => {
      const raw = rawPaths.has(file.path);
      return `<button class="provider-preview-tab${index === currentIndex ? " is-active" : ""}${raw ? " is-raw" : ""}" type="button" data-preview-tab="${index}" title="${raw ? "已手改——启用时按原文写入" : "投影生成"}">${escapeHtml(file.path)}${raw ? " ✎" : ""}</button>`;
    }).join("");
    const display = current.removed
      ? `（启用后此文件将被移除：${current.path}）`
      : edits[current.path] ?? revealed[current.path] ?? current.content ?? "";
    if (textarea.value !== display) textarea.value = display; // 等值跳过赋值，保光标
    textarea.readOnly = Boolean(current.removed) || (edits[current.path] === undefined && revealed[current.path] === undefined);
  }
  const resetButton = elements["provider-preview-reset-button"];
  if (resetButton) {
    const current = providerPreviewCurrent();
    resetButton.hidden = !current || !rawPaths.has(current.path);
  }
  providerCommonJsonEditorHandle?.sync();
}

async function loadProviderConfigPreview() {
  const block = elements["provider-config-json-block"];
  if (!block) return;
  const app = providerPreviewApp();
  const seq = ++providerPreviewSeq;
  const label = PROVIDER_APP_META.find((entry) => entry.app === app)?.label ?? app;
  if (!elements[`provider-app-${app}`]?.checked) {
    providerPreviewState.files = [];
    providerPreviewState.active = 0;
    providerPreviewState.note = `「${label}」未勾选——勾选后此处显示启用预览`;
    renderProviderPreview();
    return;
  }
  const provider = providerPreviewPayload();
  if (!String(provider.name || "").trim()) {
    providerPreviewState.files = [];
    providerPreviewState.active = 0;
    providerPreviewState.note = "填写供应商名称后生成配置预览";
    renderProviderPreview();
    return;
  }
  try {
    const result = await request(API.providerPreview, { method: "POST", body: { app, provider } });
    if (seq !== providerPreviewSeq) return; // 过期响应丢弃
    providerPreviewState.files = result.files ?? [];
    // 默认页签 = 内容最长的文件（codex 的 config.toml、claude-desktop 的 profile 这类主配置，而非 3 行 auth.json）
    providerPreviewState.active = providerPreviewState.files.reduce((best, file, index, list) => (
      (file.content?.length ?? 0) > (list[best]?.content?.length ?? 0) ? index : best
    ), 0);
    providerPreviewState.note = "";
  } catch (error) {
    if (seq !== providerPreviewSeq) return;
    providerPreviewState.files = [];
    providerPreviewState.active = 0;
    providerPreviewState.note = `预览生成失败：${error.message}`;
  }
  renderProviderPreview();
}

/** 聚焦文本区：还是掩码投影时向内核取明文换上再放开编辑（密钥面 opt-in，同导出 includeSecrets 规则）。 */
async function maybeRevealProviderPreview() {
  const current = providerPreviewCurrent();
  if (!current || current.removed || providerPreviewState.revealing) return;
  const path = current.path;
  if (providerPreviewState.revealed[path] !== undefined || providerPreviewState.edits[path] !== undefined) return;
  providerPreviewState.revealing = true;
  try {
    const result = await request(API.providerPreview, {
      method: "POST",
      body: { app: providerPreviewApp(), provider: providerPreviewPayload(), reveal: true },
    });
    const file = (result.files ?? []).find((entry) => entry.path === path);
    if (file?.content !== undefined) {
      providerPreviewState.revealed[path] = file.content;
      renderProviderPreview();
      elements["provider-common-json"]?.focus();
      toast("已载入明文——手改随「保存」存为原文覆盖", "info", 3000);
    }
  } catch (error) {
    toast(`明文载入失败：${error.message}`, "error", 5000);
  } finally {
    providerPreviewState.revealing = false;
  }
}

function setCommonConfigTab(tab) {
  const dialog = elements["common-config-dialog"];
  for (const button of dialog.querySelectorAll("[data-common-tab]")) {
    const active = button.dataset.commonTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of dialog.querySelectorAll("[data-common-panel]")) {
    panel.hidden = panel.dataset.commonPanel !== tab;
  }
}

let commonConfigRevealSeq = 0;

async function openCommonConfigDialog() {
  const seq = ++commonConfigRevealSeq;
  let result;
  try {
    result = await request(`${API.providerCommonConfig}?includeSecrets=1`);
  } catch (error) {
    if (seq === commonConfigRevealSeq) toast(`通用配置载入失败：${error.message}`, "error", 5000);
    return;
  }
  if (seq !== commonConfigRevealSeq) return;
  const common = result?.commonConfig ?? {};
  for (const app of PROVIDER_COMMON_APPS) elements[`common-config-${app}`].value = common[app] ?? "";
  syncCommonTogglesFromJson();
  commonClaudeJsonEditorHandle?.sync();
  setCommonConfigTab("claude");
  const dialog = elements["common-config-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
}

async function saveCommonConfigForm(event) {
  event.preventDefault();
  if (elements["common-config-save-button"].disabled) return;
  const claudeText = elements["common-config-claude"].value.trim();
  if (claudeText) {
    try {
      parseJsonObjectText(claudeText);
    } catch {
      toast("Claude 通用配置不是合法 JSON 对象", "error");
      setCommonConfigTab("claude");
      return;
    }
  }
  elements["common-config-save-button"].disabled = true;
  try {
    for (const app of PROVIDER_COMMON_APPS) {
      await request(API.providerCommonConfig, { method: "PUT", body: { app, commonConfig: elements[`common-config-${app}`].value } });
    }
    toast("通用配置已保存——下次切换供应商时并入", "success");
    elements["common-config-dialog"].close();
    await loadProviders({ fresh: true }); // 刷新 state.providersData.commonConfig
  } catch (error) {
    toast(`保存失败：${error.message}`, "error", 6000);
  } finally {
    elements["common-config-save-button"].disabled = false;
  }
}


async function applyUsageTemplate() {
  const type = elements["provider-usage-template"].value;
  const templates = await ensureUsageTemplates();
  const current = elements["provider-usage-code"].value.trim();
  // 只在空白或与某模板一致时才覆盖——用户手写脚本绝不静默 clobber
  const isTemplateText = Object.values(templates).some((text) => text.trim() === current);
  if (!current || isTemplateText) {
    elements["provider-usage-code"].value = templates[type] ?? "";
  }
}

async function testUsageScriptNow() {
  const resultEl = elements["provider-usage-test-result"];
  resultEl.textContent = "测试请求发出…";
  elements["provider-usage-test-button"].disabled = true;
  try {
    const result = await request(API.providerUsageTest, {
      method: "POST",
      body: {
        providerId: state.editingProviderId ?? undefined,
        code: elements["provider-usage-code"].value,
        templateType: elements["provider-usage-template"].value,
        timeout: Number(elements["provider-usage-timeout"].value) || 10,
        apiKey: elements["provider-usage-apikey"].value,
        baseUrl: elements["provider-usage-baseurl"].value.trim(),
        accessToken: elements["provider-usage-token"].value,
        userId: elements["provider-usage-userid"].value.trim(),
      },
    });
    if (result.success) {
      const first = result.data?.[0] ?? {};
      resultEl.textContent = `成功：${first.planName ? `${first.planName} ` : ""}${first.remaining != null ? `余 ${first.remaining}${first.unit ?? ""}` : first.extra ?? "已返回"}`;
      resultEl.classList.remove("is-error");
    } else {
      resultEl.textContent = `失败：${(result.error ?? "").slice(0, 80)}`;
      resultEl.classList.add("is-error");
    }
  } catch (error) {
    resultEl.textContent = `失败：${error.message}`;
    resultEl.classList.add("is-error");
  } finally {
    elements["provider-usage-test-button"].disabled = false;
  }
}

async function testProviderModelNow() {
  const resultEl = elements["provider-model-test-result"];
  if (!state.editingProviderId) {
    resultEl.textContent = "请先保存档案，再发起真实模型请求。";
    resultEl.classList.add("is-error");
    return;
  }
  const app = PROVIDER_APPS.find((candidate) => elements[`provider-app-${candidate}`]?.checked);
  if (!app) {
    resultEl.textContent = "至少勾选一个应用。";
    resultEl.classList.add("is-error");
    return;
  }
  resultEl.textContent = "正在请求模型…";
  resultEl.classList.remove("is-error");
  elements["provider-model-test-button"].disabled = true;
  try {
    const result = await request(API.providerModelTest(state.editingProviderId), {
      method: "POST",
      body: {
        app,
        testConfig: {
          testModel: elements["provider-test-model"].value.trim(),
          testPrompt: elements["provider-test-prompt"].value.trim(),
          timeoutSecs: Number(elements["provider-test-timeout"].value) || 8,
        },
      },
    });
    resultEl.textContent = result.success
      ? `可用：HTTP ${result.httpStatus} · ${result.responseTimeMs}ms`
      : `失败：${result.message}`;
    resultEl.classList.toggle("is-error", !result.success);
  } catch (error) {
    resultEl.textContent = `失败：${error.message}`;
    resultEl.classList.add("is-error");
  } finally {
    elements["provider-model-test-button"].disabled = false;
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
    toast(`已清除 ${result.cleared} 条已结束任务`, "success");
  } catch (error) {
    toast(`清除失败：${error.message}`, "error");
  }
}

function exposeProjectForLocation(project) {
  const pref = projectPrefOf(project);
  if (pref.hidden && !state.showHiddenProjects) {
    state.showHiddenProjects = true;
    sessionStorage.setItem(SHOW_HIDDEN_KEY, "1");
    if (elements["show-hidden-toggle"]) elements["show-hidden-toggle"].checked = true;
  }
  if (state.recentOnly && !projectRecent(project)) {
    state.recentOnly = false;
    sessionStorage.setItem(RECENT_ONLY_KEY, "0");
    if (elements["recent-only-toggle"]) elements["recent-only-toggle"].checked = false;
  }
  state.expandedTeams.add(pref.teamId || effectiveProjectTeamId(project));
  if (pref.pinned && !pref.hidden) state.expandedPinnedProjects.add(project.id);
  else state.expandedProjects.add(project.id);
}

function consumeProjectDeepLink({ final = false } = {}) {
  const projectId = state.deepLinkProjectId;
  if (!projectId) return false;
  const project = findProjectById(projectId);
  if (!project) {
    if (final) {
      toast("深度链接指向的项目不存在（可能已清理）", "warning");
      state.deepLinkProjectId = null;
    }
    return false;
  }
  state.deepLinkProjectId = null;
  exposeProjectForLocation(project);
  renderProjects();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const pref = projectPrefOf(project);
    const selector = pref.pinned && !pref.hidden
      ? `[data-pinned-project="${CSS.escape(project.id)}"]`
      : `[data-project-toggle="${CSS.escape(project.id)}"]`;
    const target = document.querySelector(selector);
    target?.scrollIntoView?.({ block: "nearest" });
    target?.focus?.({ preventScroll: true });
  }));
  return true;
}

async function loadProjects({ refresh = false } = {}) {
  // 请求序号防乱序倒灌（烛 R6 致命2）：快速开→关摘要时，慢的 summaries=1 响应不得覆盖已关闭状态
  // 偏好加载失败时仍允许项目扫描，但 status 保持 error；下一次刷新/修改会真实重试，
  // 在成功 GET 前所有覆盖式 PUT 都 fail-closed。
  if (state.projectPrefsStatus !== "ready") await loadProjectPrefs();
  const seq = ++state.projectsSeq;
  let data;
  try {
    // 摘要严格 opt-in（烛 R5 致命1）：默认只回元数据；用户勾选后才请求脱敏摘要
    const query = new URLSearchParams();
    if (state.projectSummaries) query.set("summaries", "1");
    if (refresh) query.set("refresh", "1");
    data = await request(`${API.sessionProjects}${query.size ? `?${query}` : ""}`);
  } catch (error) {
    if (seq !== state.projectsSeq) return;
    state.projectsData = { available: false, error: error.message, projects: [] };
    toast(`项目扫描失败：${error.message}`, "error");
    renderProjects();
    return;
  }
  if (seq !== state.projectsSeq) return; // 已有更新的请求在途/完成
  state.projectsData = data;
  // 远程项目台账并入（独立 try：台账故障不拖垮本地扫描，如实记 state 供 UI 降级）
  try {
    state.remoteProjects = (await request("/api/remote-projects"))?.projects ?? [];
    state.remoteProjectsError = null;
  } catch (error) {
    state.remoteProjects = [];
    state.remoteProjectsError = error.message;
  }
  renderProjects();
  consumeProjectDeepLink({ final: true });
  if (state.deepLinkSession) {
    // 会话深度链接一次性消费：项目树就绪后打开对应历史会话预览（scope 从扫描数据回填）
    const { cli, projectId, sessionId } = state.deepLinkSession;
    const project = (data.projects ?? []).find((item) => item.id === projectId);
    const session = project?.sessions?.find((item) => item.id === sessionId && (item.cli ?? "claude") === cli);
    if (session) {
      exposeProjectForLocation(project);
      renderProjects();
      void openSessionPreview(projectId, sessionId, cli, session.scope ?? "");
    }
    else toast("深度链接指向的会话不存在（可能已清理）", "warning");
    state.deepLinkSession = null;
  }
}

function initRecentOnlyToggle() {
  // 「近期」过滤默认开启：30 天无对话的会话/项目隐藏；关闭即全量显示
  state.recentOnly = sessionStorage.getItem(RECENT_ONLY_KEY) !== "0";
  const toggle = elements["recent-only-toggle"];
  if (!toggle) return;
  toggle.checked = state.recentOnly;
  toggle.addEventListener("change", () => {
    state.recentOnly = toggle.checked;
    sessionStorage.setItem(RECENT_ONLY_KEY, state.recentOnly ? "1" : "0");
    renderProjects();
  });
}

// 「已隐藏」开关：显示被移除（hidden）的项目——压暗标注，右键可取消隐藏；默认关（隐藏即不见）
function initShowHiddenToggle() {
  state.showHiddenProjects = sessionStorage.getItem(SHOW_HIDDEN_KEY) === "1";
  const toggle = elements["show-hidden-toggle"];
  if (!toggle) return;
  toggle.checked = state.showHiddenProjects;
  toggle.addEventListener("change", () => {
    state.showHiddenProjects = toggle.checked;
    sessionStorage.setItem(SHOW_HIDDEN_KEY, state.showHiddenProjects ? "1" : "0");
    renderProjects();
  });
}

function initSubagentsToggle() {
  // 子代理会话默认隐藏（只留主对话）；opt-in 显示——纯客户端过滤，不重取数据
  state.showSubagents = sessionStorage.getItem(SHOW_SUBAGENTS_KEY) === "1";
  const toggle = elements["subagents-toggle"];
  if (!toggle) return;
  toggle.checked = state.showSubagents;
  toggle.addEventListener("change", () => {
    state.showSubagents = toggle.checked;
    sessionStorage.setItem(SHOW_SUBAGENTS_KEY, state.showSubagents ? "1" : "0");
    renderProjects();
  });
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

// CLI 源标签：项目树内会话按 CLI 分组展示（Claude/Codex…）
const CLI_LABELS = { claude: "Claude", codex: "Codex", kimi: "Kimi", pi: "Pi", cursor: "Cursor", opencode: "OpenCode" };
// 官方徽标（index.html sprite 内 fill 型 symbol）：Claude 星芒 / OpenAI knot
const CLI_ICONS = {
  claude: "icon-cli-claude",
  codex: "icon-cli-codex",
  grok: "icon-cli-grok",
  kimi: "icon-cli-kimi",
  pi: "icon-cli-pi",
  gemini: "icon-cli-gemini",
  opencode: "icon-cli-opencode",
};
// agent → 厂商官方徽标（LO 铁律：系统内此类图标一律官方标志，不主观臆造——
// 出处：Anthropic/OpenAI 官方徽标（既有 sprite）、simple-icons 官方收录（KIMI= kimi.com、
// Google Gemini=gemini.google.com、Pi 与 pi.dev/favicon.svg 同形实证）、xAI=Wikimedia File:XAI Logo.svg、
// OpenCode=opencode.ai/favicon.svg 同形）
const AGENT_CLI = {
  "claude-fable": "claude",
  "codex-technical": "codex",
  "grok-search": "grok",
  "grok-build": "grok",
  "kimi-frontend": "kimi",
  "pi-resident": "pi",
  "gemini-research": "gemini",
};

function agentCli(agentId) {
  return AGENT_CLI[String(agentId ?? "")] ?? null;
}

function cliLabel(cli) {
  return CLI_LABELS[cli] ?? String(cli ?? "claude");
}

function cliIconMarkup(cli, className = "cli-logo") {
  const icon = CLI_ICONS[cli];
  return icon ? `<svg class="${className}" aria-hidden="true"><use href="#${icon}"></use></svg>` : "";
}

// 树内可见会话：未归档；子代理（编排派生）默认隐藏，由「子代理」开关 opt-in
// 跨团队从属的会话迁往目标团队；「近期」开启时只留 30 天内有对话的
function sessionRecent(session) {
  if (!state.recentOnly) return true;
  const ms = new Date(session.modifiedAt ?? 0).getTime();
  return Number.isFinite(ms) && Date.now() - ms < RECENT_WINDOW_MS;
}

function projectRecent(project) {
  if (!state.recentOnly) return true;
  if (project.pending) return true; // 乐观项目刚选定，天然"近期"（0 会话会被过滤误杀）
  if (project.remoteProject) return true; // 远程项目无本地会话时间线，按会话过滤是误杀
  return (project.sessions ?? []).some((session) => sessionRecent(session));
}

function visibleTreeSessions(project) {
  const projectTeam = effectiveProjectTeamId(project);
  return (project.sessions ?? []).filter(
    (session) =>
      sessionRecent(session)
      && !sessionPrefOf(session.cli ?? "claude", project.id, session.id).archived
      && (state.showSubagents || !session.subagent)
      && effectiveSessionTeamId(project, session) === projectTeam, // 跨团队从属的会话迁往目标团队
  );
}

// 远程项目 → 树节点：path 必须 null（避免污染本地 cwd 语义：datalist/归属匹配/reveal），
// 远程信息全部挂 remote 子对象；remoteId 是台账真 id（删除用），节点 id 加前缀防撞扫描投影。
function remoteProjectTreeNode(record) {
  const host = record.host ?? null;
  return {
    id: `remote-${record.id}`,
    remoteId: record.id,
    label: record.name,
    path: null,
    sessionCount: 0,
    sessions: [],
    remoteProject: true,
    remote: {
      hostId: record.hostId,
      path: record.path,
      hostName: host?.name ?? record.hostId,
      addr: host ? `${host.user}@${host.host}:${host.port}` : "",
      enabled: host?.enabled !== false,
      trusted: Boolean(host?.trusted),
      hostMissing: Boolean(record.hostMissing) || !host,
    },
  };
}

function remoteTreeNodes() {
  return (state.remoteProjects ?? []).map(remoteProjectTreeNode);
}

function visibleTreeProjects() {
  return [...state.pendingProjects, ...(state.projectsData?.projects ?? []), ...remoteTreeNodes()].filter((project) => {
    const pref = projectPrefOf(project);
    if (pref.hidden) return state.showHiddenProjects;
    return !pref.pinned && projectRecent(project);
  });
}

function projectTreeModel(projects = visibleTreeProjects()) {
  const allTeams = state.teams.length ? state.teams : [{ id: defaultTeamId(), name: "默认团队", builtin: true, members: [] }];
  // LO 2026-08-04：侧栏=团队工作区，只渲染当前选中团队；缺选/失效时回退内置/首个团队
  const selected = allTeams.find((team) => team.id === state.selectedTeamId) ?? allTeams.find((team) => team.builtin) ?? allTeams[0];
  const teams = [selected];
  const knownTeamIds = new Set(allTeams.map((team) => team.id));
  const projectsByTeam = new Map([[selected.id, []]]);
  const looseByTeam = new Map();
  const unassignedProjects = [];
  for (const project of projects) {
    const teamId = effectiveProjectTeamId(project);
    const explicitTeamId = explicitProjectTeamId(project);
    // 严格归属（LO 2026-08-10）：团队树下只挂显式归属本团队的项目；未归属（null）与归属
    // 已失效团队（旧数据）的进「未归属」虚拟组兜底——不消失（08-08 整片吃掉的教训），也不混显。
    if (explicitTeamId === selected.id) {
      projectsByTeam.get(selected.id).push(project);
    } else if (explicitTeamId === null || !knownTeamIds.has(explicitTeamId)) {
      unassignedProjects.push(project);
    }
    for (const session of project.sessions ?? []) {
      const pref = sessionPrefOf(session.cli ?? "claude", project.id, session.id);
      const sessionTeam = pref.teamId && teamById(pref.teamId) ? pref.teamId : null;
      if (sessionTeam && sessionTeam !== teamId && sessionRecent(session) && (state.showSubagents || !session.subagent) && !pref.archived) {
        if (!looseByTeam.has(sessionTeam)) looseByTeam.set(sessionTeam, []);
        looseByTeam.get(sessionTeam).push({ project, session });
      }
    }
  }
  return { teams, projectsByTeam, looseByTeam, unassignedProjects };
}

function teamChildrenMarkup(team, index, projects, looseSessions) {
  return [
    ...projects.map((project, itemIndex) => projectNodeMarkup(project, `${index}-${itemIndex}`)),
    ...looseSessions.map(({ project, session }) => `<li class="team-loose-session">${sessionLinkMarkup(project, session)}</li>`),
  ].join("") || `<li class="project-empty">本团队还没有归属项目——「未归属」组里的项目右键可归属进来</li>`;
}

function sessionDisplayTitle(session) {
  const label = session.nickname ? `${session.nickname} · ${session.label ?? ""}`.trim() : session.label;
  return session.summary || label || `会话 ${String(session.id).slice(0, 8)}`;
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
  renderRailMetaSections(); // 置顶/已归档区随项目数据与偏好联动（含 run，早退路径也要刷）
  if (!container) return;
  if (state.view !== "workbench") return;
  if (!data) {
    commitMarkup(container, `<div class="empty-state compact-empty"><span>正在扫描本地项目…</span></div>`);
    return;
  }
  // 侧栏偏好：隐藏被移除的（「已隐藏」开关开启时仍显示但压暗标注）；置顶项目不进树（迁往置顶区）；「近期」开启时 30 天无对话的项目也不进树
  // 乐观项目并入：扫描列表尚无同路径的 pending 项目也进树（出现真项目即让位）
  const scanned = data.projects ?? [];
  const scannedKeys = new Set(scanned.map((project) => normalizePathKey(project.path ?? project.id)));
  const beforeTakeover = state.pendingProjects.length;
  state.pendingProjects = state.pendingProjects.filter((project) => !scannedKeys.has(normalizePathKey(project.path)));
  if (state.pendingProjects.length !== beforeTakeover) persistPendingProjects(); // 真项目让位后同步持久层
  const projects = visibleTreeProjects();
  // 团队层级树拍平（LO 2026-08-11）：分区头已是「⌄ 团队名 + 计数 + 折叠」，树内再挂同名团队节点
  // 就是两个一样的折叠控件叠着——当前团队的项目直接平铺进树，头标签同步为当前团队名；
  // 未归属/失效归属的项目仍进「未归属」虚拟组（严格归属制，兜底不消失）
  const { teams, projectsByTeam, looseByTeam, unassignedProjects } = projectTreeModel(projects);
  const currentTeam = teams[0];
  elements["project-count"].textContent = String((projectsByTeam.get(currentTeam?.id) ?? []).length);
  if (elements["team-rail-title"]) elements["team-rail-title"].textContent = currentTeam?.name ?? "团队";
  if (!data.available) {
    commitMarkup(container, emptyMarkup("项目扫描不可用", data.error ?? "未知原因"));
    return;
  }
  if (!state.expandedTeamsInitialized) {
    state.expandedTeamsInitialized = true;
    if (!state.expandedTeams.size) {
      state.expandedTeams.add(UNASSIGNED_TEAM_NODE_ID); // 未归属组默认展开：严格归属制下它是唯一兜底，收起等于隐身
    }
  }
  commitMarkup(container, [
    ...teams.map((team, index) => `<ul class="project-sessions team-projects team-projects-flat">${teamChildrenMarkup(team, index, projectsByTeam.get(team.id) ?? [], looseByTeam.get(team.id) ?? [])}</ul>`),
    unassignedNodeMarkup(unassignedProjects),
  ].join(""));
}

// 「未归属」虚拟组（严格归属制的兜底）：未归属任何团队的项目都躺在这里——
// 右键「从属团队」归属后立即迁往目标团队节点；组为空时不渲染，不占侧栏
const UNASSIGNED_TEAM_NODE_ID = "__unassigned__";

function unassignedNodeMarkup(projects) {
  if (!projects.length) return "";
  const expanded = state.expandedTeams.has(UNASSIGNED_TEAM_NODE_ID);
  const items = expanded
    ? projects.map((project, itemIndex) => projectNodeMarkup(project, `u-${itemIndex}`)).join("")
    : "";
  return `<div class="project-node team-node is-unassigned-team">
    <div class="project-row">
      <button class="project-toggle team-toggle" type="button" data-team-toggle="${UNASSIGNED_TEAM_NODE_ID}"
        aria-expanded="${expanded}" aria-controls="team-projects-unassigned"
        title="未归属任何团队的项目；右键项目可归属到团队">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <svg class="icon lucide project-folder" aria-hidden="true"><use href="#lucide-folder"></use></svg>
        <span class="project-name">未归属</span>
        <span class="project-badge">${projects.length}</span>
      </button>
    </div>
    <ul class="project-sessions team-projects" id="team-projects-unassigned"${expanded ? "" : " hidden"}>
      ${items}
    </ul>
  </div>`;
}

// 远程项目展开空态（行内展开与点击展开共用一句话）
const REMOTE_PROJECT_EMPTY_HINT = "该远程项目暂无协作会话——行尾「写」在远端目录新建（SSH 桥执行）";

// v41 波三（§3.5）：远程项目下聚合 514cc run 台账——原生 CLI 会话文件在远端（本地扫描投影
// 看不到），run 台账含持久化远端 sessionId，resume 照常（--resume/thread/resume 经 SSH 桥）。
function remoteProjectRuns(project) {
  const remote = project.remote;
  return state.runs
    .filter((run) => run.remote && !run.archived
      && run.remote.hostId === remote.hostId && run.remote.path === remote.path) // 归档 run 不进树（与本地同纪律）
    .sort((a, b) => new Date(b.updatedAt ?? b.createdAt ?? 0) - new Date(a.updatedAt ?? a.createdAt ?? 0));
}

// 成员行用合成条目：远端原生会话不在本地投影，sessionId 来自 run 台账持久化、时间取 run 的
function remoteRunEntries(run) {
  return Object.entries(runSessionsMap(run)).map(([memberId, sessionId]) => ({
    memberId,
    session: {
      id: sessionId,
      cli: String(run.teamRoster?.find((member) => member?.id === memberId)?.runtimeProfileId || memberId).split("-")[0],
      modifiedAt: run.updatedAt ?? run.createdAt,
    },
  }));
}

// 远程项目 run 列表项（节点展开态与「展开显示」整列重渲共用）：
// Codex 式截断与本地同律（TREE_SESSIONS_CAP），超出折叠为「展开显示」行
function remoteProjectSessionItems(project) {
  const runs = remoteProjectRuns(project);
  const cap = state.showAllSessions.has(project.id) ? runs.length : TREE_SESSIONS_CAP;
  const shown = runs.slice(0, cap);
  return shown.map((run) => runConversationGroupMarkup(project, run, remoteRunEntries(run))).join("")
    + (runs.length > shown.length
      ? `<li class="sessions-showmore"><button class="sessions-showmore-button" type="button" data-sessions-showmore="${escapeHtml(project.id)}">展开显示（还有 ${runs.length - shown.length} 条）</button></li>`
      : "");
}

// 远程项目节点：globe 图标 + 主机徽标（状态点如实：已连接=台账 trusted，已停用/主机缺失压暗）+ run 台账聚合
function remoteProjectNodeMarkup(project, idSuffix, { pinned = false } = {}) {
  const pref = projectPrefOf(project);
  const remote = project.remote;
  const expanded = pinned ? state.expandedPinnedProjects.has(project.id) : state.expandedProjects.has(project.id);
  const runs = remoteProjectRuns(project);
  const sessionItems = expanded ? remoteProjectSessionItems(project) : "";
  const status = remote.hostMissing
    ? { cls: "is-off", text: "主机已移除" }
    : !remote.enabled
      ? { cls: "is-off", text: "已停用" }
      : remote.trusted
        ? { cls: "is-ok", text: "已连接" }
        : { cls: "", text: "待确认指纹" };
  const toggleAttr = pinned ? `data-pinned-project="${escapeHtml(project.id)}"` : `data-project-toggle="${escapeHtml(project.id)}"`;
  const listId = pinned ? `pinned-project-sessions-${idSuffix}` : `project-sessions-${idSuffix}`;
  return `<div class="project-node is-remote-project${pref.hidden ? " is-hidden-project" : ""}${pinned ? " pinned-project" : ""}">
    <div class="project-row">
      <button class="project-toggle" type="button" ${toggleAttr}
        aria-expanded="${expanded}" aria-controls="${listId}"
        title="${escapeHtml(`${remote.hostName}${remote.addr ? ` · ${remote.addr}` : ""}\n${remote.path}`)}">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <svg class="icon lucide project-folder" aria-hidden="true"><use href="#lucide-globe"></use></svg>
        <span class="project-name">${escapeHtml(pref.name || project.label)}</span>
        ${pref.hidden ? '<span class="hidden-badge">已隐藏</span>' : ""}
        <span class="remote-badge" title="${escapeHtml(remote.path)}"><i class="remote-dot ${status.cls}"></i>${escapeHtml(remote.hostName)} · ${escapeHtml(status.text)}</span>
        <span class="project-badge" title="协作会话数（514cc run 台账）">${runs.length}</span>
      </button>
      <button class="row-action" type="button" data-project-newsession="${escapeHtml(project.id)}"
        title="在该远程目录新建会话（远端 agent 执行）" aria-label="在「${escapeHtml(pref.name || project.label)}」的远程目录新建会话"${remote.hostMissing || !remote.enabled ? " disabled" : ""}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MENU_ICONS.rename}" /></svg>
      </button>
      ${menuTriggerMarkup("project", project.id, `打开「${pref.name || project.label}」项目菜单`)}
    </div>
    <ul class="project-sessions" id="${listId}"${expanded ? "" : " hidden"}>
      ${expanded ? (sessionItems || `<li class="project-empty">${REMOTE_PROJECT_EMPTY_HINT}</li>`) : ""}
    </ul>
  </div>`;
}

// 项目节点（团队树下）：行尾「写」图标=在此项目下新建会话
function projectNodeMarkup(project, idSuffix) {
  if (project.remoteProject) return remoteProjectNodeMarkup(project, idSuffix);
  const pref = projectPrefOf(project);
  const expanded = state.expandedProjects.has(project.id);
  const sessionItems = expanded ? sessionGroupsMarkup(project, visibleTreeSessions(project)) : "";
  return `<div class="project-node${pref.hidden ? " is-hidden-project" : ""}">
    <div class="project-row">
      <button class="project-toggle" type="button" data-project-toggle="${escapeHtml(project.id)}"
        aria-expanded="${expanded}" aria-controls="project-sessions-${idSuffix}"
        title="${escapeHtml(project.path ?? project.id)}">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        <svg class="icon lucide project-folder" aria-hidden="true"><use href="#lucide-folder"></use></svg>
        <span class="project-name">${escapeHtml(pref.name || project.label)}</span>
        ${pref.hidden ? '<span class="hidden-badge">已隐藏</span>' : ""}
        ${project.pending ? '<span class="pending-badge" title="新项目：首段对话落盘后转为正式项目">新</span>' : ""}
        <span class="project-badge">${Number(project.sessionCount) || 0}</span>
      </button>
      <button class="row-action" type="button" data-project-newsession="${escapeHtml(project.id)}"
        title="在此项目下新建会话" aria-label="在「${escapeHtml(pref.name || project.label)}」下新建会话"${project.path ? "" : " disabled"}>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${MENU_ICONS.rename}" /></svg>
      </button>
      ${menuTriggerMarkup("project", project.id, `打开「${pref.name || project.label}」项目菜单`)}
    </div>
    <ul class="project-sessions" id="project-sessions-${idSuffix}"${expanded ? "" : " hidden"}>
      ${expanded ? (sessionItems || `<li class="project-empty">无历史对话</li>`) : ""}
    </ul>
  </div>`;
}

// 原生历史会话的默认 label 常是时间戳（"08-08 16:49"/"07/17"/"2026-08-08 16:49"）——
// 标题已是日期时右侧时间纯属重复，行级去重（2026-08-09 侧栏工程波）
const DATE_TITLE_RE = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?/;

// 原生历史会话行（项目树/置顶区/已归档区共用）：别名 > 原标题；未读点；选中态；带 CLI 源
function sessionLinkMarkup(project, session) {
  const cli = session.cli ?? "claude";
  const pref = sessionPrefOf(cli, project.id, session.id);
  const selected = state.sessionPreview?.projectId === project.id && state.sessionPreview?.sessionId === session.id;
  const title = pref.alias || sessionDisplayTitle(session);
  const dateTitle = DATE_TITLE_RE.test(title.trim()) && !pref.alias; // 用户改过的别名不按日期处理
  const active = session.modifiedAt && Date.now() - new Date(session.modifiedAt).getTime() < 15 * 60 * 1000;
  return `<button class="session-link${selected ? " is-selected" : ""}${session.subagent ? " is-subagent" : ""}${dateTitle ? " is-date-title" : ""}" type="button"
    data-session-project="${escapeHtml(project.id)}" data-session-id="${escapeHtml(session.id)}"
    data-session-cli="${escapeHtml(cli)}" data-session-scope="${escapeHtml(session.scope ?? "")}"
    data-has-summary="${session.summary ? 1 : 0}"
    title="${escapeHtml(sessionDisplayTitle(session))}">
    <span class="session-title">${pref.unread ? `<span class="unread-dot" aria-label="未读"></span>` : ""}${session.subagent ? `<span class="subagent-mark" title="子代理（编排派生）会话">子</span>` : ""}${escapeHtml(title)}${active ? `<span class="live-dot" title="15 分钟内有更新"></span>` : ""}</span>
    ${dateTitle ? "" : `<span class="session-time">${escapeHtml(shortDate(session.modifiedAt))}</span>`}
  </button>`;
}

// 项目下会话分组：协作会话（Console run 硬关联）优先，未关联的按 CLI 分组
// Codex 式截断阈值：项目下会话超过 6 条时尾部块折叠为「展开显示」行
const TREE_SESSIONS_CAP = 6;

function sessionGroupsMarkup(project, sessions) {
  const linkIndex = runSessionLinkIndex();
  const linked = new Map(); // runId → { run, entries: [{ session, memberId }] }
  const unlinked = [];
  for (const session of sessions) {
    const link = findRunSessionLink(linkIndex, session.id);
    if (!link) {
      unlinked.push(session);
      continue;
    }
    if (!linked.has(link.run.id)) linked.set(link.run.id, { run: link.run, entries: [] });
    linked.get(link.run.id).entries.push({ session, memberId: link.memberId });
  }
  // 块级合成（协作组块 + CLI 组块）：截断只整块收编，不拆组内成员——
  // 归档 run 不进树（LO 2026-08-11），成员会话留在 linked 消费链里不散回未关联区
  const blocks = [...linked.values()]
    .filter(({ run }) => !run.archived)
    .sort((a, b) => runGroupLatestMs(b) - runGroupLatestMs(a))
    .map(({ run, entries }) => ({ count: entries.length, html: runConversationGroupMarkup(project, run, entries) }));
  blocks.push(...cliSessionGroupBlocks(project, unlinked));
  if (state.showAllSessions.has(project.id)) return blocks.map((block) => block.html).join("");
  // Codex 式截断（LO 2026-08-11）：超出 TREE_SESSIONS_CAP 的块折叠为一行「展开显示」，点击展开全部
  const parts = [];
  let used = 0;
  let remaining = 0;
  for (const block of blocks) {
    if (parts.length && used + block.count > TREE_SESSIONS_CAP) {
      remaining += block.count;
      continue;
    }
    parts.push(block.html);
    used += block.count;
  }
  if (remaining > 0) {
    parts.push(`<li class="sessions-showmore"><button class="sessions-showmore-button" type="button" data-sessions-showmore="${escapeHtml(project.id)}">展开显示（还有 ${remaining} 条）</button></li>`);
  }
  return parts.join("");
}

// run.sessions 归一（成员→原生会话 id）：数组形态（agentId/sessionId）与对象形态都接
function runSessionsMap(run) {
  return Array.isArray(run.sessions)
    ? Object.fromEntries(run.sessions.map((item) => [item.agentId || item.name, item.sessionId || item.id]).filter(([key, value]) => key && value))
    : (run.sessions || {});
}

// 协作会话聚合（LO 2026-08-10）：run 的 sessions 映射是"哪些原生会话属于同一逻辑会话"的
// 唯一硬关联——裸 CLI 会话没有这份记录，不猜不并（时间邻近聚类是另一个功能，需另行拍板）。
function runSessionLinkIndex() {
  const index = new Map(); // nativeSessionId → { run, memberId }
  for (const run of state.runs) {
    for (const [memberId, sessionId] of Object.entries(runSessionsMap(run))) {
      const id = String(sessionId || "");
      if (id.length >= 8 && !index.has(id)) index.set(id, { run, memberId });
    }
  }
  return index;
}

function findRunSessionLink(index, scanId) {
  const id = String(scanId || "");
  if (!id) return null;
  const exact = index.get(id);
  if (exact) return exact;
  // codex 扫描 id 是 rollout 文件名（rollout-…-<uuid>），run 里存的是 thread uuid——后缀对齐
  for (const [rid, link] of index) {
    if (id.endsWith(rid)) return link;
  }
  return null;
}

function runGroupLatestMs(group) {
  return Math.max(0, ...group.entries.map((entry) => new Date(entry.session.modifiedAt ?? 0).getTime() || 0));
}

function runMemberLabel(run, memberId) {
  return run.teamRoster?.find((member) => member?.id === memberId)?.label
    ?? (state.memberCatalog || []).find((member) => member.id === memberId)?.label
    ?? memberId;
}

// 协作会话分组（LO 2026-08-10 一致化）：组头与成员行点击都与会话列表点 run 一致——
// 直接 selectRun 打开 run 完整视图（轮次/工具卡/失败卡），不再落原生只读预览；
// 仅独立 chevron 按钮折叠/展开成员列表（默认展开，收起态存 collapsedRunGroups）。
function runConversationGroupMarkup(project, run, entries) {
  const title = String(run.title || run.prompt || "未命名任务").trim() || "未命名任务";
  const collapsed = state.collapsedRunGroups.has(run.id);
  const selected = run.id === state.selectedRunId;
  const membersId = `run-group-members-${project.id}-${run.id}`;
  const rows = entries
    .slice()
    .sort((a, b) => new Date(b.session.modifiedAt ?? 0) - new Date(a.session.modifiedAt ?? 0))
    .map(({ session, memberId }) => {
      const pref = sessionPrefOf(session.cli ?? "claude", project.id, session.id);
      const memberLabel = runMemberLabel(run, memberId);
      return `<li class="run-session-row">
      <span class="run-member-chip" title="${escapeHtml(memberId)}">${escapeHtml(memberLabel)}</span><button class="session-link run-member-link" type="button"
        data-run-select="${escapeHtml(run.id)}"
        title="${escapeHtml(`${memberLabel} · ${sessionDisplayTitle(session)}`)}（点击打开协作会话）">
        <span class="session-title">${escapeHtml(pref.alias || sessionDisplayTitle(session))}</span>
        <span class="session-time">${escapeHtml(shortDate(session.modifiedAt))}</span>
      </button>
    </li>`;
    })
    .join("");
  const latest = runGroupLatestMs({ entries });
  return `<li class="run-group">
    <div class="run-group-row">
      <button class="run-group-toggle" type="button" data-run-group-toggle="${escapeHtml(run.id)}"
        aria-expanded="${!collapsed}" aria-controls="${escapeHtml(membersId)}"
        title="${collapsed ? "展开成员对话" : "折叠成员对话"}" aria-label="${collapsed ? "展开" : "折叠"}协作会话「${escapeHtml(title)}」的成员列表">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <button class="run-group-head${selected ? " is-selected" : ""}" type="button" data-run-select="${escapeHtml(run.id)}"
        title="打开协作会话「${escapeHtml(title)}」· ${entries.length} 个成员对话">
        <span class="run-group-tag">协作</span>
        <span class="run-group-title">${escapeHtml(title)}</span>
        <span class="session-time">${latest ? escapeHtml(shortDate(new Date(latest).toISOString())) : ""}</span>
      </button>
    </div>
    <ul class="run-group-members" id="${escapeHtml(membersId)}"${collapsed ? " hidden" : ""}>
      ${rows}
    </ul>
  </li>`;
}

// 项目下未关联会话按 CLI 分组（LO 2026-07-19：一个项目下分 Claude 会话 / Codex 会话…），Claude 组优先
// 分组头可折叠（LO 2026-08-11）：与协作组同一纪律——独立 toggle 按钮 + hidden 切换，
// 收起态存 collapsedCliGroups（键 `${projectId}:${cli}`），不做全量重渲染，保焦点。
// 块接口（cliSessionGroupBlocks）：供 sessionGroupsMarkup 的 Codex 式截断整块收编——count 用于预算，html 原样落位。
function cliSessionGroupBlocks(project, sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const cli = session.cli ?? "claude";
    if (!groups.has(cli)) groups.set(cli, []);
    groups.get(cli).push(session);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === "claude" ? -1 : b[0] === "claude" ? 1 : a[0].localeCompare(b[0])));
  return ordered.map(([cli, list]) => {
    const rows = list.map((session) => `<li>${sessionLinkMarkup(project, session)}</li>`).join("");
    if (ordered.length <= 1) return { count: list.length, html: rows }; // 单 CLI 项目不出分组头，项目行自身即可折叠
    const key = `${project.id}:${cli}`;
    const collapsed = state.collapsedCliGroups.has(key);
    const membersId = `cli-group-members-${project.id}-${cli}`;
    const label = `${cliLabel(cli)} · ${list.length}`;
    return { count: list.length, html: `<li class="cli-group">
      <button class="cli-group-toggle" type="button" data-cli-group-toggle="${escapeHtml(key)}"
        aria-expanded="${!collapsed}" aria-controls="${escapeHtml(membersId)}"
        title="${collapsed ? "展开" : "折叠"}${escapeHtml(cliLabel(cli))}会话分组"
        aria-label="${collapsed ? "展开" : "折叠"}${escapeHtml(label)}会话分组">
        <svg class="icon chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>${cliIconMarkup(cli)}${escapeHtml(label)}
      </button>
      <ul class="cli-group-members" id="${escapeHtml(membersId)}"${collapsed ? " hidden" : ""}>${rows}</ul>
    </li>` };
  });
}

function cliSessionGroupsMarkup(project, sessions) {
  return cliSessionGroupBlocks(project, sessions).map((block) => block.html).join("");
}

// 展开/收起用 DOM 手术而非全量重渲染——保住 toggle 按钮上的键盘焦点（烛 R3 焦点纪律）
function toggleProject(id, button) {
  const wasExpanded = state.expandedProjects.has(id);
  if (wasExpanded) state.expandedProjects.delete(id);
  else state.expandedProjects.add(id);
  button.setAttribute("aria-expanded", String(!wasExpanded));
  const list = byId(button.getAttribute("aria-controls"));
  if (!list) return;
  if (wasExpanded) list.replaceChildren();
  else {
    const project = findProjectById(id);
    // 远程项目没有本地原生会话，展开必须走 run 台账聚合（否则永远落空态提示）
    const items = project
      ? (project.remoteProject ? remoteProjectSessionItems(project) : sessionGroupsMarkup(project, visibleTreeSessions(project)))
      : "";
    list.innerHTML = items || (project?.remoteProject
      ? `<li class="project-empty">${REMOTE_PROJECT_EMPTY_HINT}</li>`
      : `<li class="project-empty">无历史对话</li>`);
  }
  list.hidden = wasExpanded;
}

function markSelectedSessionLink(projectId, sessionId) {
  document.querySelectorAll(".session-link.is-selected").forEach((node) => node.classList.remove("is-selected"));
  if (!projectId || !sessionId) return;
  document
    .querySelector(`[data-session-project="${CSS.escape(projectId)}"][data-session-id="${CSS.escape(sessionId)}"]`)
    ?.classList.add("is-selected");
}

function syncConversationLiveContext(renderContext) {
  const liveStatus = elements["conversation-live-status"];
  if (!liveStatus || liveStatus.dataset.renderContext === renderContext) return;
  liveStatus.dataset.renderContext = renderContext;
  liveStatus.textContent = "";
}

async function openSessionPreview(projectId, sessionId, cli = "claude", scope = "") {
  const project = state.projectsData?.projects?.find((item) => item.id === projectId);
  const session = project?.sessions?.find((item) => item.id === sessionId && (item.cli ?? "claude") === cli);
  const key = `${cli}::${projectId}::${sessionId}`;
  const seq = ++state.previewSeq; // key 相同的关闭-重开竞态用递增序号区分（烛 R5 建议）
  state.sessionPreview = {
    key,
    seq,
    projectId,
    sessionId,
    cli,
    scope,
    projectLabel: project?.label ?? projectId,
    title: session ? (sessionPrefOf(cli, projectId, sessionId).alias || sessionDisplayTitle(session)) : `会话 ${String(sessionId).slice(0, 8)}`,
    loading: true,
    error: null,
    data: null,
  };
  // 打开即已读（手动标未读的提醒到此为止）；渲染在 state.sessionPreview 就位后，选中态不丢
  if (sessionPrefOf(cli, projectId, sessionId).unread) void updateSessionPref(cli, projectId, sessionId, { unread: false });
  markSelectedSessionLink(projectId, sessionId);
  renderSelectedRun();
  try {
    const data = await request(
      `/api/sessions/preview?source=${encodeURIComponent(cli)}&project=${encodeURIComponent(projectId)}&scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(sessionId)}`,
    );
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
  elements["conversation-meta"].textContent = `${preview.projectLabel} · ${cliLabel(preview.cli)} 历史会话只读预览`;
  elements["workbench-run-status"].textContent = "历史预览";
  elements["workbench-run-status"].className = "status-label is-neutral";
  elements["cancel-run-button"].disabled = true;
  setComposerMode(null); // 历史预览下胶囊回新任务模式
  const stream = elements["conversation-stream"];
  syncConversationLiveContext(`preview:${preview.key}`);
  const renderedKey = `${preview.seq}|${preview.loading}|${preview.error ?? ""}`;
  // SSE 触发的重渲染不重写预览流——避免闪烁和滚动位置被拽回（内容只在加载状态变化时更新）
  if (stream.dataset.previewKey !== renderedKey) {
    const banner = `<div class="preview-banner" role="status" data-stream-key="preview:banner">
      <span>只读预览 · ${escapeHtml(preview.projectLabel)}${preview.data?.truncated ? " · 仅显示最近消息" : ""}</span>
      <button class="text-button" type="button" data-preview-close>返回协作台</button>
    </div>`;
    let body;
    if (preview.loading) body = emptyMarkup("正在读取会话…", "从本地会话记录提取对话骨架");
    else if (preview.error) body = emptyMarkup("预览失败", preview.error);
    else if (!preview.data?.messages?.length) body = emptyMarkup("没有可预览的文本消息", "该会话只有工具事件或为空");
    else
      body = preview.data.messages
        .map((message, index, list) =>
          messageMarkup(
            {
              role: message.role,
              author: message.role === "user" ? "LO" : cliLabel(preview.cli),
              cli: message.role === "user" ? null : preview.cli,
              content: message.text,
              created_at: message.timestamp,
              key: `preview-message:${index}`,
            },
            list[index - 1]
              ? { role: list[index - 1].role, author: list[index - 1].role === "user" ? "LO" : cliLabel(preview.cli), created_at: list[index - 1].timestamp }
              : null,
          ),
        )
        .join("");
    replaceConversationStream(banner + body, `preview:${preview.key}`, { renderSignature: renderedKey });
    stream.dataset.previewKey = renderedKey;
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
    hint.textContent = `会话将归属已有项目「${existing.label}」（${existing.sessionCount} 个历史会话）。`;
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
  selectSessionDialogType("local"); // 每次打开回本地模式；远程卡可用性由台账加载后异步刷新
  void loadSessionRemoteHosts();
  elements["session-cwd-input"].value = state.pendingCwd || "";
  elements["session-name-input"].dataset.touched = "";
  syncSessionNameFromCwd(true);
  updateSessionCwdHint();
  renderSessionDirpick();
  // 已定地址（笔按钮/继续任务等入口带 pendingCwd）直进第二步；否则从类型选择开始
  setSessionDialogStep(state.pendingCwd ? "info" : "type");
  const dialog = elements["session-dialog"];
  if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
  (state.pendingCwd ? elements["session-cwd-input"] : elements["session-next-button"]).focus();
  // 项目数据未就绪（刚进页面）时补拉一次，datalist 与归属判断都吃到完整清单
  if (!state.projectsData?.projects?.length) {
    await loadProjects().catch(() => {});
    fillPaths();
    updateSessionCwdHint();
  }
}

// Codex 式两步向导：步骤切换（按钮显隐 + 标题如实跟随）
function setSessionDialogStep(step) {
  const isType = step === "type";
  elements["session-step-type"].hidden = !isType;
  elements["session-step-info"].hidden = isType;
  elements["session-prev-button"].hidden = isType;
  elements["session-next-button"].hidden = !isType;
  elements["session-submit-button"].hidden = isType;
  syncSessionDialogMode();
}

// 会话类型（本地/远程）：卡片视觉与状态记录集中在这一处；远程不可用由 card.disabled 拦在上一层
function selectSessionDialogType(type) {
  state.sessionDialogType = type === "remote" ? "remote" : "local";
  for (const peer of elements["session-step-type"].querySelectorAll("[data-session-type]")) {
    const on = peer.dataset.sessionType === state.sessionDialogType;
    peer.classList.toggle("is-selected", on);
    peer.setAttribute("aria-pressed", String(on));
    peer.querySelector(".boot-type-radio")?.classList.toggle("is-on", on);
  }
  syncSessionDialogMode();
}

// 远程主机台账 → 远程卡可用性：门闸未开 / 零可用主机保持禁用并如实徽标；有可用主机放开并填充下拉
async function loadSessionRemoteHosts() {
  const card = elements["session-step-type"].querySelector('[data-session-type="remote"]');
  const badge = elements["session-remote-badge"];
  const select = elements["session-remote-host"];
  if (!card || !badge || !select) return;
  const block = (text) => {
    state.sessionRemoteHosts = [];
    card.disabled = true;
    badge.hidden = false;
    badge.textContent = text;
    if (state.sessionDialogType === "remote") selectSessionDialogType("local");
  };
  try {
    const hosts = (await request("/api/ssh/hosts"))?.hosts ?? [];
    const usable = hosts.filter((host) => host.enabled !== false);
    if (!usable.length) {
      block(hosts.length ? "已全部停用" : "无可用连接");
      return;
    }
    state.sessionRemoteHosts = usable;
    card.disabled = false;
    badge.hidden = true;
    select.innerHTML = usable
      .map((host) => `<option value="${escapeHtml(host.id)}">${escapeHtml(host.name)} · ${escapeHtml(`${host.user}@${host.host}:${host.port}`)}</option>`)
      .join("");
  } catch (error) {
    block(/REMOTE_GATE/.test(error?.message || "") ? "门闸未开放" : "加载失败");
  }
}

// 模式感知：第二步字段组、必填、标题与提交文案如实跟随（远程 = 新建远程项目登记，不假装远程 agent）
function syncSessionDialogMode() {
  const remote = state.sessionDialogType === "remote";
  elements["session-local-fields"].hidden = remote;
  elements["session-remote-fields"].hidden = !remote;
  elements["session-cwd-input"].required = !remote;
  elements["session-dialog-title"].textContent = remote ? "新建远程项目" : "创建项目";
  elements["session-submit-button"].textContent = remote ? "添加项目" : "开始新会话";
  // 进入远程第二步即开始目录浏览（loadRemoteBrowser 内部按 hostId+path 去重，重复触发幂等）
  if (remote && !elements["session-step-info"].hidden) void loadRemoteBrowser();
}

// ===== 远程项目：SFTP 目录浏览（源文件夹选择器，参考 Codex「新建远程项目」） =====
function sessionRemoteHostSelected() {
  const hostId = elements["session-remote-host"]?.value;
  return (state.sessionRemoteHosts ?? []).find((entry) => entry.id === hostId) ?? null;
}

function remotePathJoin(base, name) {
  return `${String(base || "/").replace(/\/+$/, "")}/${name}`;
}

function remotePathParent(path) {
  const trimmed = String(path || "/").replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index <= 0 ? "/" : trimmed.slice(0, index);
}

// 远程项目名默认取目录名；用户手改过（touched）就不覆盖
function syncRemoteNameFromPath(force = false) {
  const input = elements["session-remote-name"];
  if (!input) return;
  if (!force && input.dataset.touched === "1") return;
  const value = elements["session-remote-path"].value.trim();
  input.value = value ? String(value).replace(/\/+$/, "").split("/").pop() || "" : "";
}

async function loadRemoteBrowser({ force = false } = {}) {
  const host = sessionRemoteHostSelected();
  const browser = elements["session-remote-browser"];
  if (!host || !browser) return;
  const pathInput = elements["session-remote-path"];
  let path = pathInput.value.trim();
  if (!path) {
    path = `/home/${host.user}`; // 与 ssh.mjs 围栏默认 home 同源
    pathInput.value = path;
  }
  const key = `${host.id}:${path}`;
  const browse = (state.sessionRemoteBrowse ??= { key: "", items: [], loading: false, error: null });
  if (!force && browse.key === key && (browse.loading || browse.error || browse.items.length)) {
    renderRemoteBrowser();
    return;
  }
  browse.key = key;
  browse.loading = true;
  browse.error = null;
  renderRemoteBrowser();
  try {
    const result = await request(`/api/ssh/hosts/${encodeURIComponent(host.id)}/sftp/list?path=${encodeURIComponent(path)}`);
    if (browse.key !== key) return; // 等待期间目标已变，丢弃过期响应
    browse.items = (result?.items ?? [])
      .filter((item) => item.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));
    browse.error = null;
  } catch (error) {
    if (browse.key !== key) return;
    browse.items = [];
    browse.error = /REMOTE_GATE/.test(error?.message || "")
      ? "SFTP 门闸未开放，目录浏览不可用——可手动输入路径直接登记。"
      : `列目录失败：${error.message}（可手动输入路径直接登记）`;
  } finally {
    if (browse.key === key) {
      browse.loading = false;
      renderRemoteBrowser();
    }
  }
}

function renderRemoteBrowser() {
  const browser = elements["session-remote-browser"];
  const browse = state.sessionRemoteBrowse;
  if (!browser || !browse) return;
  if (browse.loading) {
    browser.innerHTML = `<p class="remote-browser-tip">正在列目录…</p>`;
    return;
  }
  if (browse.error) {
    browser.innerHTML = `<p class="remote-browser-tip is-error">${escapeHtml(browse.error)}</p>`;
    return;
  }
  browser.innerHTML = browse.items.length
    ? browse.items.map((item) => `<button type="button" class="remote-browser-item" data-remote-cd="${escapeHtml(item.name)}"><svg class="icon lucide" aria-hidden="true"><use href="#lucide-folder"></use></svg><span>${escapeHtml(item.name)}</span></button>`).join("")
    : `<p class="remote-browser-tip">该目录下没有子目录——可直接登记当前路径。</p>`;
}

// 源文件夹选择区：地址存在显示路径实线卡，否则虚线「添加可读取和编辑的文件夹」
function renderSessionDirpick() {
  const area = elements["session-dirpick"];
  if (!area) return;
  const value = elements["session-cwd-input"].value.trim();
  area.classList.toggle("has-dir", Boolean(value));
  area.innerHTML = value
    ? `<svg class="icon lucide" aria-hidden="true"><use href="#lucide-folder"></use></svg><code>${escapeHtml(value)}</code>`
    : `<svg class="icon lucide" aria-hidden="true"><use href="#lucide-folder-open"></use></svg><span>添加可读取和编辑的文件夹</span>`;
}

// 项目名称默认取目录名；用户手改过（touched）就不覆盖
function syncSessionNameFromCwd(force = false) {
  const input = elements["session-name-input"];
  if (!input) return;
  if (!force && input.dataset.touched === "1") return;
  const value = elements["session-cwd-input"].value.trim();
  input.value = value ? String(value).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "" : "";
}

function confirmSessionDialog(event) {
  event.preventDefault();
  if (state.sessionDialogType === "remote") {
    void confirmRemoteSessionDialog();
    return;
  }
  const value = elements["session-cwd-input"].value.trim();
  if (!value) {
    toast("项目地址必填", "error");
    return;
  }
  state.pendingCwd = value;
  state.pendingRemote = null; // 对话框选的是本地目录——与远程位置互斥
  const existing = matchExistingProject(value);
  const pending = existing ? null : addPendingProject(value); // 新目录：项目立刻上树，不等第一段对话落盘
  if (pending) {
    // 项目名称（新目录生效）：默认取目录名，用户改过才写显示名 pref
    const name = elements["session-name-input"].value.trim();
    if (name && name !== pending.label) void updateProjectPref(pending, { name });
  }
  elements["session-dialog"].close();
  // 开新会话：退出续聊模式，胶囊回新任务形态并带地址徽标；会话区弹 agent 徽标选择器
  state.selectedRunId = null;
  state.selectionClearedByUser = true;
  state.activeTabKey = null;
  persistTabs();
  renderTabs();
  state.agentPickerOpen = true;
  renderRuns();
  toast(existing ? `新会话将归属项目「${existing.label}」` : "新会话将在该地址创建新项目", "success");
  elements["task-input"].focus({ preventScroll: true });
}

// 远程流：POST /api/remote-projects 登记（不连网）→ 关框刷新项目树，远程项目立刻上树
async function confirmRemoteSessionDialog() {
  const hostId = elements["session-remote-host"].value;
  const host = (state.sessionRemoteHosts ?? []).find((entry) => entry.id === hostId);
  if (!host) {
    toast("请选择远程主机", "error");
    return;
  }
  const path = elements["session-remote-path"].value.trim();
  if (!path) {
    toast("源文件夹必填——从目录浏览点选或手动输入", "error");
    return;
  }
  const nameInput = elements["session-remote-name"];
  const name = nameInput.value.trim() || String(path).replace(/\/+$/, "").split("/").pop() || path;
  const submit = elements["session-submit-button"];
  submit.disabled = true;
  try {
    const result = await request("/api/remote-projects", { method: "POST", body: JSON.stringify({ name, hostId, path }) });
    elements["session-dialog"].close();
    nameInput.value = "";
    nameInput.dataset.touched = "";
    state.sessionRemoteBrowse = null; // 下次打开按新台账重来
    await loadProjects();
    toast(`已登记远程项目「${result?.project?.name ?? name}」（${host.name}）`, "success");
  } catch (error) {
    toast(`登记远程项目失败:${error.message}`, "error");
  } finally {
    submit.disabled = false;
  }
}

// 远程项目 → SSH 终端：复用 pty ssh 面（服务端 spawn 本机 OpenSSH，认证/指纹吃系统 known_hosts）
async function openRemoteTerminalForProject(project) {
  const remote = project?.remote;
  if (!remote) return;
  try {
    const result = await request("/api/pty", {
      method: "POST",
      body: JSON.stringify({ ssh: { hostId: remote.hostId, path: remote.path }, title: `${project.label} · ${remote.path}` }),
    });
    // 已挂载的终端面板直接 attach 新页签；未挂载的由视图可见时 mount 全量列出
    window.dispatchEvent(new CustomEvent("forge:pty-session-created", { detail: { session: result?.session } }));
    setView("terminal");
    toast(`已打开「${project.label}」的远程终端`, "success");
  } catch (error) {
    toast(`打开远程终端失败:${error.message}`, "error");
  }
}

// 乐观项目：选定目录即上树（LO 拍板：选目录→项目立即出现，不等对话开始）。
// 团队从属=当前 composer 选中团队（预写 pref，扫描项目出现后同路径自动让位、从属已就位）；
// 曾被移除（hidden）的同路径项目重新选用时顺手取消隐藏——否则树里看不见
function addPendingProject(path) {
  const key = normalizePathKey(path);
  if (!key || state.pendingProjects.some((project) => normalizePathKey(project.path) === key)) return;
  const label = String(path).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
  const pending = {
    id: `pending-${key}`,
    path,
    label,
    sessionCount: 0,
    sessions: [],
    pending: true, // 乐观标记：渲染「新」徽标 + 「近期」过滤豁免
  };
  state.pendingProjects.push(pending);
  persistPendingProjects();
  void updateProjectPref(pending, { teamId: state.selectedTeamId || defaultTeamId(), hidden: false });
  renderProjects();
  return pending;
}

// 任务创建时的自动归属（严格归属制）：只填未归属——显式归属其他团队的项目不抢，
// 避免"在 A 团队建了个任务，B 团队的项目被静默迁走"。归属是创建动作的如实记录，不是猜测。
function assignCwdProjectToTeam(cwd, teamId) {
  const key = normalizePathKey(cwd);
  if (!key || !teamById(teamId)) return;
  const project = matchExistingProject(cwd)
    ?? state.pendingProjects.find((item) => normalizePathKey(item.path) === key);
  if (!project || explicitProjectTeamId(project) !== null) return;
  void updateProjectPref(project, { teamId });
}

// ===== 多 CLI 团队脉搏（页头 + 全局状态栏共用）=====
function teamPulseMembers() {
  const team = currentTeam() || teamById(state.selectedTeamId) || state.teams.find((item) => item.builtin);
  const members = team?.members?.length
    ? team.members
    : ["claude-fable", "codex-technical", "grok-search", "kimi-frontend", "pi-resident"];
  const healthList = Array.isArray(state.health?.components)
    ? state.health.components
    : Array.isArray(state.components) ? state.components : [];
  const healthById = new Map(healthList.map((item) => [String(item.id ?? item.name ?? "").toLowerCase(), item]));
  const run = selectedRun();
  const activeAgents = new Set((run?.turns || []).map((turn) => turn.agentId).filter(Boolean));
  if (run?.startAgentId) activeAgents.add(run.startAgentId);
  if (run?.coordinatorId) activeAgents.add(run.coordinatorId);
  return members.map((id) => {
    const cli = agentCli(id);
    const health = healthById.get(String(id).toLowerCase())
      || healthById.get(String(cli || "").toLowerCase())
      || null;
    let tone = "unknown";
    if (health?.status === "ok" || health?.status === "healthy" || health?.available === true) tone = "ok";
    else if (health?.status === "error" || health?.status === "failed" || health?.available === false) tone = "error";
    else if (health?.status === "warning" || health?.status === "degraded" || health?.status === "dormant") tone = "warn";
    if (activeAgents.has(id) && ACTIVE_RUN_STATES.has(run?.status)) tone = "live";
    return {
      id,
      label: agentLabel(id),
      cli: cliLabel(cli),
      logo: cli ? cliIconMarkup(cli, "cli-logo") : "",
      tone,
      active: activeAgents.has(id),
      isLeader: id === (team?.coordinator || members[0]),
    };
  });
}

function renderTeamPulse() {
  const members = teamPulseMembers();
  const chips = members.map((member) => `
    <span class="team-pulse-chip is-${escapeHtml(member.tone)}${member.active ? " is-active" : ""}${member.isLeader ? " is-leader" : ""} is-agent-${agentSlug(member.id)}"
      title="${escapeHtml(`${member.label} · ${member.cli || "—"}${member.isLeader ? " · leader" : ""}${member.active ? " · 本会话参与" : ""}`)}">
      ${member.logo || `<span class="team-pulse-fallback">${escapeHtml((AGENT_SHORT[member.id] || member.label).slice(0, 2))}</span>`}
      <span class="team-pulse-name">${escapeHtml(AGENT_SHORT[member.id] || member.label.slice(0, 2))}</span>
    </span>`).join("");
  const live = members.filter((item) => item.tone === "live" || item.tone === "ok").length;
  const workbench = byId("workbench-team-pulse");
  if (workbench) {
    workbench.innerHTML = chips
      ? `${chips}<span class="team-pulse-count" title="在线/席位">${live}/${members.length}</span>`
      : `<span class="subtle">团队加载中</span>`;
  }
  const global = byId("global-team-pulse");
  if (global) {
    global.innerHTML = `${chips}<span class="team-pulse-count">${live}/${members.length}</span>`;
    global.title = members.map((item) => `${item.label}: ${item.tone}`).join(" · ");
  }
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
  // 用量：选中 run 各轮累计 token（对 200k 上下文的百分比）+ 成本（后端 costUsdTotal 权威值优先）
  const totalTokens = (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.tokens) || 0), 0);
  const totalCost = Number(run?.costUsdTotal) || (run?.turns || []).reduce((sum, turn) => sum + (Number(turn.costUsd) || 0), 0);
  const tokensText = totalTokens
    ? `${((totalTokens / 200000) * 100).toFixed(1)}% · ${(totalTokens / 1000).toFixed(1)}k tokens${totalCost ? ` · $${totalCost.toFixed(2)}` : ""}`
    : "0 tokens";
  const team = currentTeam();
  const memberCount = team?.members?.length || teamPulseMembers().length;
  const permission = run?.permissionMode || elements["task-permission"]?.value || "plan";
  // 2026-08-09 侧栏工程波⑤：值统一包 .sl-text 供 CSS 省略；团队段独占一行（全量信息本就在 bar.title）
  const seg = (icon, text, cls = "") =>
    `<span class="sl-seg${cls}"><span class="sl-icon">${lucideIcon(icon)}</span><span class="sl-text">${escapeHtml(text)}</span></span>`;
  const segments = [
    seg("cpu", modelShort, " sl-seg-model"),
    seg("folder", cwdShort),
    `<span class="sl-seg sl-seg-tokens"><span class="sl-icon">${lucideIcon("gauge")}</span><span class="sl-text sl-dim">${escapeHtml(tokensText)}</span></span>`,
    seg("users", `${team?.name ?? "514cc"} · ${memberCount} CLI`, " sl-seg-team"),
    seg("shield", permission, " sl-seg-perm"),
  ];
  if (run?.worktreePath) {
    segments.push(seg("git-branch", String(run.worktreePath).split(/[\\/]/).pop(), " sl-seg-worktree"));
  }
  if (state.projectPrefsStatus === "loading") {
    segments.push(`<span class="sl-seg" data-project-prefs-lock><span class="sl-icon">${lucideIcon("refresh-cw")}</span><span class="sl-text">偏好读取中</span></span>`);
  } else if (state.projectPrefsStatus === "error") {
    segments.push(`<span class="sl-seg" data-project-prefs-lock><span class="sl-icon">${lucideIcon("shield")}</span><span class="sl-text">${projectPrefsPendingSave ? "偏好写入锁定 · 本地修改待重试" : "偏好写入锁定"}</span></span>`);
  }
  bar.innerHTML = segments.join("");
  bar.dataset.projectPrefsStatus = state.projectPrefsStatus;
  bar.title = [
    `模型 ${model} · 地址 ${cwd} · 团队 ${team?.name ?? "514cc"} · 权限 ${permission}`,
    run?.worktreePath ? `工作树 ${run.worktreePath}` : "",
    state.projectPrefsStatus === "error" ? `项目偏好写入锁定：${state.projectPrefsError || "权威状态不可用"}` : "",
  ].filter(Boolean).join("\n");
  renderTeamPulse();
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

// 内联审批卡只表示一次待决动作。执行 Lease 由 Orchestrator 单独签发、持久化和查询。
function approvalCardMarkup(item) {
  const method = String(item.method ?? "unknown");
  const broadPermission = method === "item/permissions/requestApproval"; // v1 不支持广域授权——与安全诊断页同口径禁批
  const run = state.runs.find((entry) => entry.id === item.runId);
  const scopeBits = [
    run?.permissionMode ? `模式 ${permissionModeMeta(run.permissionMode, run.permissionMode).short}` : null,
    run?.worktreePath ? "绑定隔离工作树" : run?.cwd ? "绑定会话 cwd" : "作用域：控制面策略",
    item.agentId ? `Agent ${item.agentId}` : null,
  ].filter(Boolean);
  return `
    <article class="approval-inline" data-stream-key="approval:${escapeHtml(item.id)}">
      <div class="approval-inline-head">
        <strong>动作审批 · 待处理</strong>
        <span class="approval-inline-method">${escapeHtml(method)}</span>
        <span class="approval-inline-countdown">审批窗口 <time data-approval-expires="${escapeHtml(item.expiresAt ?? "")}">${approvalCountdownText(item.expiresAt)}</time></span>
      </div>
      <p class="lease-scope">${escapeHtml(scopeBits.join(" · "))}</p>
      ${approvalParamsMarkup(item)}
      <div class="approval-inline-hash">动作哈希 <code title="${escapeHtml(item.actionSha256 ?? "")}">${escapeHtml(compactHash(item.actionSha256))}</code>（批准只释放当前请求；持续写权限仍由执行租约单独约束）</div>
      <div class="approval-inline-actions">
        <button class="button secondary" type="button" data-inline-approval-id="${escapeHtml(item.id)}" data-inline-approval-decision="deny">拒绝</button>
        <button class="button primary" type="button" data-inline-approval-id="${escapeHtml(item.id)}" data-inline-approval-decision="approve"${broadPermission ? " disabled title=\"v1 不支持广域权限授权\"" : ""}>批准</button>
      </div>
    </article>`;
}

function capabilityLeaseMarkup(lease, { inline = true } = {}) {
  const status = String(lease?.status || "unknown");
  const effective = lease?.gateOpen === true ? "active" : status === "active" ? "invalid" : status;
  const statusText = {
    active: "执行租约有效",
    revoked: "执行租约已吊销",
    expired: "执行租约已过期",
    invalid: "执行租约绑定失效",
  }[effective] || "执行租约状态未知";
  const classes = inline ? "approval-inline capability-lease" : "approval-row capability-lease-row";
  return `
    <article class="${classes}" data-stream-key="lease:${escapeHtml(lease.id)}">
      <div class="approval-inline-head">
        <strong>${escapeHtml(statusText)}</strong>
        <span class="approval-inline-method">${escapeHtml(lease.id)}</span>
        <span class="approval-inline-countdown">到期 ${escapeHtml(formatDate(lease.expiresAt))}</span>
      </div>
      <p class="lease-scope">Run ${escapeHtml(lease.runId || "--")} · ${escapeHtml(lease.scope || "action-bound")} · approval ${escapeHtml(lease.approvalId || "未关联")}</p>
      <div class="approval-inline-hash">动作哈希 <code title="${escapeHtml(lease.actionSha256 || "")}">${escapeHtml(compactHash(lease.actionSha256))}</code>${lease.invalidReason ? ` · ${escapeHtml(lease.invalidReason)}` : ""}</div>
      ${status === "active" ? `<div class="approval-inline-actions"><button class="button secondary" type="button" data-lease-revoke-run="${escapeHtml(lease.runId)}">吊销执行租约</button></div>` : ""}
    </article>`;
}

// 内联决议结果：approvalId → { runId, decision }——决议后卡片折叠为"已批准/已拒绝"一行留在会话流里
const inlineApprovalOutcomes = new Map();

function inlineApprovalsMarkup(run) {
  // 已决议按结果聚合：逐条堆叠会在多轮审批后把流尾刷成一列「已批准」（LO 2026-08-10）——
  // 审计语义保留（次数 + 最近时间），拒绝单独一行（fail-closed 信号不折叠进批准里）
  const outcomes = [...inlineApprovalOutcomes.values()].filter((entry) => entry.runId === run.id);
  const resolved = ["approve", "deny"].map((decision) => {
    const group = outcomes.filter((entry) => entry.decision === decision);
    if (!group.length) return "";
    const approved = decision === "approve";
    const latest = group.map((entry) => entry.resolvedAt).filter(Boolean).sort().at(-1);
    const countText = group.length > 1 ? ` ×${group.length}` : "";
    const timeText = latest ? ` · 最近 ${escapeHtml(formatTime(latest))}` : "";
    return `<div class="approval-resolved-line ${approved ? "is-approved" : "is-denied"}" data-stream-key="approval-result:${decision}:${escapeHtml(run.id)}">${approved ? `${lucideIcon("shield-check", "icon lucide")} 动作审批已批准${countText}` : `${lucideIcon("x", "icon lucide")} 动作审批已拒绝${countText}`}${timeText}</div>`;
  });
  const leases = state.leases.filter((lease) => lease.runId === run.id).map((lease) => capabilityLeaseMarkup(lease));
  // 等待审批（run build 授权）与轮中审批（codex command/file 请求）都挂在会话流末尾
  const pending = state.approvals.filter((item) => item.runId === run.id && (item.status ?? "pending") === "pending");
  return [...resolved, ...leases, ...pending.map(approvalCardMarkup)].join("");
}

// 内联审批决议：跳过 confirmAction 二次弹窗——actionSha256 随请求回传、服务端哈希校验已是防误触护栏
async function resolveInlineApproval(id, decision) {
  const item = state.approvals.find((approval) => approval.id === id);
  if (!item) return;
  const buttons = [...document.querySelectorAll(`[data-inline-approval-id="${CSS.escape(id)}"]`)];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const result = await request(`${API.approvals}/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { decision, actionSha256: item.actionSha256, actor: "control-center" },
    });
    inlineApprovalOutcomes.set(id, {
      runId: item.runId,
      decision,
      resolvedAt: new Date().toISOString(),
    });
    toast(
      decision === "approve"
        ? result?.lease?.id
          ? `动作已批准，执行租约已签发 · ${String(result.lease.id).slice(0, 16)}`
          : "动作已批准"
        : "动作已拒绝",
      decision === "approve" ? "success" : "warning",
    );
    appendDiagnostic(`内联审批 ${decision} ${id}${result?.lease?.id ? ` authoritativeLease=${result.lease.id}` : ""}`);
    await loadApprovals();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`内联审批处理失败 ${id}: ${error.message}`, "error");
    buttons.forEach((button) => { button.disabled = false; });
    await loadApprovals().catch(() => {});
  }
}

async function revokeCapabilityLease(runId) {
  const confirmed = await confirmAction({
    eyebrow: "执行权限",
    title: "吊销此执行租约？",
    rows: [["Run ID", runId], ["影响", "后续 workspace-write 派发将 fail-closed"]],
    warning: "正在执行的原生 turn 不会被强制终止；吊销对下一次写派发生效。",
    confirmLabel: "确认吊销",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await request(`${API.runs}/${encodeURIComponent(runId)}/lease/revoke`, {
      method: "POST",
      body: { reason: "operator-revoke", actor: "control-center" },
    });
    toast("执行租约已吊销", "warning");
    await loadApprovals();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`执行租约吊销失败 ${runId}: ${error.message}`, "error");
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
  // 对象 sessions 与 normalize 后的数组都支持
  const sessionMap = Array.isArray(run.sessions)
    ? Object.fromEntries(run.sessions.map((item) => [item.agentId || item.name, item.sessionId || item.id]).filter(([k, v]) => k && v))
    : (run.sessions || {});
  const hints = resumeHintsFromSessions(sessionMap);
  const hintsHtml = resumeHintsMarkup(hints, { escapeHtml });
  bar.hidden = false;
  bar.innerHTML = `
    <span class="recovery-note">${escapeHtml(redact(note))}</span>
    ${hintsHtml}
    ${acked
      ? `<span class="recovery-acked">${lucideIcon("check", "icon lucide")} 已确认——下次发送将自动继续</span>`
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

// 终态原因：failed/cancelled 时把 run.error / run.recoveryNote 挂到会话流末尾（normalizeRun ...item 已透传）。
// 失败附"重新发起"——prompt 一键回填 composer 新任务模式，不用手动复制
function runFailureMarkup(run) {
  if (!["failed", "cancelled", "canceled"].includes(run.status)) return "";
  const reasons = [...new Set([run.error, run.recoveryNote].map((text) => String(text ?? "").trim()).filter(Boolean))];
  if (!reasons.length) return "";
  const failed = run.status === "failed";
  return `
    <div class="run-end-note ${failed ? "is-failed" : "is-cancelled"}" data-stream-key="tail:failure">
      <strong>${failed ? "任务失败" : "任务已取消"}</strong>
      ${reasons.map((reason) => `<span>${escapeHtml(redact(reason))}</span>`).join("")}
      ${failed ? `<button class="button secondary retry-run-button" type="button" data-retry-run="${escapeHtml(run.id)}">以同一任务重新发起</button>` : ""}
      ${run.worktreePath ? "" : runDiffButtonMarkup(run)}
    </div>
    ${worktreeSettlementMarkup(run)}`;
}

// run 产物 diff（codeg 对标 P2）：有隔离工作树的终态 run 可查看产物比对——按钮挂完成/失败卡，
// 面板挂会话流尾部；内容服务端已脱敏+截断（>200KB 标截断）
function runDiffButtonMarkup(run) {
  if (!run.worktreePath || !TERMINAL_RUN_STATES.has(run.status)) return "";
  const open = state.runDiffView?.runId === run.id;
  return `<button class="text-button" type="button" data-run-diff="${escapeHtml(run.id)}">${open ? "收起产物 diff" : "产物 diff"}</button>`;
}

// EX-07 结算入口（读模型）：终态 worktree 给出核对 / 续跑 / 复制路径 / git 命令，不静默 merge
function worktreeSettlementMarkup(run) {
  if (!run.worktreePath || !TERMINAL_RUN_STATES.has(run.status)) return "";
  const leaf = String(run.worktreePath).split(/[\\/]/).pop();
  const sessionMap = Array.isArray(run.sessions)
    ? Object.fromEntries(run.sessions.map((item) => [item.agentId || item.name, item.sessionId || item.id]).filter(([k, v]) => k && v))
    : (run.sessions || {});
  const hintsHtml = resumeHintsMarkup(resumeHintsFromSessions(sessionMap), { escapeHtml });
  const gitCommands = [
    `cd "${run.worktreePath}"`,
    "git status",
    "git diff --stat",
  ].join("\n");
  return `
    <div class="settlement-card" data-stream-key="tail:settlement">
      <div class="settlement-head">
        <strong>工作树结算</strong>
        <span class="subtle" title="${escapeHtml(run.worktreePath)}">${lucideIcon("git-branch", "icon lucide")} ${escapeHtml(leaf)}</span>
      </div>
      <p class="settlement-copy">改动仍在隔离工作树。先核对 diff，再决定是否在新任务/新工作树中继续——不会自动合并到主目录。</p>
      <div class="settlement-actions">
        ${runDiffButtonMarkup(run)}
        <button class="text-button" type="button" data-settlement-continue-worktree="${escapeHtml(run.id)}">在新工作树继续</button>
        <button class="text-button" type="button" data-settlement-copy-path="${escapeHtml(run.worktreePath)}">复制路径</button>
        <button class="text-button" type="button" data-settlement-copy-git="${escapeHtml(gitCommands)}">复制 git 命令</button>
        <button class="text-button" type="button" data-settlement-reveal="${escapeHtml(run.worktreePath)}">打开资源管理器</button>
      </div>
      ${hintsHtml}
    </div>`;
}

function runDiffPanelMarkup(run) {
  const view = state.runDiffView;
  if (!view || view.runId !== run.id) return "";
  if (view.status === "loading") return `<div class="run-diff-panel" data-stream-key="tail:diff"><span class="subtle">正在读取工作树产物…</span></div>`;
  if (view.status === "error") return `<div class="run-diff-panel is-error" data-stream-key="tail:diff"><span>产物 diff 读取失败：${escapeHtml(view.error)}</span></div>`;
  const { data } = view;
  const statusLines = String(data.status ?? "").trim();
  const clean = !statusLines && !String(data.diff ?? "").trim();
  return `
    <div class="run-diff-panel" data-stream-key="tail:diff">
      <div class="run-diff-head">
        <strong>产物 diff</strong>
        <span class="subtle" title="${escapeHtml(data.worktree)}">${lucideIcon("git-branch", "icon lucide")} ${escapeHtml(String(data.worktree ?? "").split(/[\\/]/).pop())} · 与主仓库 HEAD 比对${data.truncated ? " · 已截断" : ""}</span>
      </div>
      ${clean ? '<p class="subtle">工作树相对主仓库无改动——agent 未落盘或改动已在别处。</p>' : ""}
      ${statusLines ? `<pre class="run-diff-status" aria-label="工作树状态">${escapeHtml(statusLines)}</pre>` : ""}
      ${data.stat?.trim() ? `<pre class="run-diff-stat" aria-label="改动统计">${escapeHtml(data.stat.trim())}</pre>` : ""}
      ${data.diff?.trim() ? `<pre class="run-diff-body" aria-label="diff 正文">${escapeHtml(data.diff)}</pre>` : ""}
    </div>`;
}

// ask 回答卡：回答动作先切回提问成员标签，再聚焦输入框，保证标签与 wire recipient 一致。
// 终态防残留：cancelled/failed 的旧 pendingAsk（后端修复前的历史 run）不再渲染回答卡
function pendingAskMarkup(run) {
  if (!run.pendingAsk || TERMINAL_RUN_STATES.has(run.status)) return "";
  const question = redact(String(run.pendingAsk.text ?? ""));
  const askerId = String(run.pendingAsk.from ?? "").trim();
  const answerable = askerId && (run.teamMembers || []).includes(askerId);
  return `
    <div class="ask-card" data-stream-key="tail:ask">
      <div class="ask-card-head">
        <span class="ask-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(agentLabel(askerId))} 在等你拍板</strong>
        <time>${escapeHtml(formatTime(run.pendingAsk.at))}</time>
      </div>
      <p class="ask-card-question">${escapeHtml(question)}</p>
      ${answerable
        ? `<button class="button primary" type="button" data-focus-answer="${escapeHtml(askerId)}">切到 ${escapeHtml(agentLabel(askerId))} 回答</button>`
        : '<button class="button primary" type="button" disabled title="问题来源不属于当前团队">问题来源不可用</button>'}
    </div>`;
}

// 完成收尾卡：succeeded 且有多轮协作时的收口统计——轮次/token/成本合计 + 参与成员。
// 最终结论本身就是流里最后一条 assistant 消息，卡片只做"确认收口"不重复正文
function runCompletionMarkup(run) {
  if (!["succeeded", "completed", "complete"].includes(run.status)) return "";
  const turns = run.turns ?? [];
  if (!turns.length) return "";
  const totalTokens = turns.reduce((sum, turn) => sum + (Number(turn.tokens) || 0), 0);
  const totalCost = Number(run.costUsdTotal) || turns.reduce((sum, turn) => sum + (Number(turn.costUsd) || 0), 0);
  const agents = [...new Set(turns.map((turn) => turn.agentId).filter(Boolean))].map((id) => agentLabel(id));
  const parts = [`${turns.length} 轮协作`, agents.join(" · ")];
  if (totalTokens) parts.push(totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k tokens` : `${totalTokens} tokens`);
  if (totalCost) parts.push(`$${totalCost.toFixed(2)}`);
  return `
    <div class="run-end-note is-succeeded" data-stream-key="tail:completion">
      <strong>${lucideIcon("check", "icon lucide")} 任务完成</strong>
      <span>${escapeHtml(parts.filter(Boolean).join(" · "))}</span>
      ${run.worktreePath ? "" : runDiffButtonMarkup(run)}
    </div>
    ${worktreeSettlementMarkup(run)}`;
}

// 失败任务重新发起：prompt 回填 composer 并切到新任务模式（不自动提交——LO 可先改再发）
function retryRun(id) {
  const run = state.runs.find((item) => item.id === id);
  if (!run?.prompt) return;
  state.selectedRunId = null;
  state.selectionClearedByUser = true;
  state.sessionPreview = null;
  elements["task-input"].value = run.prompt;
  renderRuns();
  elements["task-input"].focus({ preventScroll: true });
  toast("任务内容已回填，确认后发送", "info");
}

// 胶囊 composer 双模式：run=null → 新任务；run → 续聊当前原生会话（一个输入框，语义随上下文切换）
function renderAttachments() {
  const box = elements["attach-chips"];
  box.hidden = !state.attachments.length;
  box.innerHTML = state.attachments
    .map((path, index) => {
      const name = String(path).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
      return `<span class="attach-chip" title="${escapeHtml(path)}">${lucideIcon("paperclip")}<span>${escapeHtml(name)}</span><button type="button" data-detach="${index}" aria-label="移除附件 ${escapeHtml(name)}">${lucideIcon("x")}</button></span>`;
    })
    .join("");
  workbenchEnvironmentPanel?.refreshLocal?.();
}

function setComposerMode(run, { waitingApproval = false } = {}) {
  const continuing = Boolean(run);
  // v4.0 Forge：会话活跃态挂到表单——workbench.css 据此在 composer 外圈跑旋转 conic 环（focus-within 时隐去）
  elements["task-form"]?.classList.toggle("is-session-active", continuing && ACTIVE_RUN_STATES.has(run.status));
  elements["composer-mode-hint"].textContent = continuing ? "续聊当前会话" : "任务内容";
  elements["composer-new-task"].hidden = !continuing;
  // 项目地址徽标：新任务模式显示当前会话地址（点击可换）；续聊模式显示所属 run 的地址（只读信息）
  // v41：远程位置（globe + 主机 · 路径）优先于本地 cwd 展示——两者互斥（captureComposerConfig 同口径）
  const remoteShown = continuing ? run.remote : state.pendingRemote;
  const cwdShown = continuing ? run.cwd : state.pendingCwd;
  elements["composer-cwd"].hidden = !cwdShown && !remoteShown;
  if (remoteShown) {
    const short = String(remoteShown.path).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || remoteShown.path;
    elements["composer-cwd"].innerHTML = `${lucideIcon("globe", "icon lucide")} <span>${escapeHtml(short)}</span>`;
    elements["composer-cwd"].title = `远程项目：${escapeHtml(remoteShown.hostName || remoteShown.hostId)} · ${remoteShown.path}${continuing ? "" : "（点击更换）"}`;
    elements["composer-cwd"].disabled = continuing;
  } else if (cwdShown) {
    const short = String(cwdShown).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwdShown;
    elements["composer-cwd"].innerHTML = `${lucideIcon("folder", "icon lucide")} <span>${escapeHtml(short)}</span>`;
    elements["composer-cwd"].title = `会话项目地址：${cwdShown}${continuing ? "" : "（点击更换）"}`;
    elements["composer-cwd"].disabled = continuing;
  }
  syncComposerControlVisibility(); // 续聊：模型/Effort/权限均可热调（权限限白名单）；新任务按当前目标 Adapter 支持面显示
  // 团队在续聊时冻结；直接收件人始终由成员目标标签决定。
  elements["composer-team"].disabled = continuing;
  elements["start-agent"].disabled = continuing;
  byId("composer-team-pick")?.setAttribute("title", continuing ? "会话所属团队已固化；上方目标标签仍可切换直接收件人" : "本次会话所属团队与能力边界");
  // 轮间插话可用性前置告知：run 活跃时发送不打断当前轮，排队到轮边界送达（后端 pendingSteer FIFO）。
  // ask 挂起优先：团队在等 LO 回答——placeholder 直接把问题递到手边
  const waitingAnswer = continuing && Boolean(run.pendingAsk);
  const steering = continuing && !waitingAnswer && ACTIVE_RUN_STATES.has(run.status);
  const target = activeComposerTarget();
  const targetName = target.memberId ? agentLabel(target.memberId) : "团队主脑";
  const answeringAsk = waitingAnswer && run.pendingAsk.from === target.memberId;
  elements["task-input"].placeholder = answeringAsk
    ? `回答 ${targetName}：${String(run.pendingAsk.text || "").slice(0, 80)}`
    : steering
      ? "会话进行中——发送将作为轮间插话，当前轮结束后送达"
      : continuing
        ? `直接发送给 ${targetName}：补充要求、质疑证据或继续执行`
        : `直接交给 ${targetName} 执行`;
  elements["task-input"].disabled = waitingApproval;
  syncSubmitButtonMode(); // 发送/停止双态（LO 2026-08-10）：run 活跃 + 空输入 = 停止键
  // 审批挂起时输入禁用，但停止键必须可用——它是此时唯一有意义的动作
  elements["submit-task-button"].disabled = waitingApproval && elements["submit-task-button"].dataset.mode !== "stop";
  elements["followup-agent"].disabled = waitingApproval;
  if (continuing && elements["followup-agent"].dataset.runId !== run.id) {
    // 发送给下拉按团队成员过滤（服务端已强制隔离）+ 预选主脑；仅切 run 时重建
    const members = Array.isArray(run.teamMembers) && run.teamMembers.length
      ? run.teamMembers
      : ["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "gemini-research", "pi-resident"];
    elements["followup-agent"].innerHTML = members
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(agentLabel(id))}${id === run.coordinatorId ? "（主脑）" : ""}</option>`)
      .join("");
    elements["followup-agent"].dataset.runId = run.id;
  }
  syncComposerTargetUi(target);
}

// 发送/停止双态键（LO 2026-08-10，对齐官方行为）：续聊 run 活跃 + 输入为空 → 停止键
// （点击级联取消，走 cancelSelectedRun 既有确认弹窗）；有输入 → 发送键——
// 轮间插话能力不被停止键吃掉。终态/新任务/预览态恒为发送键。
function syncSubmitButtonMode() {
  const button = elements["submit-task-button"];
  if (!button) return;
  const run = selectedRun();
  const running = Boolean(run) && !state.sessionPreview && ACTIVE_RUN_STATES.has(run.status);
  const hasInput = Boolean(elements["task-input"]?.value.trim());
  const stopMode = running && !hasInput;
  const mode = stopMode ? "stop" : "send";
  if (button.dataset.mode !== mode) {
    button.dataset.mode = mode;
    button.classList.toggle("is-stop", stopMode);
    // 停止态用实心方块（官方同款，16px 下一眼即「停止」）——circle-stop 描边小尺寸像 ⊙ 被误读
    button.innerHTML = stopMode
      ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg>'
      : '<svg class="icon lucide"><use href="#lucide-arrow-up"></use></svg>';
  }
  const label = stopMode ? "停止当前任务（级联中止本 run 全部 CLI 子进程）" : "发起协作";
  button.title = label;
  button.setAttribute("aria-label", label);
  // 停止模式必须跳过原生 required 校验（task-input 必填）：空输入正是停止键的使用场景，
  // 不挂 formnovalidate 浏览器会先弹「请填写此字段」，点击根本到不了 createRun 的停止拦截
  button.toggleAttribute("formnovalidate", stopMode);
}

const STREAM_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// 会话正文来自本地 CLI/event store，单条事件可接近 16 MiB。正文超过显示预算时只挂
// 有界元数据；绝不能为了“截断后显示”先对全文做 redact/Markdown/escape。
const INLINE_MESSAGE_TEXT_LIMIT = 32 * 1024;
const INLINE_TOOL_RESULT_TEXT_LIMIT = 32 * 1024;
const INLINE_TOOL_INPUT_TEXT_LIMIT = 8 * 1024;
const INLINE_STRUCTURED_ITEM_LIMIT = 24;
const CONVERSATION_SYNC_SOURCE_BUDGET = 48 * 1024;
const CONVERSATION_BATCH_MAX_ITEMS = 8;
const GLOBAL_EVENT_MAX_COUNT = 160;
const GLOBAL_EVENT_MAX_BYTES = 40 * 1024 * 1024;
const NORMALIZED_EVENT_FIXED_OVERHEAD = 1024;
const globalEventBytes = new WeakMap();
let globalEventResidentBytes = 0;

function yieldToMainThread() {
  if (typeof window.scheduler?.yield === "function") return window.scheduler.yield();
  if (typeof window.MessageChannel === "function") {
    return new Promise((resolveYield) => {
      const channel = new window.MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolveYield();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolveYield) => window.setTimeout(resolveYield, 0));
}

function payloadText(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function declaredPayloadLength(value, declaredLength) {
  const actual = payloadText(value).length;
  const declared = Number(declaredLength);
  return Number.isSafeInteger(declared) && declared >= actual ? declared : actual;
}

function normalizedEventSourceBytes(sourceCharacters) {
  const characters = Number(sourceCharacters);
  if (!Number.isFinite(characters) || characters <= 0) return 0;
  // JS strings can require two bytes per code unit. The fixed allowance covers the normalized
  // envelope, bounded summaries and object/property overhead without rescanning the full payload.
  return Math.ceil(characters) * 2 + NORMALIZED_EVENT_FIXED_OVERHEAD;
}

function exactRenderSignature(parts) {
  return parts.map((value) => {
    const text = payloadText(value);
    return `${text.length}:${text}`;
  }).join("");
}

function messageRenderSignature(message) {
  const kind = message?.kind ?? String(message?.role ?? "assistant").toLowerCase();
  return exactRenderSignature([
    message?.key,
    kind,
    message?.renderToken ?? renderTokenFor(message),
    message?.textLength,
    message?.toolsTotal,
    message?.resultsTotal,
  ]);
}

function messageRenderCost(message) {
  const kind = message?.kind ?? String(message?.role ?? "assistant").toLowerCase();
  if (kind === "tool-result") {
    let cost = 0;
    for (const result of (Array.isArray(message?.results) ? message.results : []).slice(0, INLINE_STRUCTURED_ITEM_LIMIT)) {
      const length = declaredPayloadLength(result?.text, result?.textLength);
      cost += length > INLINE_TOOL_RESULT_TEXT_LIMIT ? 256 : length;
      if (cost > CONVERSATION_SYNC_SOURCE_BUDGET) break;
    }
    return cost;
  }
  const length = declaredPayloadLength(
    message?.text ?? message?.content ?? message?.message ?? message?.summary,
    message?.textLength,
  );
  return length > INLINE_MESSAGE_TEXT_LIMIT ? 256 : length;
}

function conversationRenderSignature(renderContext, messageWindow, leadingMarkup, tailMarkup) {
  return exactRenderSignature([
    renderContext,
    `${messageWindow.start}:${messageWindow.end}:${messageWindow.total}`,
    leadingMarkup,
    tailMarkup,
    ...messageWindow.visible.map(messageRenderSignature),
  ]);
}

function streamEntryByKey(stream, key) {
  if (!key) return null;
  return [...stream.children].find((node) => node instanceof HTMLElement && node.dataset.streamKey === key) ?? null;
}

function captureConversationStreamState(stream) {
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48;
  const allDetails = [...stream.querySelectorAll("details")];
  const openDetails = allDetails
    .filter((detail) => detail.open)
    .map((detail) => {
      const entry = detail.closest("[data-stream-key]");
      const entryDetails = entry ? [...entry.querySelectorAll("details")] : allDetails;
      return {
        entryKey: entry?.dataset.streamKey ?? "",
        index: entryDetails.indexOf(detail),
        absoluteIndex: allDetails.indexOf(detail),
      };
    });

  const active = document.activeElement;
  let focus = null;
  if (active instanceof HTMLElement && active !== stream && stream.contains(active)) {
    const entry = active.closest("[data-stream-key]");
    const scope = entry ?? stream;
    focus = {
      entryKey: entry?.dataset.streamKey ?? "",
      index: [...scope.querySelectorAll(STREAM_FOCUSABLE_SELECTOR)].indexOf(active),
    };
  }

  let anchor = null;
  if (!atBottom) {
    const streamTop = stream.getBoundingClientRect().top;
    const entry = [...stream.children]
      .filter((node) => node instanceof HTMLElement && node.dataset.streamKey)
      .find((node) => node.getBoundingClientRect().bottom > streamTop + 1);
    if (entry) {
      anchor = {
        key: entry.dataset.streamKey,
        offset: entry.getBoundingClientRect().top - streamTop,
      };
    }
  }
  return { atBottom, scrollTop: stream.scrollTop, openDetails, focus, anchor };
}

function restoreConversationStreamState(stream, snapshot) {
  for (const saved of snapshot.openDetails) {
    const entry = saved.entryKey ? streamEntryByKey(stream, saved.entryKey) : null;
    if (saved.entryKey && !entry) continue;
    const details = entry ? [...entry.querySelectorAll("details")] : [...stream.querySelectorAll("details")];
    const detail = details[entry ? saved.index : saved.absoluteIndex];
    if (detail) detail.open = true;
  }

  if (snapshot.focus) {
    const entry = snapshot.focus.entryKey ? streamEntryByKey(stream, snapshot.focus.entryKey) : null;
    const scope = snapshot.focus.entryKey ? entry : stream;
    const target = scope ? [...scope.querySelectorAll(STREAM_FOCUSABLE_SELECTOR)][snapshot.focus.index] : null;
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    else stream.focus({ preventScroll: true }); // 曾在流内聚焦时，重渲后绝不让焦点掉到 BODY
  }

  if (snapshot.atBottom) {
    stream.scrollTop = stream.scrollHeight;
    return;
  }
  const anchor = streamEntryByKey(stream, snapshot.anchor?.key);
  if (anchor) {
    const nextOffset = anchor.getBoundingClientRect().top - stream.getBoundingClientRect().top;
    stream.scrollTop += nextOffset - snapshot.anchor.offset;
    return;
  }
  stream.scrollTop = Math.min(snapshot.scrollTop, Math.max(0, stream.scrollHeight - stream.clientHeight));
}

// 消息分组、审批尾卡和终态卡之间有跨节点语义，贸然做局部 diff 容易留下旧 class/旧按钮。
// 因此仍以单次模板提交为边界，但用稳定 data-stream-key 恢复用户交互状态；SSE 侧再保证每帧至多提交一次。
const pendingConversationMarkup = new WeakMap();
const committedConversationSignatures = new WeakMap();
let conversationRenderGeneration = 0;

function releaseConversationRenderOwnership(stream, ownership) {
  ownership?.cleanupUserInteraction?.();
  if (pendingConversationMarkup.get(stream) === ownership) pendingConversationMarkup.delete(stream);
}

// v4.0 Forge：本地富渲染后处理（rich-render 增强代码块/表格，纯本地无 CDN）。
// 失败不阻断会话流——后处理是增强层，不是渲染正确性的前提。
function postProcessRichContent(stream) {
  if (!stream) return;
  // CSP：团队星图轨道角度走 CSSOM 自定义属性（内联 style 被 style-src 拦截）
  stream.querySelectorAll("[data-orbit-angle]").forEach((el) => {
    el.style.setProperty("--orbit-angle", `${el.dataset.orbitAngle}deg`);
  });
  try {
    // 新旧两版 rich-render 都兼容：新版同步后处理；旧版/异步实现返回 Promise 时吞掉拒绝
    Promise.resolve(renderRichContent(stream)).catch((error) => {
      console.warn("rich content post-process failed:", error);
    });
  } catch (error) {
    console.warn("rich content post-process failed:", error);
  }
}

function replaceConversationStream(markup, renderContext, { preserveState = true, renderSignature = markup } = {}) {
  const stream = elements["conversation-stream"];
  const pending = pendingConversationMarkup.get(stream);
  if (pending?.renderContext === renderContext && pending.renderSignature === renderSignature) return false;
  if (stream.dataset.renderContext === renderContext && committedConversationSignatures.get(stream) === renderSignature) return false;
  const snapshot = preserveState && stream.dataset.renderContext === renderContext
    ? pending?.renderContext === renderContext
      ? pending.snapshot
      : captureConversationStreamState(stream)
    : null;
  conversationRenderGeneration += 1; // 取消仍在分批挂载的旧历史首屏
  releaseConversationRenderOwnership(stream, pending);
  stream.removeAttribute("aria-busy");
  stream.innerHTML = markup;
  committedMarkup.delete(stream); // 旧实现可能在这里保留整份大字符串，切换后主动释放。
  committedConversationSignatures.set(stream, renderSignature);
  stream.dataset.renderContext = renderContext;
  if (snapshot) restoreConversationStreamState(stream, snapshot);
  else stream.scrollTop = preserveState ? stream.scrollHeight : Number.MAX_SAFE_INTEGER;
  postProcessRichContent(stream);
  return true;
}

async function replaceConversationStreamBatched({
  renderSignature,
  renderContext,
  leadingMarkup,
  messages,
  tailMarkup,
  preserveState = false,
}) {
  const stream = elements["conversation-stream"];
  const pending = pendingConversationMarkup.get(stream);
  if (pending?.renderContext === renderContext && pending.renderSignature === renderSignature) return false;
  if (stream.dataset.renderContext === renderContext && committedConversationSignatures.get(stream) === renderSignature) return false;

  const snapshot = preserveState && stream.dataset.renderContext === renderContext
    ? pending?.renderContext === renderContext
      ? pending.snapshot
      : captureConversationStreamState(stream)
    : null;
  releaseConversationRenderOwnership(stream, pending);
  const generation = ++conversationRenderGeneration;
  const ownership = { generation, renderContext, renderSignature, snapshot, userInteracted: false };
  const markUserInteraction = (event) => {
    if (event.isTrusted) ownership.userInteracted = true;
  };
  const interactionEvents = ["pointerdown", "wheel", "touchstart", "keydown"];
  for (const eventName of interactionEvents) stream.addEventListener(eventName, markUserInteraction, { capture: true, passive: eventName !== "keydown" });
  ownership.cleanupUserInteraction = () => {
    if (!ownership.cleanupUserInteraction) return;
    for (const eventName of interactionEvents) stream.removeEventListener(eventName, markUserInteraction, { capture: true });
    ownership.cleanupUserInteraction = null;
  };
  pendingConversationMarkup.set(stream, ownership);
  committedMarkup.delete(stream);
  committedConversationSignatures.delete(stream);
  stream.dataset.renderContext = renderContext;
  stream.setAttribute("aria-busy", "true");
  stream.innerHTML = leadingMarkup;

  const stillOwned = () => conversationRenderGeneration === generation
    && pendingConversationMarkup.get(stream) === ownership
    && stream.dataset.renderContext === renderContext;
  // 异常兜底（LO 2026-08-10：审批后长期不输出的根因）：挂载中任何一步抛异常都会让
  // aria-busy 永久停 true，SSE 驱动的 selectedRun 更新全被 busy 闸无限空转——刷新才恢复。
  // 渲染异常必须清闸放行，让后续事件还能触发重渲；自殁路径（新挂载已接手）不清闸是有意的。
  try {
    for (let start = 0; start < messages.length;) {
      if (!stillOwned()) {
        releaseConversationRenderOwnership(stream, ownership);
        return false;
      }
      let end = start;
      let sourceCost = 0;
      let chunkMarkup = "";
      while (end < messages.length && end - start < CONVERSATION_BATCH_MAX_ITEMS) {
        const nextCost = messageRenderCost(messages[end]);
        if (end > start && sourceCost + nextCost > CONVERSATION_SYNC_SOURCE_BUDGET) break;
        chunkMarkup += messageMarkup(messages[end], messages[end - 1]);
        sourceCost += nextCost;
        end += 1;
      }
      stream.insertAdjacentHTML("beforeend", chunkMarkup);
      start = end;
      if (start < messages.length) {
        await yieldToMainThread();
      }
    }
    if (!stillOwned()) {
      releaseConversationRenderOwnership(stream, ownership);
      return false;
    }
    if (tailMarkup) stream.insertAdjacentHTML("beforeend", tailMarkup);
    committedConversationSignatures.set(stream, renderSignature);
  } catch (error) {
    releaseConversationRenderOwnership(stream, ownership);
    stream.removeAttribute("aria-busy");
    appendDiagnostic(`会话流分批挂载失败（已放开渲染闸）：${error?.message ?? error}`, "error");
    console.error("conversation batched mount failed:", error);
    return false;
  }
  releaseConversationRenderOwnership(stream, ownership);
  stream.removeAttribute("aria-busy");
  postProcessRichContent(stream);
  if (snapshot && !ownership.userInteracted) restoreConversationStreamState(stream, snapshot);
  else if (!ownership.userInteracted) {
    // 最后一批挂载后再滚底，避免把首屏节点的解析、样式计算和滚动布局压进同一任务。
    window.requestAnimationFrame(() => {
      if (conversationRenderGeneration === generation && stream.dataset.renderContext === renderContext) {
        stream.scrollTop = stream.scrollHeight;
      }
    });
  }
  return true;
}

const CONVERSATION_WINDOW_SIZE = 160;
const conversationWindowStarts = new Map();

function conversationWindowKey(runId, agentId = null) {
  return `${runId}\u0000${agentId ?? "all"}`;
}

function conversationWindow(run, agentId, messages) {
  const key = conversationWindowKey(run.id, agentId);
  const total = messages.length;
  const latestStart = Math.max(0, total - CONVERSATION_WINDOW_SIZE);
  const storedStart = conversationWindowStarts.get(key);
  const start = storedStart == null
    ? latestStart
    : Math.min(latestStart, Math.max(0, Number(storedStart) || 0));
  const end = Math.min(total, start + CONVERSATION_WINDOW_SIZE);
  return {
    start,
    end,
    total,
    hidden: start,
    hiddenAfter: Math.max(0, total - end),
    visible: messages.slice(start, end),
  };
}

function freezeLatestConversationWindowForIncoming(event) {
  if (
    !eventAffectsConversation(event)
    || state.view !== "workbench"
    || state.sessionPreview
    || event.runId !== state.selectedRunId
  ) return;
  const run = selectedRun();
  if (!run) return;
  const agentId = activeAgentId();
  const incomingMessage = conversationMessageFromEvent(event);
  if (!incomingMessage || !messageMatchesAgentPage(incomingMessage, agentId)) return;
  const key = conversationWindowKey(run.id, agentId);
  if (conversationWindowStarts.has(key)) return;

  const stream = elements["conversation-stream"];
  if (
    stream.dataset.renderContext !== `run:${run.id}:${agentId ?? "all"}`
    || stream.getAttribute("aria-busy") === "true"
    || stream.scrollHeight - stream.scrollTop - stream.clientHeight < 48
  ) return;

  const messages = normalizeRunMessages(run, { agentId });
  if (messages.length < CONVERSATION_WINDOW_SIZE) return;
  const latestStart = Math.max(0, messages.length - CONVERSATION_WINDOW_SIZE);
  const indexByKey = new Map(messages.map((message, index) => [String(message.key ?? ""), index]));
  let renderedStart = latestStart;
  for (const child of stream.children) {
    const renderedIndex = indexByKey.get(child.dataset?.streamKey ?? "");
    if (renderedIndex != null) {
      renderedStart = renderedIndex;
      break;
    }
  }
  // 冻结当前真实 DOM 的起点，而不是当前数据尾部。这样前一帧尚未提交的新事件也不会
  // 让第二个 SSE 把用户正在阅读的首条消息挤出窗口。
  conversationWindowStarts.set(key, Math.min(latestStart, Math.max(0, renderedStart)));
}

function conversationHistoryGateMarkup(messageWindow) {
  return messageWindow.hidden
    ? `<div class="conversation-history-gate" data-stream-key="history:gate">
        <button class="text-button" type="button" data-load-earlier>加载更早（${messageWindow.hidden}）</button>
        <span>当前窗口 ${messageWindow.visible.length} 条 · 第 ${messageWindow.start + 1}-${messageWindow.end} 条，共 ${messageWindow.total} 条</span>
      </div>`
    : "";
}

function conversationNewerGateMarkup(messageWindow) {
  return messageWindow.hiddenAfter
    ? `<div class="conversation-history-gate is-newer" data-stream-key="history:newer">
        <button class="text-button" type="button" data-load-newer>加载更新（${messageWindow.hiddenAfter}）</button>
        <button class="text-button" type="button" data-return-latest>回到最新</button>
        <span>第 ${messageWindow.start + 1}-${messageWindow.end} 条，共 ${messageWindow.total} 条</span>
      </div>`
    : "";
}

function moveConversationWindow(direction) {
  const run = selectedRun();
  if (!run || elements["conversation-stream"].getAttribute("aria-busy") === "true") return;
  const agentId = activeAgentId();
  const messages = normalizeRunMessages(run, { agentId });
  const current = conversationWindow(run, agentId, messages);
  const key = conversationWindowKey(run.id, agentId);
  const latestStart = Math.max(0, messages.length - CONVERSATION_WINDOW_SIZE);
  const pageStarts = [];
  for (let start = latestStart; ; start = Math.max(0, start - CONVERSATION_WINDOW_SIZE)) {
    pageStarts.unshift(start);
    if (start === 0) break;
  }
  const nextStart = direction === "older"
    ? [...pageStarts].reverse().find((start) => start < current.start) ?? current.start
    : pageStarts.find((start) => start > current.start) ?? current.start;
  if (nextStart === latestStart) conversationWindowStarts.delete(key);
  else conversationWindowStarts.set(key, nextStart);
  renderSelectedRun({ preserveStreamState: true });
}

function loadEarlierConversation() {
  moveConversationWindow("older");
}

function loadNewerConversation() {
  moveConversationWindow("newer");
}

function returnToLatestConversation() {
  const run = selectedRun();
  if (!run || elements["conversation-stream"].getAttribute("aria-busy") === "true") return;
  conversationWindowStarts.delete(conversationWindowKey(run.id, activeAgentId()));
  renderSelectedRun({ preserveStreamState: true });
}

function releaseConversationWindows(runId) {
  const prefix = `${runId}\u0000`;
  for (const key of conversationWindowStarts.keys()) {
    if (key.startsWith(prefix)) conversationWindowStarts.delete(key);
  }
}

function renderSelectedRun({ preserveStreamState = true } = {}) {
  if (state.sessionPreview) {
    missionControlDock?.selectRun(null);
    syncRailToActiveRun();
    renderRecoveryBar(null); // 历史预览与 run 上下文无关，恢复条一并收起
    renderSessionPreview();
    return;
  }
  delete elements["conversation-stream"].dataset.previewKey;
  const run = selectedRun();
  if (!run) {
    missionControlDock?.selectRun(null);
    syncRailToActiveRun();
    const renderContext = `new-task:${state.agentPickerOpen ? "picker" : "welcome"}`;
    syncConversationLiveContext(renderContext);
    elements["conversation-title"].textContent = "新任务";
    elements["conversation-meta"].textContent = "等待输入";
    elements["workbench-run-status"].textContent = "未选择任务";
    elements["workbench-run-status"].className = "status-label is-neutral";
    elements["cancel-run-button"].disabled = true;
    setComposerMode(null);
    renderRecoveryBar(null);
    replaceConversationStream(
      state.agentPickerOpen ? agentPickerMarkup() : welcomeTemplatesMarkup(),
      renderContext,
    );
    renderRouteDecision(null);
    renderTopology(null);
    renderMemberStrip();
    renderConversationAgents(null);
    renderWorkbenchEvents();
    renderStatusline();
    return;
  }

  missionControlDock?.selectRun(run.id, `${run.updatedAt ?? run.createdAt ?? ""}:${run.status}:${run.round ?? 0}`);
  syncRailToActiveRun();

  const agentId = activeAgentId(); // 成员独立页（null=团队协作页）
  const renderContext = `run:${run.id}:${agentId ?? "team"}`;
  syncConversationLiveContext(renderContext);
  elements["conversation-title"].textContent = agentId ? `${run.title} · ${agentLabel(agentId)}` : run.title;
  renderConversationAgents(run);
  // meta 行补编排模式与隔离态：social=默认社会编排；worktree 存在说明写盘已隔离。
  // run id 只露短码（全量 UUID 是审计场景才需要的技术细节，进 title 悬停）
  const metaParts = [`run ${String(run.id).slice(0, 8)}`, formatDate(run.createdAt)];
  // 轮次预算常驻可见：以前只有撞到上限时才冒出一句英文报错，用户全程不知道还剩几轮
  // （LO 2026-08-08：为什么会显示 maximum collaboration rounds reached）
  if (Number(run.maxRounds) > 0) {
    const used = Number(run.round) || 0;
    const cap = Number(run.maxRounds);
    const refunded = Number(run.roundsRefunded) || 0;
    const budget = used >= cap ? `轮次 ${used}/${cap} · 已用满` : `轮次 ${used}/${cap}`;
    metaParts.push(refunded ? `${budget} · 已退还 ${refunded}` : budget);
  }
  if (agentId) metaParts.push(`独立页 · 只看 ${agentLabel(agentId)}`);
  if (run.orchestrationMode === "pipeline") metaParts.push("Pipeline 拓扑");
  if (run.worktreePath) metaParts.push(`wt ${String(run.worktreePath).split(/[\\/]/).pop()}`);
  elements["conversation-meta"].textContent = metaParts.join(" · ");
  elements["conversation-meta"].title = [`run ${run.id}`, run.worktreePath ? `写盘隔离于工作树：${run.worktreePath}` : ""].filter(Boolean).join("\n");
  elements["workbench-run-status"].textContent = runStatusText(run.status, run);
  const successful = ["complete", "completed", "succeeded"].includes(run.status);
  elements["workbench-run-status"].className = `status-label is-${TERMINAL_RUN_STATES.has(run.status) ? (successful ? "ok" : "error") : "warning"}`;
  elements["cancel-run-button"].disabled = !ACTIVE_RUN_STATES.has(run.status);
  const waitingApproval = run.status === "waiting_approval" || run.buildApproval?.status === "pending";
  setComposerMode(run, { waitingApproval });
  renderRecoveryBar(run);

  const messages = normalizeRunMessages(run, { agentId });
  const messageWindow = conversationWindow(run, agentId, messages);
  const historyGate = conversationHistoryGateMarkup(messageWindow);
  const newerGate = conversationNewerGateMarkup(messageWindow);
  // 会话流尾部增强：活跃轮呼吸行 + ask 回答卡 + 内联审批卡 + 终态收口（完成统计/失败原因+重试）
  const tailMarkup = newerGate + liveTurnMarkup(run) + pendingAskMarkup(run) + inlineApprovalsMarkup(run)
    + runCompletionMarkup(run) + runFailureMarkup(run) + runDiffPanelMarkup(run);
  const renderSignature = conversationRenderSignature(renderContext, messageWindow, historyGate, tailMarkup);
  const syncSourceCost = messageWindow.visible.reduce((sum, message) => Math.min(
    CONVERSATION_SYNC_SOURCE_BUDGET + 1,
    sum + messageRenderCost(message),
  ), 0);
  const shouldBatch = messageWindow.visible.length > 0 && (
    messageWindow.visible.length >= 48
    || syncSourceCost > CONVERSATION_SYNC_SOURCE_BUDGET
  );
  if (shouldBatch) {
    void replaceConversationStreamBatched({
      renderSignature,
      renderContext,
      leadingMarkup: historyGate,
      messages: messageWindow.visible,
      tailMarkup,
      preserveState: preserveStreamState,
    });
  } else {
    const messageMarkupText = messageWindow.visible
      .map((message, index) => messageMarkup(message, messageWindow.visible[index - 1]))
      .join("");
    const streamMarkup = (messages.length
      ? historyGate + messageMarkupText
      : agentId
        ? emptyMarkup(`${agentLabel(agentId)} 还没发言`, "直接在下方输入，单独问 ta——不经团队路由", `empty:${run.id}:${agentId}`)
        : emptyMarkup("任务已创建", "等待主脑计划或 Agent 事件。", `empty:${run.id}:all`)) + tailMarkup;
    replaceConversationStream(streamMarkup, renderContext, { preserveState: preserveStreamState, renderSignature });
  }
  ensureApprovalCountdown();
  renderRouteDecision(run.route ? normalizeRoute(run.route) : state.routePreview);
  renderTopology(run);
  renderMemberStrip();
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
  "kimi-frontend": "Kimi 前端",
  "pi-resident": "Pi",
};
function agentLabel(id) {
  const catalog = Array.isArray(state.bootstrap?.teamCatalog) ? state.bootstrap.teamCatalog : [];
  return catalog.find((profile) => profile.id === id)?.label || AGENT_LABELS[id] || id || "Agent";
}

function compactPayloadCount(length, unit = "字符") {
  return `${Number(length || 0).toLocaleString("zh-CN")} ${unit}`;
}

function payloadRenderGuardMarkup(label, length, unit = "字符") {
  return `<div class="payload-render-guard" role="note"><strong>${escapeHtml(label)}过大，未直接渲染</strong><span>${escapeHtml(compactPayloadCount(length, unit))} · 源记录仍保留</span></div>`;
}

function boundedMetadataText(value, limit = 160) {
  const text = payloadText(value);
  const clipped = text.length > limit ? `${text.slice(0, limit)}…` : text;
  return redact(clipped);
}

// 头像双字码 + 配色槽：多 agent 对话里"谁在说话"要一眼可辨（色相互斥，暖纸主题下柔和 tint）
const AGENT_SHORT = {
  "claude-fable": "CL",
  "codex-technical": "CX",
  "grok-search": "GS",
  "grok-build": "GB",
  "gemini-research": "GM",
  "kimi-frontend": "KM",
  "pi-resident": "PI",
};
function agentSlug(id) {
  return String(id ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "") || "default";
}

// CLI 式工具调用行 → v4.0 工具卡：Lucide 工具字形 + 名称 + 单行情令摘要 + 状态图标，结果可折叠。
// 入参先 redact 再截断：Bash 命令行入参最可能带赋值式密钥（PASSWORD=xxx），与工具结果同等脱敏，
// 否则密钥在调用行明文进 DOM/截图（工具结果脱敏了、调用行漏了会形成不对称泄漏）。
// 常见工具给专属 Lucide 字形（卡片左侧一眼可辨工具族），其余 wrench 兜底
const TOOL_GLYPHS = Object.freeze({
  bash: "terminal", shell: "terminal",
  read: "file-text", write: "file-text", edit: "file-text", notebookedit: "file-text",
  glob: "search", grep: "search", websearch: "search", webfetch: "search",
  task: "bot", todowrite: "check", todoread: "check",
});
function toolGlyphFor(name) {
  return TOOL_GLYPHS[String(name ?? "").toLowerCase()] ?? "wrench";
}
function toolSlugFor(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "") || "tool";
}
function toolCallMarkup(tool) {
  const name = String(tool.name || "tool");
  const slug = toolSlugFor(name);
  const glyph = lucideIcon(toolGlyphFor(name));
  // 历史回放中的调用行都是"已完成"；进行态由 .tool-status.is-running（workbench.css）承接未来扩展
  const status = `<span class="tool-status is-done" title="已完成" aria-hidden="true">${lucideIcon("circle-check")}</span>`;
  const rawInput = payloadText(tool.input);
  const inputLength = declaredPayloadLength(rawInput, tool.inputLength);
  if (inputLength > INLINE_TOOL_INPUT_TEXT_LIMIT) {
    return `<div class="tool-call tool-card" data-tool="${escapeHtml(slug)}"><span class="tool-glyph" aria-hidden="true">${glyph}</span><strong>${escapeHtml(boundedMetadataText(name))}</strong><span class="tool-args">（输入过大 · ${escapeHtml(compactPayloadCount(inputLength))}）</span>${status}</div>`;
  }
  const full = redact(rawInput).replace(/\s+/g, " ");
  const shown = full.slice(0, 160) + (full.length > 160 ? "…" : "");
  const title = full.length > 160 ? ` title="${escapeHtml(full.slice(0, 600))}"` : "";
  return `<div class="tool-call tool-card" data-tool="${escapeHtml(slug)}"><span class="tool-glyph" aria-hidden="true">${glyph}</span><strong>${escapeHtml(boundedMetadataText(name))}</strong><span class="tool-args"${title}>${escapeHtml(full ? `(${shown})` : "")}</span>${status}</div>`;
}

function toolResultMarkup(result, { allowInline = true } = {}) {
  const rawText = payloadText(result.text);
  const textLength = declaredPayloadLength(rawText, result.textLength);
  const statusIcon = `<span class="tool-status ${result.isError ? "is-error" : "is-done"}" aria-hidden="true">${lucideIcon(result.isError ? "circle-alert" : "circle-check")}</span>`;
  const label = result.isError ? "工具错误" : "工具结果";
  if (!allowInline || textLength > INLINE_TOOL_RESULT_TEXT_LIMIT) {
    return `<details class="tool-result tool-card${result.isError ? " is-error" : ""}">
      <summary>${statusIcon}${label} · 超过显示预算</summary>
      ${payloadRenderGuardMarkup("工具结果", textLength)}
    </details>`;
  }
  const text = redact(rawText);
  const lineCount = text ? text.split("\n").length : 0;
  return `<details class="tool-result tool-card${result.isError ? " is-error" : ""}">
    <summary>${statusIcon}${label} · ${lineCount} 行</summary>
    <pre>${escapeHtml(text) || "(空)"}</pre>
  </details>`;
}

// 治理事件 → 会话流系统注记：编排/适配器护栏信号不静默吞掉（玫瑰=警示 / 琥珀=提示，样式克制）
const GOVERNANCE_EVENTS = {
  "run.coordinator_write_skipped": { tone: "rose", text: (data) => data.note || "主脑兼任执行者，本轮仅规划不落盘" },
  // 恢复确认（随热改一次性携带）：放弃可能仍占用原生轮的声明工作——不静默，人有知情权
  "run.recovery_acknowledged": { tone: "amber", text: () => "已确认恢复：放弃提交状态不明的声明工作，会话停在可续聊的闲置态" },
  "adapter.fallback": { tone: "amber", text: (data) => `适配器降级：${data.from || "?"} → ${data.to || "?"}${data.reason ? `（${data.reason}）` : ""}` },
  "adapter.replay_blocked": {
    tone: "rose",
    // 打断已获 provider 确认时如实标注"会话无活跃占用"——与"可能有活跃工作"是两种风险等级
    text: (data) => `已阻止不安全的原生轮重放：${data.reason || "提交状态不明确"}${data.interruptConfirmed === true ? "（原生轮已确认打断，会话无活跃占用）" : ""}`,
  },
  // 已确认打断的只读超时轮自动原生续跑：不静默——次数/硬顶/轮次都要可见（自动 ≠ 免审计）
  "run.auto_recovery": {
    tone: "amber",
    text: (data) => `${agentLabel(data.agentId || "")} 第 ${data.round ?? "?"} 轮超时且原生轮已确认打断——已自动原生续跑（第 ${data.count ?? "?"}/${data.cap ?? "?"} 次，只读轮无写盘残留）`,
  },
  "run.authorization_revoked": { tone: "rose", text: (data) => `Build 授权已撤销：${data.reason || "运行时策略变更"}` },
  // 轮次检查点降噪：正常相位流转（prepared/session_ready/submitting/submitted/completed）由
  // 活跃轮呼吸行实时呈现，注记只留 ambiguous——需要人明白"提交状态不明确"的那一条
  "agent.turn_checkpoint": { tone: "rose", text: (data, event) => (data.phase === "ambiguous" ? `第 ${data.round ?? "?"} 轮 ${agentLabel(data.agentId ?? event.agentId ?? "")} 提交状态不明确——自动重放已阻止，需人工确认` : null) },
  "run.steer_queued": { tone: "amber", text: (data) => `轮间插话已排队（第 ${data.depth ?? "?"} 位）· 当前轮结束后送达 ${agentLabel(data.agentId || "")}` },
  // 轮次退还必须看得见：不播报就等于悄悄改配额。可能触达 provider 的派发上限不随之放松
  "run.round_refunded": {
    tone: "amber",
    text: (data) => `已退还一轮白烧配额（该轮停在「${data.phase ?? "未完成"}」未产出）· 轮次回到 ${data.round ?? "?"}/${data.maxRounds ?? "?"} · 累计退还 ${data.roundsRefunded ?? "?"} 次`,
  },
  // v3.6 社会模拟编排：agent 间路由可见性（bus.jsonl 的 [[msg:]] 被编排器路由时落一条注记）。
  // memo=全员黑板（violet 记号）、lo=向用户提问、team=广播——不用内部代号直译
  "bus.routed": {
    tone: "amber",
    text: (data) => {
      const snippet = `${String(data.text || "").slice(0, 60)}${String(data.text || "").length > 60 ? "…" : ""}`;
      if (data.to === "memo") return `${agentLabel(data.from || "")} 记入全员黑板：${snippet}`;
      if (data.to === "lo") return `${agentLabel(data.from || "")} 向你提问：${snippet}`;
      if (data.to === "team") return `${agentLabel(data.from || "")} 向全员广播：${snippet}`;
      return `${agentLabel(data.from || "")} → ${agentLabel(data.to || "")}：${snippet}`;
    },
    toneOf: (data) => (data.to === "memo" ? "violet" : "amber"),
  },
  // ask/answer 挂起：团队向你提问，run 等待回答（在下方输入即恢复主循环）
  "run.waiting_input": { tone: "amber", text: (data) => `团队向你提问（来自 ${agentLabel(data.from || "")}），在下方回答即继续：${String(data.text || "").slice(0, 60)}${String(data.text || "").length > 60 ? "…" : ""}` },
  // ask 频次熔断（v3.7：agent 拿结论当提问的 ask→answer 死循环防护）
  "run.ask_throttled": { tone: "rose", text: (data) => `${agentLabel(data.from || "")} 对你的提问已达单次任务上限（2 次），后续输出按结论处理，不再挂起等待回答` },
  // v3.6 P3 治理三连：worktree 隔离建立/跳过 + run 级预算耗尽（后端事件已发，此处兑现可见性）
  "run.worktree_created": { tone: "amber", text: (data) => `已创建隔离工作树：写盘轮在 ${String(data.worktree || "").split(/[\\/]/).pop() || "worktree"} 进行，真实目录零污染` },
  "run.worktree_skipped": { tone: "rose", text: () => "本会话未设项目地址——写盘将发生在默认目录，无工作树隔离" },
  "run.budget_exhausted": { tone: "rose", text: (data) => `run 累计成本已达硬顶（$${Number(data.costUsdTotal ?? 0).toFixed(2)}），已停止派发新轮` },
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

const eventRenderTokens = new WeakMap();
const objectRenderTokens = new WeakMap();
const runHistoryMessageCaches = new WeakMap();
let nextRenderToken = 0;

function renderTokenFor(object, prefix = "object") {
  if (!object || typeof object !== "object") return `${prefix}:${String(object ?? "")}`;
  const tokens = prefix === "event" ? eventRenderTokens : objectRenderTokens;
  let token = tokens.get(object);
  if (!token) {
    token = `${prefix}:${++nextRenderToken}`;
    tokens.set(object, token);
  }
  return token;
}

function freezeConversationMessage(message) {
  const snapshot = { ...message };
  if (Array.isArray(snapshot.tools)) {
    snapshot.tools = Object.freeze(snapshot.tools.map((tool) => Object.freeze({ ...tool })));
  }
  if (Array.isArray(snapshot.results)) {
    snapshot.results = Object.freeze(snapshot.results.map((result) => Object.freeze({ ...result })));
  }
  snapshot.renderToken ??= renderTokenFor(snapshot, "message");
  return Object.freeze(snapshot);
}

function eventMatchesAgentPage(event, agentId) {
  if (!agentId) return true;
  if (event.type === "user.message") return true;
  const data = event.data || {};
  if (event.agentId === agentId || data.agentId === agentId || data.from === agentId || data.to === agentId) return true;
  return Boolean(!event.agentId && GOVERNANCE_EVENTS[event.type] && !data.from && !data.to);
}

function messageMatchesAgentPage(message, agentId) {
  if (!agentId) return true;
  if (message.eventType === "user.message" || message.kind === "user") return true;
  if (
    message.sourceAgentId === agentId
    || message.sourceDataAgentId === agentId
    || message.sourceFrom === agentId
    || message.sourceTo === agentId
  ) return true;
  return Boolean(message.runLevelGovernance);
}

function messageTime(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareConversationMessages(left, right) {
  return (left.sortTime ?? 0) - (right.sortTime ?? 0) || (left.seq ?? 0) - (right.seq ?? 0);
}

function insertConversationMessageSorted(messages, message) {
  const last = messages.at(-1);
  if (!last || compareConversationMessages(last, message) <= 0) {
    messages.push(message);
    return messages.length - 1;
  }
  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareConversationMessages(messages[middle], message) <= 0) low = middle + 1;
    else high = middle;
  }
  messages.splice(low, 0, message);
  return low;
}

function conversationMessageFromEvent(event) {
  if (!event || !eventAffectsConversation(event)) return null;
  const data = event.data || {};
  const seq = Number.isFinite(Number(event.seq)) ? Number(event.seq) : 0;
  const common = {
    created_at: event.timestamp,
    sortTime: messageTime(event.timestamp),
    seq,
    key: event.id,
    renderToken: renderTokenFor(event, "event"),
    eventType: event.type,
    sourceAgentId: event.agentId,
    sourceDataAgentId: data.agentId,
    sourceFrom: data.from,
    sourceTo: data.to,
    runLevelGovernance: Boolean(!event.agentId && GOVERNANCE_EVENTS[event.type] && !data.from && !data.to),
  };
  if (event.type === "assistant.message" && (data.text || data.textLength || data.tools?.length || data.toolsTotal)) {
    return freezeConversationMessage({
      ...common,
      kind: "assistant",
      author: event.agentId || "Agent",
      text: data.text || "",
      textLength: declaredPayloadLength(data.text, data.textLength),
      tools: Array.isArray(data.tools) ? data.tools : [],
      toolsTotal: Math.max(Array.isArray(data.tools) ? data.tools.length : 0, Number(data.toolsTotal) || 0),
    });
  }
  if (event.type === "tool.result" && (data.results?.length || data.resultsTotal)) {
    return freezeConversationMessage({
      ...common,
      kind: "tool-result",
      results: Array.isArray(data.results) ? data.results : [],
      resultsTotal: Math.max(Array.isArray(data.results) ? data.results.length : 0, Number(data.resultsTotal) || 0),
    });
  }
  if (event.type === "agent.turn_started") {
    return freezeConversationMessage({ ...common, kind: "divider", text: `第 ${data.round ?? "?"} 轮 · ${agentLabel(data.agentId ?? event.agentId ?? "")}` });
  }
  if (event.type === "agent.turn_completed") {
    return freezeConversationMessage({ ...common, kind: "turn-meta", text: turnMetaText(data, event) });
  }
  if (event.type === "tool.event") {
    const label = data.command || (data.tool ? `${data.tool}${data.status ? ` · ${data.status}` : ""}` : data.status || "工具");
    return freezeConversationMessage({
      ...common,
      kind: "assistant",
      author: event.agentId || "Agent",
      text: "",
      textLength: 0,
      tools: [{ name: data.tool || "tool", input: label, inputLength: declaredPayloadLength(label, data.commandLength) }],
      toolsTotal: 1,
    });
  }
  if (event.type === "grok.completed" && (data.text || data.textLength)) {
    return freezeConversationMessage({
      ...common,
      kind: "assistant",
      author: event.agentId || "grok-build",
      text: data.text || "",
      textLength: declaredPayloadLength(data.text, data.textLength),
      tools: [],
      toolsTotal: 0,
    });
  }
  if (["agent.error", "adapter.parse_error", "adapter.stderr"].includes(event.type)) {
    const text = data.message || event.content || event.type;
    return freezeConversationMessage({ ...common, kind: "tool-result", results: [{ isError: true, text }], resultsTotal: 1 });
  }
  if (event.type === "user.message" && (data.text || data.textLength)) {
    return freezeConversationMessage({
      ...common,
      kind: "user",
      author: "LO",
      text: data.text || "",
      textLength: declaredPayloadLength(data.text, data.textLength),
    });
  }
  // 无摘要 reasoning 完成态只用于清活跃记账（见 eventAffectsConversation），重建历史同样不落空卡
  if (event.type === "codex.item/completed" && data.progress && !(data.progress.kind === "reasoning" && !data.progress.text)) {
    return freezeConversationMessage({ ...common, kind: "process", author: event.agentId || "Agent", progress: data.progress });
  }
  if (GOVERNANCE_EVENTS[event.type]) {
    const governance = GOVERNANCE_EVENTS[event.type];
    const text = governance.text(data, event);
    if (text == null) return null;
    return freezeConversationMessage({ ...common, kind: "governance", tone: governance.toneOf?.(data) ?? governance.tone, text: redact(String(text)) });
  }
  return null;
}

function fallbackRunMessages(run, agentId) {
  if (!Array.isArray(run.messages)) return [];
  return run.messages
    .filter((message) => !agentId || message.role === "user" || String(message.agentId ?? message.agent_id ?? message.author ?? "") === agentId)
    .map((message, index) => freezeConversationMessage({
      kind: message.role === "user" ? "user" : "assistant",
      author: message.author ?? message.agentId ?? message.agent_id ?? "Agent",
      text: message.content ?? message.text ?? "",
      textLength: declaredPayloadLength(message.content ?? message.text, message.textLength),
      created_at: message.createdAt ?? message.created_at ?? message.timestamp ?? run.createdAt,
      sortTime: messageTime(message.createdAt ?? message.created_at ?? message.timestamp ?? run.createdAt),
      seq: index,
      key: String(message.id ?? `base-${index}`),
      eventType: message.role === "user" ? "user.message" : "assistant.message",
    }));
}

function ensureInitialPrompt(messages, run) {
  if (!run.prompt || messages.some((item) => item.kind === "user" && item.text === run.prompt)) return;
  insertConversationMessageSorted(messages, freezeConversationMessage({
    kind: "user",
    author: "LO",
    text: run.prompt,
    textLength: run.prompt.length,
    created_at: run.createdAt,
    sortTime: messageTime(run.createdAt),
    seq: -1,
    key: "initial-prompt",
    eventType: "user.message",
  }));
}

function historyMessagesForRun(run, agentId, events) {
  let caches = runHistoryMessageCaches.get(events);
  if (!caches) {
    caches = new Map();
    runHistoryMessageCaches.set(events, caches);
  }
  const key = agentId ?? "all";
  const cached = caches.get(key);
  if (cached) return cached;
  const base = events.conversationMessages ?? [];
  const messages = base.length
    ? (agentId ? base.filter((message) => messageMatchesAgentPage(message, agentId)) : [...base])
    : fallbackRunMessages(run, agentId);
  ensureInitialPrompt(messages, run);
  caches.set(key, messages);
  return messages;
}

function invalidateRunHistoryMessageCaches(events) {
  runHistoryMessageCaches.delete(events);
}

function appendRunHistoryMessageIndexes(events, event) {
  const message = conversationMessageFromEvent(event);
  if (!message) return;
  insertConversationMessageSorted(events.conversationMessages, message);
  const caches = runHistoryMessageCaches.get(events);
  if (!caches) return;
  for (const [agentId, messages] of caches) {
    if (!messageMatchesAgentPage(message, agentId === "all" ? null : agentId)) continue;
    if (message.kind === "user") {
      const synthetic = messages.findIndex((item) => item.key === "initial-prompt" && item.text === message.text);
      if (synthetic >= 0) messages.splice(synthetic, 1);
    }
    insertConversationMessageSorted(messages, message);
  }
}

function removeRunHistoryMessageIndexes(events, event) {
  const removeByKey = (messages) => {
    const index = messages.findIndex((message) => message.key === event.id);
    if (index >= 0) messages.splice(index, 1);
  };
  removeByKey(events.conversationMessages);
  // 缓存里可能含 synthetic initial prompt。真实 prompt 被滑动窗口淘汰后必须重建，
  // 不能只删同 key 后把首条用户意图一并永久丢掉。
  invalidateRunHistoryMessageCaches(events);
}

function normalizeRunMessages(run, { agentId = null } = {}) {
  const historical = state.runEvents[run.id];
  if (historical) return historyMessagesForRun(run, agentId, historical);

  // 首次历史请求完成前只需合并全局有界实时尾部（最多 160 条 / 40 MiB）。完整历史一旦
  // 到达，上面的增量索引接管，避免每个 SSE frame 重扫、去重和排序 5000 条事件。
  const items = [];
  for (const event of state.events) {
    if (event.runId !== run.id || !eventMatchesAgentPage(event, agentId)) continue;
    const message = conversationMessageFromEvent(event);
    if (message) insertConversationMessageSorted(items, message);
  }
  const messages = items.length ? items : fallbackRunMessages(run, agentId);
  ensureInitialPrompt(messages, run);
  return messages;
}

function streamKeyAttribute(message) {
  return message?.key ? ` data-stream-key="${escapeHtml(String(message.key))}"` : "";
}

const FILE_CHANGE_LABELS = { add: "新增", update: "修改", delete: "删除", rename: "重命名" };

/** 命令的首个词——折叠态一眼分辨 npm / git / node，不用展开。 */
function commandHeadline(command) {
  const text = String(command || "").trim();
  if (!text) return "命令";
  const firstLine = text.split("\n")[0];
  return firstLine.length > 96 ? `${firstLine.slice(0, 96)}…` : firstLine;
}

/**
 * Codex 过程卡：命令 / 文件改动 / 旁白。默认折叠成一行（几百条命令也不淹没对话），
 * 展开看完整命令与输出——对齐 CLI 里"命令 + 输出 + 退出码"的读法。
 */
function processCardMarkup(message, keyAttribute) {
  const progress = message.progress || {};
  const time = `<time>${escapeHtml(formatTime(message.created_at))}</time>`;
  if (progress.kind === "note" || progress.kind === "reasoning") {
    const glyph = lucideIcon(progress.kind === "reasoning" ? "brain" : "message-square");
    const label = progress.kind === "reasoning" ? "推理摘要" : "过程旁白";
    return `<div class="process-note"${keyAttribute}>
      <span class="process-glyph" aria-hidden="true">${glyph}</span>
      <span class="process-note-body"><span class="process-note-label">${escapeHtml(label)}</span>${renderMarkdown(progress.text ?? "", redact)}${progress.truncated ? '<span class="process-truncated">（已截断）</span>' : ""}</span>
      ${time}
    </div>`;
  }
  if (progress.kind === "file") {
    const changes = Array.isArray(progress.changes) ? progress.changes : [];
    const hidden = Math.max(0, Number(progress.changesTotal || changes.length) - changes.length);
    const failed = progress.status && progress.status !== "completed";
    const summary = changes.length === 1
      ? `${FILE_CHANGE_LABELS[changes[0].change] ?? "改动"} ${redact(String(changes[0].path || "")).split(/[\\/]/).pop() || "文件"}`
      : `改动 ${Number(progress.changesTotal || changes.length)} 个文件`;
    const bodies = changes.map((change) => `
      <div class="process-file">
        <div class="process-file-head"><span class="process-file-kind is-${escapeHtml(change.change ?? "update")}">${escapeHtml(FILE_CHANGE_LABELS[change.change] ?? change.change ?? "改动")}</span><code>${escapeHtml(redact(String(change.path || "")))}</code></div>
        ${change.diff ? `<pre class="process-diff">${escapeHtml(redact(change.diff))}</pre>${change.diffTruncated ? '<span class="process-truncated">（diff 已截断）</span>' : ""}` : ""}
      </div>`).join("");
    return `<details class="process-card is-file${failed ? " is-error" : ""}"${keyAttribute}>
      <summary><span class="process-glyph" aria-hidden="true">${lucideIcon("file-pen-line")}</span><span class="process-summary-text">${escapeHtml(summary)}</span>${time}</summary>
      <div class="process-body">${bodies}${hidden ? payloadRenderGuardMarkup("文件改动", hidden, "个") : ""}</div>
    </details>`;
  }
  const failed = Number.isInteger(progress.exitCode) ? progress.exitCode !== 0 : progress.status === "failed";
  const meta = [
    Number.isInteger(progress.exitCode) ? `退出码 ${progress.exitCode}` : null,
    Number.isFinite(progress.durationMs) ? formatDuration(progress.durationMs) : null,
  ].filter(Boolean).join(" · ");
  return `<details class="process-card is-command${failed ? " is-error" : ""}"${keyAttribute}>
    <summary>
      <span class="process-glyph" aria-hidden="true">${lucideIcon(failed ? "circle-alert" : "terminal")}</span>
      <code class="process-summary-text">${escapeHtml(redact(commandHeadline(progress.command)))}</code>
      ${meta ? `<span class="process-meta">${escapeHtml(meta)}</span>` : ""}${time}
    </summary>
    <div class="process-body">
      <pre class="process-command">${escapeHtml(redact(String(progress.command || "")))}</pre>
      ${progress.cwd ? `<div class="process-cwd">工作目录 <code>${escapeHtml(redact(String(progress.cwd)))}</code></div>` : ""}
      ${progress.output
    ? `<pre class="process-output">${escapeHtml(redact(progress.output))}</pre>${progress.outputTruncated ? '<span class="process-truncated">（输出已截断，仅保留首尾）</span>' : ""}`
    : '<div class="process-empty-output">无输出</div>'}
    </div>
  </details>`;
}

function messageMarkup(message, prev = null) {
  // 兼容两代形态：旧 {role, content}（历史预览）与新 {kind, text, tools}（事件流重建）
  const kind = message.kind ?? String(message.role ?? "assistant").toLowerCase();
  const keyAttribute = streamKeyAttribute(message);
  if (kind === "divider") {
    return `<div class="turn-divider"${keyAttribute}><span>${escapeHtml(message.text ?? "")}</span></div>`;
  }
  if (kind === "turn-meta") {
    return `<div class="turn-meta"${keyAttribute}><span>${escapeHtml(message.text ?? "")}</span><time>${escapeHtml(formatTime(message.created_at))}</time></div>`;
  }
  if (kind === "tool-result") {
    const results = Array.isArray(message.results) ? message.results : [];
    const resultsTotal = Math.max(results.length, Number(message.resultsTotal) || 0);
    let remainingTextBudget = INLINE_TOOL_RESULT_TEXT_LIMIT;
    const visibleResults = results.slice(0, INLINE_STRUCTURED_ITEM_LIMIT).map((result) => {
      const length = declaredPayloadLength(result?.text, result?.textLength);
      const allowInline = length <= remainingTextBudget;
      if (allowInline) remainingTextBudget -= length;
      return toolResultMarkup(result, { allowInline });
    });
    const hiddenResults = Math.max(0, resultsTotal - Math.min(results.length, INLINE_STRUCTURED_ITEM_LIMIT));
    if (hiddenResults) {
      visibleResults.push(payloadRenderGuardMarkup("工具结果项", hiddenResults, "项"));
    }
    return `<div class="message-row is-tool-result"${keyAttribute}>${visibleResults.join("")}</div>`;
  }
  if (kind === "governance") {
    // 治理注记：无头像、竖条 + 小号字（样式在 styles.css 末尾"协作台会话流增强"区块）
    return `<div class="gov-note is-${escapeHtml(message.tone ?? "amber")}"${keyAttribute}><span>${escapeHtml(message.text ?? "")}</span><time>${escapeHtml(formatTime(message.created_at))}</time></div>`;
  }
  if (kind === "process") {
    return processCardMarkup(message, keyAttribute);
  }
  const role = kind === "user" ? "user" : kind === "tool" ? "tool" : "assistant";
  const rawAuthor = message.author ?? message.agent_name ?? message.agentId ?? (role === "user" ? "LO" : role === "tool" ? "工具" : "Agent");
  const author = boundedMetadataText(role === "assistant" ? agentLabel(String(rawAuthor)) : String(rawAuthor));
  let content = payloadText(message.text ?? message.content ?? message.message ?? message.summary);
  const contentLength = declaredPayloadLength(content, message.textLength);
  // [[msg:x]]/[[memo]] 是给编排器的路由指令（bus.routed 注记已呈现其语义）——正文里剥掉
  // 标记本身保留内容，不让内部协议原文示人（与后端 parseDirectives 同规格）
  const oversizedContent = contentLength > INLINE_MESSAGE_TEXT_LIMIT;
  if (role === "assistant" && !oversizedContent) content = content.replace(/^\s*\[\[(?:msg:[A-Za-z0-9._-]{1,64}|memo)\]\]\s*/gm, "");
  const className = role === "tool" ? " is-tool" : role === "system" ? " is-system" : role === "user" ? " is-user" : "";
  // agent 配色槽：多 agent 对话里发言者一眼可辨（CSS .is-agent-* 定义色板）
  const agentClass = role === "assistant" ? ` is-agent-${agentSlug(rawAuthor)}` : "";
  // 群聊分组（Discord 式）：同一发言者 3 分钟内连续发言合并——头像/名字不重复，
  // 多 agent 团队对话视觉噪音减半；分组行悬停露小时间戳（CSS 呈现）
  const prevKind = prev ? (prev.kind ?? String(prev.role ?? "").toLowerCase()) : null;
  const prevAuthor = prev ? String(prev.author ?? prev.agent_name ?? prev.agentId ?? "") : null;
  const grouped = Boolean(
    prev
    && (kind === "user" || kind === "assistant")
    && prevKind === kind
    && prevAuthor === String(rawAuthor)
    && !(message.tools ?? []).length
    && Math.abs(new Date(message.created_at ?? 0).getTime() - new Date(prev.created_at ?? 0).getTime()) < 3 * 60_000,
  );
  const hoverTime = formatTime(message.created_at ?? message.timestamp);
  // CLI/厂商官方徽标头像（历史预览按会话来源传 cli；协作流按 agent 厂商映射）——有官方标志就用官方标志；
  // 无官方徽标时回退 Lucide 字形（用户 user-round / 工具 wrench / 未知 agent bot），身份色靠 --agent-* 环表达
  const cli = (message.cli && CLI_ICONS[message.cli] ? message.cli : null) ?? (role === "assistant" ? agentCli(rawAuthor) : null);
  const avatarContent = cli
    ? cliIconMarkup(cli)
    : role === "user"
      ? lucideIcon("user-round")
      : role === "tool"
        ? lucideIcon("wrench")
        : lucideIcon("bot");
  // assistant 输出走 markdown 渲染（用户友好）；用户输入保持原文换行（所见即所输）
  const body = oversizedContent
    ? payloadRenderGuardMarkup(role === "user" ? "用户消息" : "助手消息", contentLength)
    : role === "user"
      ? `<p class="message-body">${escapeHtml(redact(content))}</p>`
      : `<div class="message-body md-body">${renderMarkdown(content, redact)}</div>`;
  const tools = Array.isArray(message.tools) ? message.tools : [];
  const toolsTotal = Math.max(tools.length, Number(message.toolsTotal) || 0);
  const toolCalls = tools.slice(0, INLINE_STRUCTURED_ITEM_LIMIT).map(toolCallMarkup).join("")
    + (toolsTotal > INLINE_STRUCTURED_ITEM_LIMIT
      ? payloadRenderGuardMarkup("工具调用项", toolsTotal - INLINE_STRUCTURED_ITEM_LIMIT, "项")
      : "");
  const roleBlurb = role === "assistant" ? (AGENT_ROLE_BLURB[String(rawAuthor)] || "") : "";
  const cliBadge = cli && !grouped
    ? `<span class="message-cli-badge is-cli-${escapeHtml(cli)}" title="${escapeHtml(cliLabel(cli))} 原生会话">${escapeHtml(cliLabel(cli))}</span>`
    : "";
  return `
    <article class="message-row${className}${agentClass}${cli ? ` has-cli-avatar is-cli-${cli}` : ""}${grouped ? " is-grouped" : ""}"${keyAttribute}>
      <div class="message-avatar" aria-hidden="true">${grouped ? `<time class="hover-time">${escapeHtml(hoverTime)}</time>` : avatarContent}</div>
      <div class="message-content">
        ${grouped ? "" : `<div class="message-head"><strong>${escapeHtml(author)}</strong>${cliBadge}${roleBlurb ? `<span class="message-role-blurb">${escapeHtml(roleBlurb)}</span>` : ""}<time>${escapeHtml(hoverTime)}</time></div>`}
        ${body}${toolCalls}
      </div>
    </article>`;
}

// 活跃轮呼吸行：run 进行中时会话流尾部的"谁在干什么"实时指示——最后一条 turnAttempt 的
// agent + 相位人话 + 三点动画。没有它，LO 面对静止的流不知道系统是活着还是卡死。
function liveTurnMarkup(run) {
  if (!ACTIVE_RUN_STATES.has(run.status)) return "";
  if (run.status === "waiting_approval" || run.status === "recovery_required" || run.pendingAsk) return ""; // 等的是人，不是 agent
  if (run.recoveryNote) return ""; // 重启遗留的 waiting_agent：协程已死，呼吸行是假活
  const attempt = (run.turnAttempts ?? []).at(-1);
  // 时效兜底：相位 30 分钟没动过=协程大概率已死（超时上限量级），不假装还在跑
  const staleMs = Date.now() - Date.parse(attempt?.updatedAt ?? run.updatedAt ?? 0);
  if (Number.isFinite(staleMs) && staleMs > 30 * 60_000) return "";
  if (!attempt || ["completed", "failed"].includes(attempt.phase)) {
    // 轮间空隙（上轮已结、下轮未起）：编排器在路由/编织上下文
    return run.status === "running"
      ? `<div class="live-turn" data-stream-key="tail:live"><span class="live-dots" aria-hidden="true"><i></i><i></i><i></i></span><span>编排器正在路由下一轮</span></div>`
      : "";
  }
  const phaseText = {
    prepared: "正在准备会话",
    session_ready: "会话已就绪，正在提交",
    submitting: "正在提交任务",
    submitted: "正在执行",
    ambiguous: "提交状态待确认",
  }[attempt.phase] ?? "正在执行";
  const slug = agentSlug(attempt.agentId);
  const attemptCli = agentCli(attempt.agentId);
  // 已运行时长：submitted 期间没有中间 checkpoint，只显示"正在执行"时 4 分钟和 40 分钟长得一样，
  // 用户无法区分"在深度思考"和"已经死了"（LO 2026-08-08：发继续没反应，实为 Codex 正常长跑）。
  const since = attempt.updatedAt || attempt.createdAt || null;
  // 具体在跑什么 > 泛泛的"正在执行"：有活跃 item 时用它替换相位文案
  const activity = codexActivityText(run.id);
  return `
    <div class="live-turn is-agent-${slug}" data-stream-key="tail:live">
      <span class="message-avatar live-avatar${attemptCli ? ` has-cli-avatar is-cli-${attemptCli}` : ""}" aria-hidden="true">${attemptCli ? cliIconMarkup(attemptCli) : lucideIcon("bot")}</span>
      <span><strong>${escapeHtml(agentLabel(attempt.agentId))}</strong> ${escapeHtml(activity || phaseText)}</span>
      <span class="live-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      ${since ? `<time class="live-elapsed" data-live-since="${escapeHtml(since)}">${escapeHtml(liveElapsedText(since))}</time>` : ""}
    </div>`;
}

// 正在执行的 Codex item：item/started 记入、item/completed 抹去。历史卡片只认完成态
// （每条命令一行），"此刻在跑什么"由这里承接——两者合起来才等于 CLI 的可见度。
// reasoning 也在册：模型长考时没有 command/file 活跃，没有它呼吸行只剩干巴巴的相位文案
// （LO 2026-08-10：要 Codex 官方那种「正在思考」状态）。
const codexActivity = new Map();

function trackCodexActivity(event) {
  if (!event?.runId) return false;
  const progress = event.data?.progress;
  if (event.type === "codex.item/started" && progress?.id && ["command", "file", "reasoning"].includes(progress.kind)) {
    codexActivity.set(`${event.runId}\u0000${progress.id}`, { runId: event.runId, progress, since: event.timestamp });
    return true;
  }
  if (event.type === "codex.item/completed" && progress?.id) {
    return codexActivity.delete(`${event.runId}\u0000${progress.id}`);
  }
  // run 收尾时清掉残留（进程被杀/轮失败时不会有 completed），否则会一直显示假的"正在执行"
  if (/^run\.(completed|failed|cancelled)$/.test(event.type)) {
    let removed = false;
    for (const key of [...codexActivity.keys()]) {
      if (key.startsWith(`${event.runId}\u0000`)) removed = codexActivity.delete(key) || removed;
    }
    return removed;
  }
  return false;
}

/** 当前 run 正在跑的那条命令/改动的人话摘要；没有则空串。 */
function codexActivityText(runId) {
  const entry = [...codexActivity.values()].filter((item) => item.runId === runId).at(-1);
  if (!entry) return "";
  if (entry.progress.kind === "reasoning") return "正在思考";
  if (entry.progress.kind === "file") {
    const count = Number(entry.progress.changesTotal || entry.progress.changes?.length || 0);
    return count ? `正在写入 ${count} 个文件` : "正在写入文件";
  }
  return `正在执行 ${commandHeadline(entry.progress.command)}`;
}

/** 活跃轮已运行时长文案；超过 5 分钟追加提示，帮助区分"慢"与"停"。 */
function liveElapsedText(since) {
  const startedMs = Date.parse(String(since ?? ""));
  if (!Number.isFinite(startedMs)) return "";
  const elapsed = Math.max(0, Date.now() - startedMs);
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  // formatDuration 输出的是 "263 s"，分钟级读起来费劲——活跃轮要的是一眼看懂
  const span = minutes ? `${minutes} 分 ${String(totalSeconds % 60).padStart(2, "0")} 秒` : `${totalSeconds} 秒`;
  return elapsed >= 5 * 60_000 ? `已运行 ${span} · 长时间执行中` : `已运行 ${span}`;
}

/** 秒级走时：只改那一个 time 节点的文本，不触发会话流重绘。 */
function tickLiveElapsed() {
  for (const node of document.querySelectorAll("[data-live-since]")) {
    node.textContent = liveElapsedText(node.dataset.liveSince);
  }
}

// v3.6 社会模拟拓扑：从 bus.jsonl 的 from/to 消息流构建参与者链（谁说了几句、谁是 leader）。
// 成功短 TTL + 失败指数负缓存；旧 run 请求可取消，避免离线 bus 在 SSE 热路径形成请求风暴。
const socialTopologyCache = new Map(); // runId → { at, messages, diagnostics } | { error, failures, retryAt }
const socialTopologyInflight = new Map(); // runId → { promise, controller }
let socialTopologyGeneration = 0;
const SOCIAL_TOPOLOGY_TTL_MS = 30_000; // bus.routed 会精确失效；TTL 只兜底外部写入
const SOCIAL_TOPOLOGY_MAX_BACKOFF_MS = 30_000;

function trimSocialTopologyCache() {
  while (socialTopologyCache.size > 30) socialTopologyCache.delete(socialTopologyCache.keys().next().value);
}

function abortSocialTopologyRequest(runId) {
  const entry = socialTopologyInflight.get(runId);
  if (!entry) return;
  // Delete ownership before aborting. A transport that ignores AbortSignal is
  // still fenced out by the promise-identity gate in the completion handler.
  socialTopologyInflight.delete(runId);
  entry.controller.abort();
}

function invalidateSocialTopology(runId) {
  socialTopologyCache.delete(runId);
  abortSocialTopologyRequest(runId);
}

function cancelSocialTopologyRequestsExcept(runId) {
  for (const id of socialTopologyInflight.keys()) {
    if (id !== runId) abortSocialTopologyRequest(id);
  }
}

function supersededSocialTopologyError() {
  return Object.assign(new Error("social topology request was superseded"), {
    name: "AbortError",
    code: "ABORT_ERR",
  });
}

function loadSocialTopologyMessages(runId) {
  const now = Date.now();
  const cached = socialTopologyCache.get(runId);
  if (cached?.messages && now - cached.at < SOCIAL_TOPOLOGY_TTL_MS) {
    return Promise.resolve({ messages: cached.messages, diagnostics: cached.diagnostics ?? null });
  }
  if (cached?.error && now < cached.retryAt) return Promise.reject(cached.error);
  const existing = socialTopologyInflight.get(runId);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const pending = request(`/api/runs/${encodeURIComponent(runId)}/bus`, { signal: controller.signal })
    .then((payload) => {
      if (controller.signal.aborted || socialTopologyInflight.get(runId)?.promise !== pending) {
        throw supersededSocialTopologyError();
      }
      const messages = Array.isArray(payload?.messages) ? payload.messages : [];
      const diagnostics = payload?.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : null;
      socialTopologyCache.set(runId, { at: Date.now(), messages, diagnostics });
      trimSocialTopologyCache();
      return { messages, diagnostics };
    })
    .catch((error) => {
      const ownsRequest = socialTopologyInflight.get(runId)?.promise === pending;
      if (!controller.signal.aborted && ownsRequest && error?.name !== "AbortError") {
        const failures = (cached?.failures ?? 0) + 1;
        const retryAfter = Math.min(1_000 * (2 ** (failures - 1)), SOCIAL_TOPOLOGY_MAX_BACKOFF_MS);
        socialTopologyCache.set(runId, { error, failures, retryAt: Date.now() + retryAfter });
        trimSocialTopologyCache();
      }
      throw error;
    })
    .finally(() => {
      if (socialTopologyInflight.get(runId)?.promise === pending) socialTopologyInflight.delete(runId);
    });
  socialTopologyInflight.set(runId, { promise: pending, controller });
  return pending;
}

async function renderSocialTopology(run, generation) {
  const container = elements["session-topology"];
  const canCommit = () =>
    generation === socialTopologyGeneration
    && state.selectedRunId === run.id
    && selectedRun()?.orchestrationMode === "social";
  try {
    const { messages, diagnostics } = await loadSocialTopologyMessages(run.id);
    if (!canCommit()) return;
    const degraded = diagnostics?.status === "degraded";
    const truncated = diagnostics?.truncated?.bytes === true || diagnostics?.truncated?.messages === true;
    const windowed = truncated || degraded;
    if (!messages.length) {
      commitMarkup(container, degraded
        ? `<div class="empty-state" role="alert"><span>bus 审计降级，暂无法完整重建团队拓扑</span></div>`
        : `<div class="empty-state"><span>暂无对话</span></div>`);
      return;
    }
    const participants = [];
    for (const message of messages) {
      for (const party of [message.from, message.to]) {
        if (party && !participants.includes(party)) participants.push(party);
      }
    }
    const notice = degraded
      ? `<div class="topology-window-note is-degraded" role="alert">bus 审计降级，以下拓扑可能不完整</div>`
      : truncated
        ? `<div class="topology-window-note" role="status">仅按最近 ${messages.length} 条消息重建</div>`
        : "";
    commitMarkup(container, notice + participants
      .map((party) => {
        const label = party === "lo" ? "LO" : party === "team" ? "全员" : party === "system" ? "系统" : agentLabel(party);
        const role = party === "lo" ? "用户" : party === "team" ? "广播" : party === "system" ? "编排器" : party === run.coordinatorId ? "leader" : "成员";
        const spoken = messages.filter((message) => message.from === party).length;
        // 参与者卡与会话流同一套 agent 配色槽/双字码（群聊视觉一致性）；最近发言者呼吸高亮
        const chip = party === "lo" ? "LO" : party === "team" ? "全" : party === "system" ? "系" : AGENT_SHORT[party] ?? label.slice(0, 2).toUpperCase();
        const partyCli = agentCli(party);
        const chipContent = partyCli ? cliIconMarkup(partyCli) : escapeHtml(chip);
        const slug = ["lo", "team", "system"].includes(party) ? "" : ` is-agent-${agentSlug(party)}`;
        const speaking = messages.at(-1)?.from === party ? " is-speaking" : "";
        const interactive = party !== "lo" && party !== "team" && party !== "system";
        const tag = interactive ? "button" : "div";
        const attributes = interactive
          ? ` type="button" data-topology-agent="${escapeHtml(party)}" title="打开 ${escapeHtml(label)} 的独立页" aria-label="打开 ${escapeHtml(label)} 的独立页"`
          : "";
        const countLabel = windowed ? `${spoken} 条近期发言` : `${spoken} 条发言`;
        return `<${tag} class="topology-node${slug}${speaking}"${attributes}><span class="topology-chip${partyCli ? " has-cli-logo" : ""}" aria-hidden="true">${chipContent}</span><div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(role)} · ${countLabel}</span></div></${tag}>`;
      })
      .join(""));
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "ABORT_ERR") return;
    if (canCommit()) {
      const retryAt = socialTopologyCache.get(run.id)?.retryAt ?? Date.now();
      const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
      commitMarkup(container, `<div class="empty-state"><span>bus 读取失败，${seconds} 秒后可重试</span></div>`);
    }
  }
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
  const generation = ++socialTopologyGeneration;
  cancelSocialTopologyRequestsExcept(run?.orchestrationMode === "social" ? run.id : null);
  if (!run) {
    commitMarkup(elements["session-topology"], `<div class="empty-state"><span>暂无会话</span></div>`);
    return;
  }
  if (run.orchestrationMode === "social") {
    void renderSocialTopology(run, generation); // 请求去重 + 选中 run/渲染代次双门，旧响应不得倒灌
    return;
  }
  const sessions = Array.isArray(run.sessions) ? run.sessions : [];
  const coordinatorId = run.coordinatorId || "";
  const coordinatorName = coordinatorId ? agentLabel(coordinatorId) : "团队主脑";
  const root = selectPipelineRoot(sessions, coordinatorId) ?? {
    name: coordinatorName,
    agentId: coordinatorId || null,
    role: "orchestrator",
    status: run.status,
  };
  const children = sessions.filter((session) => session !== root).slice(0, 5);
  const nodes = [root, ...children];
  commitMarkup(elements["session-topology"], nodes
    .map((session, index) => {
      const agentId = sessionAgentId(session);
      const name = session.name ?? session.agent_name ?? (agentId ? agentLabel(agentId) : null) ?? session.adapter ?? (index === 0 ? coordinatorName : `Agent ${index}`);
      const role = session === root ? "orchestrator" : session.role ?? session.kind ?? "worker";
      const status = session.status ?? session.state ?? run.status;
      return `<div class="topology-node"><span class="status-dot is-${normalizeStatus(status === "complete" ? "ok" : ACTIVE_RUN_STATES.has(String(status)) ? "pending" : status)}"></span><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(role)} · ${escapeHtml(runStatusText(status))}</span></div></div>`;
    })
    .join(""));
}

function renderWorkbenchEvents() {
  const run = selectedRun();
  // 选中 run 时合并磁盘回放历史（fetchRunEvents）——旧 run 的事件早已滚出 SSE 实时窗口，
  // 只吃 state.events 会让右栏空报"等待事件"（历史在磁盘上明明有）
  const historical = run ? [...historyEventsForRun(run.id)].reverse() : []; // 磁盘回放旧→新，时间线要新→旧
  const merged = [];
  for (const event of [...state.events.filter((item) => !run || item.runId === run.id), ...historical]) {
    // 实时窗口会把连续 delta 聚合成一个 envelope，而磁盘历史保留原始片段。
    // 复用聚合项的 ID/sequence 覆盖关系，避免右栏同时显示聚合项和每个原始片段。
    if (merged.some((tracked) => eventTracksEvent(tracked, event))) continue;
    merged.push(event);
    if (merged.length >= 30) break;
  }
  const events = merged;
  // 事件流彩色分类（精致化波次）：类型前缀→色调，告警词→红，一眼分出治理/总线/agent/自动化
  const eventTone = (type) => {
    const value = String(type);
    if (/fail|error|denied|dropped|blocked/i.test(value)) return "red";
    if (value.startsWith("bus.")) return "aqua";
    if (value.startsWith("agent.")) return "blue";
    if (value.startsWith("automation.")) return "amber";
    if (value.startsWith("run.")) return "rose";
    if (value === "user.message") return "violet";
    return "neutral";
  };
  elements["workbench-event-list"].innerHTML = events.length
    ? events
        .map(
          (event) => `
          <li class="timeline-item is-tone-${eventTone(event.type)}">
            <strong>${escapeHtml(event.type)}</strong>
            <span>${escapeHtml(event.summary)}</span>
            <time>${escapeHtml(formatTime(event.timestamp))}</time>
          </li>`,
        )
        .join("")
    : `<li class="timeline-item"><strong>等待事件</strong><span>${run ? "该任务暂无事件记录" : "SSE 建立后自动刷新"}</span></li>`;
}

// 配置源语义分组：99 个源平铺必乱——按路径拓扑归 13 组（顺序即展示序），
// 运行时/密钥面永远沉底；搜索态退化为平铺结果（分组反而碍事）
const SOURCE_GROUP_META = Object.freeze([
  { key: "core", label: "治理核心", icon: "book-open" },
  { key: "claude", label: "Claude 平台", icon: "sparkles" },
  { key: "codex", label: "Codex 平台", icon: "brain" },
  { key: "cursor", label: "Cursor 平台", icon: "type" },
  { key: "agent-skills", label: "平台技能 · .agents", icon: "bot" },
  { key: "domain-skills", label: "领域技能 · skills/", icon: "puzzle" },
  { key: "console", label: "控制台", icon: "settings" },
  { key: "persona", label: "人格与定制", icon: "palette" },
  { key: "guardrails", label: "守卫层", icon: "shield" },
  { key: "lilith", label: "Lilith 子系统", icon: "orbit" },
  { key: "statusline", label: "状态栏", icon: "activity" },
  { key: "runtime", label: "运行时镜像（只读）", icon: "server" },
  { key: "other", label: "其他", icon: "folder" },
]);

function sourceGroupFor(source) {
  const p = String(source.path ?? "").replace(/\\/g, "/");
  if (source.secret || ["runtime", "secret", "generated"].includes(source.scope)) return "runtime";
  if (p.startsWith(".agents/skills/")) return "agent-skills";
  if (p.startsWith("skills/")) return "domain-skills";
  if (p.startsWith(".claude/") || p.startsWith(".claude-plugin/")) return "claude";
  if (p.startsWith(".codex/")) return "codex";
  if (p.startsWith(".cursor/")) return "cursor";
  if (p.startsWith("config/control-center/") || p.startsWith("schemas/")) return "console";
  if (p.startsWith("output-styles/") || p.startsWith("customize/")) return "persona";
  if (p.startsWith("guardrails/")) return "guardrails";
  if (p.startsWith("lilith/")) return "lilith";
  if (p.startsWith("statusline/")) return "statusline";
  if (p && !p.includes("/")) return "core";
  return "other";
}

function sourceItemMarkup(source) {
  return `
          <button class="source-item${source.id === state.selectedSourceId ? " is-selected" : ""}" type="button" data-source-id="${escapeHtml(source.id)}">
            <span class="source-icon">${escapeHtml(formatBadge(source.format))}</span>
            <span class="source-main">
              <strong>${escapeHtml(source.name)}</strong>
              <span>${escapeHtml(source.path)}</span>
            </span>
            <span class="source-state-icon is-${escapeHtml(source.status)}" title="${escapeHtml(source.status)}"></span>
          </button>`;
}

function renderSources() {
  const filter = state.sourceFilter.trim().toLowerCase();
  const filtered = state.sources.filter((source) =>
    [source.name, source.path, source.scope, source.format].some((value) => String(value).toLowerCase().includes(filter)),
  );
  elements["source-count"].textContent = `${filtered.length}/${state.sources.length}`;
  if (!filtered.length) {
    elements["source-list"].innerHTML = emptyMarkup("没有匹配项", filter ? "调整筛选条件" : "配置索引尚未加载");
    return;
  }
  if (filter) {
    elements["source-list"].innerHTML = filtered.map(sourceItemMarkup).join("");
    return;
  }
  const buckets = new Map();
  for (const source of filtered) {
    const key = sourceGroupFor(source);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(source);
  }
  elements["source-list"].innerHTML = SOURCE_GROUP_META.filter((group) => buckets.has(group.key))
    .map((group) => {
      const items = buckets.get(group.key);
      // 含选中源的组强制展开（selection 可见性优先于手动折叠）
      const expanded = state.sourceGroupsExpanded.has(group.key) || items.some((item) => item.id === state.selectedSourceId);
      return `<section class="source-group${expanded ? " is-expanded" : ""}">
        <button class="source-group-header" type="button" data-source-group="${escapeHtml(group.key)}" aria-expanded="${expanded}">
          <svg class="icon lucide source-group-chevron"><use href="#lucide-chevron-right"></use></svg>
          <svg class="icon lucide"><use href="#lucide-${escapeHtml(group.icon)}"></use></svg>
          <span class="source-group-label">${escapeHtml(group.label)}</span>
          <span class="source-group-count">${items.length}</span>
        </button>
        <div class="source-group-items"${expanded ? "" : " hidden"}>${items.map(sourceItemMarkup).join("")}</div>
      </section>`;
    })
    .join("");
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

let selectedConfigLoadGeneration = 0;
async function loadSelectedConfig() {
  const source = state.sources.find((item) => item.id === state.selectedSourceId);
  if (!source) return successfulLoadResult(null, { skipped: true });
  const generation = ++selectedConfigLoadGeneration;
  setConfigBusy(true);
  try {
    const encoded = encodeURIComponent(source.id);
    const [detailResult, versionsResult] = await Promise.allSettled([
      request(`/api/config/${encoded}`),
      request(`/api/config/${encoded}/versions`),
    ]);
    if (detailResult.status === "rejected") throw detailResult.reason;
    if (generation !== selectedConfigLoadGeneration || state.selectedSourceId !== source.id) {
      return successfulLoadResult(null, { stale: true });
    }
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
    return successfulLoadResult(state.config);
  } catch (error) {
    if (generation !== selectedConfigLoadGeneration || state.selectedSourceId !== source.id) {
      return successfulLoadResult(null, { stale: true });
    }
    state.config = null;
    toast(error.message, "error");
    appendDiagnostic(`配置读取失败 ${source.id}: ${error.message}`, "error");
    return failedLoadResult(error);
  } finally {
    if (generation === selectedConfigLoadGeneration) {
      setConfigBusy(false);
      renderSources();
      renderConfig();
    }
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
    renderConfigTopology();
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
  renderConfigTopology();
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
                ${lucideIcon("history")}
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
  renderConfigTopology();
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
        await loadBootstrap();
        await loadTeams({ fresh: true });
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
        <td><span class="status-label is-${normalizeStatus(healthStatus)}">${escapeHtml(statusText(healthStatus))}</span></td>
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

function captureComposerConfig({ includeRequestedAgents = true } = {}) {
  const target = activeComposerTarget();
  return Object.freeze({
    target: Object.freeze({
      mode: target.mode,
      memberId: target.memberId,
      teamId: target.teamId,
    }),
    requestedAgentIds: Object.freeze(includeRequestedAgents ? [...state.requestedAgentIds] : []),
    permissionMode: elements["task-permission"].value,
    model: elements["task-model-pick"]?.hidden ? undefined : elements["task-model"]?.value || undefined,
    effort: elements["task-effort-pick"]?.hidden ? undefined : elements["task-effort"]?.value || undefined,
    cwd: state.pendingRemote ? undefined : state.pendingCwd || undefined, // 远程位置与 cwd 互斥（后端同口径）
    remote: state.pendingRemote
      ? { hostId: state.pendingRemote.hostId, path: state.pendingRemote.path }
      : undefined, // v41：远程 run 运行位置（hostName/projectId 仅 UI 用，不出机）
  });
}

async function previewRoute(
  prompt,
  kind,
  risk,
  currentSource,
  composerTarget = activeComposerTarget(),
  requestedAgentIds = state.requestedAgentIds,
) {
  const taskType = kind === "auto" ? undefined : kind;
  const payload = await request(API.routerPreview, {
    method: "POST",
    body: {
      prompt,
      taskType,
      risk,
      needsCurrentSource: Boolean(currentSource),
      teamId: composerTarget.teamId || state.selectedTeamId, // 预览与正式路由同一团队契约
      startAgentId: composerTarget.memberId || undefined,
      requestedAgentIds: requestedAgentIds.length ? [...requestedAgentIds] : undefined,
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
  // 停止模式：活跃 run + 空输入时发送键已切为停止键——级联取消（走既有确认弹窗），不走发送路径
  if (elements["submit-task-button"]?.dataset.mode === "stop") {
    void cancelSelectedRun();
    return;
  }
  // 胶囊双模式分流：选中任务且非历史预览 → 续聊当前原生会话；否则新建任务
  if (selectedRun() && !state.sessionPreview) return continueSelectedRun(event);
  const prompt = elements["task-input"].value.trim();
  if (!prompt) return;
  // v3.6：社会模拟是默认内置模式（无需前缀）；/pipeline 为旧拓扑后门
  const legacy = /^\/pipeline\s+/i.test(prompt);
  const effectivePrompt = legacy ? prompt.replace(/^\/pipeline\s+/i, "").trim() : prompt;
  if (!effectivePrompt) return toast("任务内容为空", "warning");
  // 档位对标 CLI：/effort 折叠下拉恒有值；权限折叠下拉（plan/build）；路由风险固定 medium
  const risk = "medium";
  const fullPrompt = effectivePrompt;
  const submissionSources = [...state.attachments];
  const submission = captureComposerConfig({ includeRequestedAgents: !legacy });
  const composerTarget = submission.target;
  if (!composerTarget.memberId) return toast("当前团队没有可发送的主脑或成员", "warning");
  elements["submit-task-button"].disabled = true;

  let route = null;
  try {
    route = await previewRoute(
      fullPrompt,
      "auto",
      String(risk),
      false,
      composerTarget,
      submission.requestedAgentIds,
    ); // 预览与实际提交消费同一不可变快照
  } catch (error) {
    appendDiagnostic(`任务预路由不可用，将由运行时最终路由：${error.message}`, "warning");
  }

  try {
    const payload = await request(API.runs, {
      method: "POST",
      body: {
        prompt: fullPrompt,
        taskType: undefined,
        risk,
        execute: true,
        collaborationMode: "deep",
        orchestrationMode: legacy ? "pipeline" : undefined, // v3.6：默认社会模拟；/pipeline 走旧拓扑
        startAgentId: composerTarget.memberId, // 活动目标标签就是首个直接收件人
        requestedAgentIds: submission.requestedAgentIds.length ? [...submission.requestedAgentIds] : undefined,
        permissionMode: submission.permissionMode,
        teamId: composerTarget.teamId || state.selectedTeamId, // 会话按所选团队隔离能力配比
        maxBudgetUsdPerTurn: 2, // 真实 CLI 带工具轮，0.75 默认必超线；用满 policy 上限（permissions.json 可调）
        model: submission.model, // 当前直接目标的 CLI 模型（空=该 profile 默认）
        effort: submission.effort, // 当前直接目标的 CLI 推理力度
        cwd: submission.cwd, // 会话项目地址（空=控制面默认 repoRoot）
        remote: submission.remote, // v41：远程运行位置 {hostId, path}（与 cwd 互斥；空=本机）
        sources: submissionSources.length ? submissionSources : undefined,
      },
    });
    const raw = payload?.run ?? payload;
    const run = normalizeRun(raw ?? { prompt, risk, status: "planning" }, 0);
    state.runs = [run, ...state.runs.filter((item) => item.id !== run.id)];
    if (state.sessionPreview) closeSessionPreview({ restoreFocus: false }); // 新任务落地即退出历史预览（烛 R5 致命2）
    elements["task-input"].value = "";
    syncSideChatDraftFromComposer();
    state.requestedAgentIds = [];
    renderRequestedAgentChips();
    state.attachments = [];
    renderAttachments();
    openTab(run.id, composerTarget.memberId);
    // 严格归属制（LO 2026-08-10）：选了目录的任务，项目未归属时自动归属创建团队——
    // 团队树下只挂归属项目，不自动归属就等于任务在跑、文件夹却在「未归属」组里
    if (submission.cwd) assignCwdProjectToTeam(submission.cwd, composerTarget.teamId || state.selectedTeamId);
    toast("任务已交给控制面", "success");
    appendDiagnostic(`任务创建 ${run.id}: ${prompt.slice(0, 80)}`);
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`任务创建失败：${error.message}`, "error");
  } finally {
    elements["submit-task-button"].disabled = false;
  }
}

function buildContinueMessage({ run, prompt, agentId, agentLock, acknowledgeRecovery = false }) {
  const teamAnswer = Boolean(run.pendingAsk) && agentId === run.pendingAsk.from;
  const answerToAskId = teamAnswer ? String(run.pendingAsk?.id ?? "").trim() : "";
  const message = { prompt };

  if (answerToAskId) {
    Object.assign(message, { messageIntent: "answer", agentId, answerToAskId });
  } else if (!teamAnswer) {
    Object.assign(message, { messageIntent: "steer", agentId });
  }
  // 无 ID 的 pendingAsk 走旧版 /messages 恢复合同：不发送 intent 或所有权 ID。
  if (acknowledgeRecovery) message.acknowledgeRecovery = true;
  return { message, teamAnswer };
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
    const composerTarget = activeComposerTarget();
    if (!composerTarget.memberId) throw new Error("当前会话没有可发送的团队成员");
    const agentLock = composerTarget.memberId;
    const { message, teamAnswer } = buildContinueMessage({
      run,
      prompt,
      agentId: composerTarget.memberId,
      agentLock,
      acknowledgeRecovery: acknowledge,
    });
    if (state.attachments.length) {
      await request(`/api/runs/${encodeURIComponent(run.id)}/sources`, {
        method: "POST",
        body: { sources: [...state.attachments] },
      });
    }
    const payload = await request(`/api/runs/${encodeURIComponent(run.id)}/messages`, {
      method: "POST",
      body: message,
    });
    const updated = normalizeRun(payload?.run ?? payload, 0);
    state.runs = [updated, ...state.runs.filter((item) => item.id !== updated.id)];
    state.recoveryAckRunId = null; // 确认标记一次性消费
    elements["task-input"].value = "";
    syncSideChatDraftFromComposer();
    state.attachments = [];
    renderAttachments();
    // 排队与即时送达如实区分：活跃 run 的 continue 进 pendingSteer，不是"已完成"
    const queuedDepth = Array.isArray(updated.pendingSteer) ? updated.pendingSteer.length : 0;
    toast(queuedDepth
      ? `轮间插话已排队（第 ${queuedDepth} 位），当前轮结束后送达`
      : teamAnswer ? "回答已提交" : "续接消息已完成", "success");
    renderRuns();
  } catch (error) {
    toast(sendErrorText(error, run), "error");
    appendDiagnostic(`会话续接失败 ${run.id}: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
}

/**
 * 续接失败的人话文案。服务端错误按约定是英文技术串（statusFor 靠 code 分流），
 * 直接 toast 出来等于把内部实现丢给人看——ROUND_LIMIT 的原文 "maximum collaboration
 * rounds reached" 既没说上限是多少，也没说下一步该做什么（LO 2026-08-08 问的就是这条）。
 */
function sendErrorText(error, run) {
  const code = error?.payload?.error?.code ?? error?.code ?? "";
  if (code === "ROUND_LIMIT") {
    const used = Number(run?.round) || 0;
    const cap = Number(run?.maxRounds) || used;
    return `本任务已用满 ${used}/${cap} 轮协作上限，无法再续接。请「在新任务中继续」——原生会话历史会带过去，不会从零开始。`;
  }
  if (code === "INSUFFICIENT_ROUNDS") {
    return `所选协作拓扑至少需要 ${Number(error?.payload?.error?.minimumRounds) || "更多"} 轮，请提高轮次上限或换更简单的拓扑。`;
  }
  return error?.message ?? "续接失败";
}

async function cancelSelectedRun() {
  const run = selectedRun();
  if (!run || !ACTIVE_RUN_STATES.has(run.status)) return;
  const members = [...new Set([
    ...(Array.isArray(run.teamMembers) ? run.teamMembers : []),
    run.coordinatorId,
    run.startAgentId,
    ...sessionAgentIds(run.sessions),
  ].filter(Boolean))];
  const memberLabels = members.map((id) => agentLabel(id)).join(" · ") || "当前活跃 CLI";
  const confirmed = await confirmAction({
    eyebrow: "多 CLI 任务控制",
    title: "取消当前任务并级联中止？",
    rows: [
      ["任务", run.title],
      ["Run ID", run.id],
      ["当前状态", runStatusText(run.status, run)],
      ["将中止成员", memberLabels],
      ["权限模式", run.permissionMode || "plan"],
    ],
    warning: "控制面将 abort 本 run 执行树：全部团队成员的 provider 子进程一并中止；挂起的 ask/审批租约作废。已生成的事件、总线与产物保留可回放。",
    confirmLabel: "确认级联取消",
    danger: true,
  });
  if (!confirmed) return;
  elements["cancel-run-button"].disabled = true;
  try {
    const result = await request(`/api/runs/${encodeURIComponent(run.id)}/cancel`, { method: "POST", body: { source: "control-center" } });
    run.status = "cancelled";
    const cascade = result?.cancelCascade?.agents?.length
      ? result.cancelCascade.agents.map((id) => agentLabel(id)).join(" · ")
      : memberLabels;
    toast(`已级联取消：${cascade}`, "success", 4200);
    appendDiagnostic(`任务级联取消 ${run.id} · ${cascade}`);
    renderRuns();
    renderSelectedRun();
  } catch (error) {
    toast(error.message, "error");
    appendDiagnostic(`任务取消失败 ${run.id}: ${error.message}`, "error");
    elements["cancel-run-button"].disabled = false;
  }
}

// 会话头多 CLI 身份条：一眼看到本 run 谁在场、谁有原生会话
function renderConversationAgents(run) {
  const el = byId("conversation-agents");
  if (!el) return;
  if (!run) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const members = [...new Set([
    ...(Array.isArray(run.teamMembers) ? run.teamMembers : []),
    run.coordinatorId,
    run.startAgentId,
    ...(run.turns || []).map((turn) => turn.agentId),
  ].filter(Boolean))];
  if (!members.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const spoken = new Set((run.turns || []).map((turn) => turn.agentId).filter(Boolean));
  const sessions = new Set(sessionAgentIds(run.sessions));
  el.hidden = false;
  el.innerHTML = members.map((id) => {
    const cli = agentCli(id);
    const logo = cli ? cliIconMarkup(cli, "cli-logo") : "";
    const hasSession = sessions.has(id);
    const didSpeak = spoken.has(id);
    const isLeader = id === run.coordinatorId;
    const isStart = id === run.startAgentId;
    const isExecutionOwner = id === run.executionOwnerId;
    const classes = [
      "conversation-agent-chip",
      `is-agent-${agentSlug(id)}`,
      didSpeak ? "is-spoke" : "",
      hasSession ? "has-session" : "",
      isLeader ? "is-leader" : "",
    ].filter(Boolean).join(" ");
    const title = [
      agentLabel(id),
      isLeader ? "leader" : null,
      isStart ? "直接收件人" : null,
      isExecutionOwner && run.permissionMode === "build" ? "写入所有者" : null,
      hasSession ? "有原生会话" : "无原生会话",
      didSpeak ? "已发言" : "未发言",
    ].filter(Boolean).join(" · ");
    const tags = [
      isLeader ? `<em class="chip-tag">L</em>` : "",
      isStart ? `<em class="chip-tag is-start">收</em>` : "",
      isExecutionOwner && run.permissionMode === "build" ? `<em class="chip-tag is-start">写</em>` : "",
      didSpeak ? `<em class="chip-tag is-spoke">言</em>` : "",
    ].filter(Boolean).join("");
    return `<span class="${classes}" title="${escapeHtml(title)}">${logo}<span>${escapeHtml(agentLabel(id))}</span>${tags}</span>`;
  }).join("");
}

function normalizeEvent(raw, eventName = "message", { sourceCharacters = 0 } = {}) {
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
  const contentText = payloadText(content);
  // timeline/diagnostic 只需要有界摘要；完整正文已在 data 中保留。这里若先全文 redact，
  // MiB 级 assistant/tool 事件会在 JSON.parse 后立刻再扫两遍主线程并复制大字符串。
  const summary = redact(contentText.slice(0, 2 * 1024)).slice(0, 500);
  const boundedContent = redact(contentText.slice(0, 4 * 1024));
  const event = {
    id: String(envelope.eventId ?? envelope.event_id ?? envelope.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    type,
    timestamp: envelope.occurred_at ?? envelope.timestamp ?? envelope.created_at ?? new Date().toISOString(),
    seq: envelope.sequence ?? envelope.seq ?? "--",
    runId: String(envelope.runId ?? envelope.run_id ?? payload.runId ?? payload.run_id ?? ""),
    sessionId: String(envelope.sessionId ?? envelope.session_id ?? payload.sessionId ?? payload.session_id ?? ""),
    agentId: String(envelope.agentId ?? envelope.agent_id ?? payload.agentId ?? payload.agent_id ?? ""),
    correlationId: String(envelope.correlationId ?? envelope.correlation_id ?? ""),
    summary,
    content: boundedContent,
    data: payload, // 结构化载荷（assistant text+tools / tool.result results / turn round）——对话重建一等来源
  };
  const sourceBytes = normalizedEventSourceBytes(sourceCharacters);
  if (sourceBytes) globalEventBytes.set(event, sourceBytes);
  return event;
}

function isDeltaEventType(type) {
  // Codex app-server 使用 codex.item/agentMessage/delta；旧适配器也可能发 *.delta。
  return /(?:^|[./])delta$/i.test(String(type ?? ""));
}

function eventAffectsConversation(event) {
  if (isDeltaEventType(event.type)) return false; // final assistant.message 才提交正文
  // Codex 过程可见性：完成态的 item 携带命令/输出/改动，是"它到底做了什么"的唯一来源。
  // item/started 只喂活跃行（见 codexActivity），不进历史，避免每条命令留两行。
  // reasoning 完成但无摘要时 progress 只带 id（清活跃记账用）——不落一张空的「推理摘要」历史卡
  if (event.type === "codex.item/completed") {
    const progress = event.data?.progress;
    return Boolean(progress) && !(progress.kind === "reasoning" && !progress.text);
  }
  if (["assistant.message", "tool.result", "agent.turn_started", "agent.turn_completed", "tool.event", "user.message"].includes(event.type)) return true;
  if (event.type === "grok.completed") return Boolean(event.data?.text);
  if (["agent.error", "adapter.parse_error", "adapter.stderr"].includes(event.type)) return true;
  return Boolean(GOVERNANCE_EVENTS[event.type]);
}

const pendingEventRender = {
  overview: false,
  diagnostics: false,
  tabs: false,
  selectedRun: false,
  topology: false,
  workbenchEvents: false,
  announcementEvent: null,
  announcementCount: 0,
};
let eventRenderFrame = 0;
// busy 闸等待帧数：正常分批挂载（≤160 条、8 条/批）几秒即完成；超过上限仍 busy 视为
// 挂载僵死（异常逃出兜底的极端情况）——强制复位放重渲，不再无限空转（LO 2026-08-10）
const STREAM_BUSY_WAIT_MAX_FRAMES = 600; // ≈10 秒前台帧
let streamBusyWaitFrames = 0;

function flushEventRenderBatch() {
  eventRenderFrame = 0;
  const batch = { ...pendingEventRender };
  pendingEventRender.overview = false;
  pendingEventRender.diagnostics = false;
  pendingEventRender.tabs = false;
  pendingEventRender.selectedRun = false;
  pendingEventRender.topology = false;
  pendingEventRender.workbenchEvents = false;
  pendingEventRender.announcementEvent = null;
  pendingEventRender.announcementCount = 0;

  if (batch.diagnostics) renderDiagnosticLog();
  if (batch.tabs) {
    renderTabs();
    persistTabs();
  }
  if (batch.overview) renderOverview();
  const stream = elements["conversation-stream"];
  const streamMountBusy = stream.getAttribute("aria-busy") === "true";
  if (batch.selectedRun && streamMountBusy && streamBusyWaitFrames < STREAM_BUSY_WAIT_MAX_FRAMES) {
    // 分批历史挂载期间不允许 SSE 用半成品 DOM 抢走焦点/滚动快照。挂载结束后的下一帧
    // 再基于完整 DOM 合并最新事件；selectedRun 标志同时把 burst 压成一次提交。
    streamBusyWaitFrames += 1;
    pendingEventRender.selectedRun = true;
    if (!eventRenderFrame) eventRenderFrame = window.requestAnimationFrame(flushEventRenderBatch);
  } else if (batch.selectedRun) {
    if (streamMountBusy) {
      // 僵死复位：作废旧挂载代际（它的 stillOwned 检查会让它自殁），清闸后走完整重渲
      appendDiagnostic("会话流挂载闸超时，已强制复位并重渲", "error");
      conversationRenderGeneration += 1;
      pendingConversationMarkup.delete(stream);
      stream.removeAttribute("aria-busy");
    }
    streamBusyWaitFrames = 0;
    renderSelectedRun();
  }
  else {
    streamBusyWaitFrames = 0;
    if (batch.topology) renderTopology(selectedRun());
    if (batch.workbenchEvents) renderWorkbenchEvents();
  }

  const current = selectedRun();
  const announcement = batch.announcementEvent;
  if (
    announcement
    && current
    && !state.sessionPreview
    && (!announcement.runId || announcement.runId === current.id)
  ) {
    elements["conversation-live-status"].textContent = batch.announcementCount > 1
      ? `会话收到 ${batch.announcementCount} 条更新，最新事件 ${announcement.type}`
      : `会话更新：${announcement.type}`;
  }
}

function scheduleEventRender(flags, event) {
  let hasWork = false;
  for (const name of ["overview", "diagnostics", "tabs", "selectedRun", "topology", "workbenchEvents"]) {
    if (flags[name]) {
      pendingEventRender[name] = true;
      hasWork = true;
    }
  }
  if (flags.announce) {
    pendingEventRender.announcementEvent = event;
    pendingEventRender.announcementCount += 1;
    hasWork = true;
  }
  if (!hasWork) return;
  if (!eventRenderFrame) eventRenderFrame = window.requestAnimationFrame(flushEventRenderBatch);
}

function pushEvent(event) {
  const sequence = Number(event.seq);
  if (Number.isSafeInteger(sequence)) state.lastEventSequence = Math.max(state.lastEventSequence, sequence);
  const previous = state.events[0];
  const duplicateEvent = state.events.some((item) => eventTracksEvent(item, event));
  let eventChanged = false;
  if (!duplicateEvent) freezeLatestConversationWindowForIncoming(event);
  if (!duplicateEvent && event.runId && !Object.hasOwn(state.runEvents, event.runId)) {
    bufferInflightRunHistoryEvent(event.runId, event);
  }
  if (!duplicateEvent && canMergeDeltaEvent(previous, event)) {
    mergeDeltaEvent(previous, event);
    eventChanged = true;
  } else if (!duplicateEvent) {
    state.events.unshift(event);
    const eventBytes = globalEventBytes.get(event) ?? normalizedEventResidentBytes(event);
    globalEventBytes.set(event, eventBytes);
    globalEventResidentBytes += eventBytes;
    while (state.events.length > GLOBAL_EVENT_MAX_COUNT || globalEventResidentBytes > GLOBAL_EVENT_MAX_BYTES) {
      const dropped = state.events.pop();
      if (!dropped) break;
      globalEventResidentBytes = Math.max(0, globalEventResidentBytes - (globalEventBytes.get(dropped) ?? 0));
    }
    eventChanged = true;
  }
  // 已完成磁盘回放的 run 必须持续吸收 SSE。否则全局 160 条实时窗口滚动后，磁盘快照
  // 尾部与实时窗口头部之间会出现确定性缺口。重复/增量语义由缓存 helper 与上面保持一致。
  if (event.runId && Object.hasOwn(state.runEvents, event.runId)) {
    appendLiveRunHistoryEvent(event.runId, event);
  }
  if (!eventChanged) return; // SSE 重连可能回放边界事件；重复项不触发诊断或 DOM 提交
  const activityChanged = trackCodexActivity(event);
  missionControlDock?.observeEvent(event);
  const delta = isDeltaEventType(event.type);
  const conversationEvent = eventAffectsConversation(event);
  const diagnostic = !delta && /run\.|task\.|session\.|message|tool|route|approval|config\./i.test(event.type);
  if (diagnostic) appendDiagnostic(`${event.type} ${event.summary}`, "info", { render: false });
  // tab 脏标：非活跃页签的 run 有新事件 → 页签落点（切回即清，sessionStorage 同步）
  let tabsChanged = false;
  if (event.runId && conversationEvent) {
    for (const tab of state.tabs) {
      if (tab.runId === event.runId && tab.key !== state.activeTabKey && !tab.dirty) {
        tab.dirty = true;
        tabsChanged = true;
      }
    }
  }
  const matchesSelectedRun = Boolean(state.selectedRunId && event.runId === state.selectedRunId && !state.sessionPreview);
  const selectedRunUpdate = state.view === "workbench" && matchesSelectedRun && (conversationEvent || activityChanged);
  const topologySignal = event.type === "bus.appended" || event.type === "bus.routed" || event.type === "user.message";
  const topologyUpdate = state.view === "workbench" && matchesSelectedRun && topologySignal;
  if (topologySignal && event.runId) invalidateSocialTopology(event.runId);
  const visibleWorkbenchEvent = state.view === "workbench"
    && !delta
    && (state.selectedRunId ? event.runId === state.selectedRunId : true);
  scheduleEventRender(
    {
      overview: state.view === "overview" && !delta,
      diagnostics: diagnostic && state.view === "security",
      tabs: tabsChanged,
      selectedRun: selectedRunUpdate,
      topology: topologyUpdate && !selectedRunUpdate,
      workbenchEvents: visibleWorkbenchEvent && !selectedRunUpdate,
      announce: selectedRunUpdate,
    },
    event,
  );
  // run 列表重载闸（450ms 防抖）。recovery_required/round_refunded 让恢复条与轮次 meta 即时反映真实
  // 状态；user.message/agent.turn_started 让"确认恢复后继续"尽快翻页——直接续聊的 HTTP 要等整轮跑完
  // 才返回（orchestrator continue 返回 tracked），期间 state.runs 停在 recovery_required 旧快照，
  // 恢复条会被 SSE 重渲染反复挂回（LO 2026-08-09：确认后恢复条一整轮不消失）。
  if (/run\.(created|updated|completed|failed|cancelled|steer_queued|steer_dropped|waiting_input|budget_exhausted|worktree_created|recovery_required|recovery_acknowledged|round_refunded|control_changed)|task\.|agent\.(turn_started|turn_completed)|user\.message|assistant\.message/i.test(event.type)) scheduleRunsReload();
  if (/^automation\./.test(event.type)) void loadAutomations().catch(() => {});
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
  if (!data.length) return;
  const serialized = data.join("\n");
  const parsed = JSON.parse(serialized);
  if (eventName === "ready") {
    applyStreamEpoch(readStreamEpochFromReadyPayload(parsed), { source: "ready" });
    return;
  }
  const event = normalizeEvent(parsed, eventName, { sourceCharacters: serialized.length });
  if (id && event.seq === "--") event.seq = Number(id) || id;
  pushEvent(event);
}

function applyStreamEpoch(nextEpoch, { source = "sse" } = {}) {
  const result = nextStreamEpochState(state.streamEpoch, nextEpoch);
  if (!result.epoch) return false;
  if (result.resetSequence) {
    state.lastEventSequence = 0;
    state.streamEpoch = result.epoch;
    appendDiagnostic(`事件流已重置（${source} epoch 变更）`, "warning");
    toast("事件流已重置，从头续订", "warning", 3200);
    return true;
  }
  if (!state.streamEpoch) state.streamEpoch = result.epoch;
  return false;
}

async function consumeEvents(controller) {
  let retryMs = 1200;
  while (!controller.signal.aborted) {
    try {
      const headers = { Accept: "text/event-stream" };
      if (getAccessToken()) headers.Authorization = `Bearer ${getAccessToken()}`;
      const response = await fetch(`${API.events}?after=${state.lastEventSequence}&view=ui`, { headers, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`事件通道返回 HTTP ${response.status}`);
      // RT-03：服务端 stream epoch；变更时游标归零，禁止跨重启盲续
      applyStreamEpoch(readStreamEpochFromHeaders(response.headers), { source: "header" });
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
  const leases = state.leases;
  const openLeases = leases.filter((item) => item.gateOpen === true).length;
  elements["approval-summary"].textContent = `${pending.length} 项待处理 · ${openLeases} 个执行租约有效`;
  elements["approval-summary"].className = `status-label is-${pending.length ? "warning" : "ok"}`;
  const approvalRows = pending
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
        .join("");
  const leaseRows = leases.map((lease) => capabilityLeaseMarkup(lease, { inline: false })).join("");
  elements["approval-list"].innerHTML = approvalRows || leaseRows
    ? `${approvalRows}${leaseRows}`
    : emptyMarkup("暂无待处理审批或执行租约", "权限请求会在这里等待显式决定");
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
  void renderRemoteGates();

  const healthErrors = state.components.filter((item) => normalizeStatus(item.status) === "error").length;
  elements["security-summary"].textContent = healthErrors ? `${healthErrors} 项异常` : state.apiState === "ok" ? "门禁已加载" : "检查中";
  elements["security-summary"].className = `status-label is-${healthErrors ? "error" : state.apiState === "ok" ? "ok" : "pending"}`;
}

async function renderRemoteGates() {
  const host = byId("remote-gates-list");
  if (!host) return;
  try {
    const data = await request("/api/security/remote-gates");
    const gates = Array.isArray(data?.gates) ? data.gates : [];
    state.remoteGates = gates;
    host.innerHTML = gates.length
      ? gates.map((gate) => `
        <article class="remote-gate-card is-${escapeHtml(gate.status || "blocked")}">
          <div class="remote-gate-main">
            <strong>${escapeHtml(gate.title || gate.id)}</strong>
            <span class="remote-gate-status">${escapeHtml(gate.status || "blocked")}</span>
          </div>
          <p>${escapeHtml(gate.reason || "未授权")}</p>
          <span class="subtle">上游参考：${escapeHtml(gate.upstream || "—")}</span>
        </article>`).join("")
      : emptyMarkup("远程能力门闩未返回", "控制面 fail-closed");
  } catch (error) {
    host.innerHTML = emptyMarkup("远程门闩读取失败", error.message);
  }
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
      await loadTeams({ fresh: true });
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
  const filter = state.diagnosticLogFilter || "all";
  const lines = filter === "all"
    ? state.diagnosticLog
    : state.diagnosticLog.filter((line) => (line.match(/^\[[^\]]*\]\s*\[([A-Z]+)\]/)?.[1] ?? "").toLowerCase() === filter);
  elements["diagnostic-log"].textContent = lines.length
    ? lines.join("\n")
    : state.diagnosticLog.length ? `当前级别（${filter}）暂无日志。` : "等待控制面事件。";
}

function renderAll() {
  if (state.view === "overview") renderOverview();
  renderRuns();
  renderSources();
  renderConfig();
  renderRouter();
  renderModels();
  renderSecurity();
  renderDiagnostics();
  renderDiagnosticLog();
  renderConfigTopology();
}

async function refreshSourcesAndSelectedConfig() {
  await loadSources();
  if (!state.selectedSourceId || configIsDirty()) return successfulLoadResult(null, { skipped: true });
  return loadSelectedConfig();
}

async function refreshCurrentView() {
  elements["refresh-button"].disabled = true;
  const jobs = [];
  if (state.view === "overview") jobs.push(loadHealth(), loadRuns(), loadSources());
  if (state.view === "workbench") jobs.push(loadRuns(), loadProjects({ refresh: true }), loadTeams());
  if (state.view === "config") {
    jobs.push(
      refreshSourcesAndSelectedConfig(),
      loadCapabilities(),
      loadTeams().then(async (teamsResult) => {
        const providersResult = await loadProviders();
        return loadResultFailed(teamsResult) ? teamsResult : providersResult;
      }),
      runtimeSeatManager?.load({ fresh: true }).then((ok) => ok === false
        ? failedLoadResult(new Error("运行席位读取失败"))
        : successfulLoadResult(state.runtimeSeatsData)),
    );
    if (window.__forgeCcSwitchPanel?.refresh) jobs.push(window.__forgeCcSwitchPanel.refresh());
  }
  if (state.view === "router") jobs.push(loadBootstrap());
  if (state.view === "security") jobs.push(runDiagnostics(), loadBootstrap(), loadApprovals());
  if (state.view === "observability") { state.obsLoaded = false; jobs.push(loadObservability()); }
  if (state.view === "sessions") jobs.push(loadSessions());
  if (state.view === "team") {
    jobs.push(loadTeams().then(async (teamsResult) => {
      const flowResult = await refreshCollabFlow();
      return loadResultFailed(teamsResult) ? teamsResult : flowResult;
    }));
  }
  const settled = await Promise.allSettled(jobs);
  const failures = settled.filter((item) => item.status === "rejected" || loadResultFailed(item.value));
  if (failures.length) toast(`${failures.length} 项刷新失败`, "warning");
  else toast("数据已刷新", "success", 2200);
  elements["refresh-button"].disabled = false;
  renderAll();
}

function collectWorkbenchGitDraft(action) {
  return new Promise((resolveDraft) => {
    const dialog = byId("workbench-git-dialog");
    const title = byId("workbench-git-title");
    const note = byId("workbench-git-note");
    const field = byId("workbench-git-message-field");
    const message = byId("workbench-git-message");
    const planButton = byId("workbench-git-plan-button");
    if (!dialog || !message) return resolveDraft(null);
    const committing = action === "commit";
    dialog.returnValue = "";
    title.textContent = committing ? "提交已暂存变更" : "推送当前分支";
    note.textContent = committing
      ? "协作台只提交暂存区，不会自动执行 git add。"
      : "协作台只推送当前分支到已配置 upstream，不会设置上游或 force push。";
    field.hidden = !committing;
    message.required = committing;
    message.value = "";
    planButton.textContent = committing ? "检查提交计划" : "检查推送计划";
    dialog.addEventListener("close", () => {
      resolveDraft(dialog.returnValue === "plan"
        ? { action, message: committing ? message.value.trim() : "" }
        : null);
    }, { once: true });
    dialog.showModal();
    if (committing) message.focus({ preventScroll: true });
  });
}

async function runWorkbenchGitAction(action) {
  const draft = await collectWorkbenchGitDraft(action);
  if (!draft) return;
  try {
    const run = selectedRun() && !state.sessionPreview ? selectedRun() : null;
    const plan = await request(API.workbenchGitPlan, {
      method: "POST",
      body: { runId: run?.id || undefined, action, message: draft.message },
    });
    const changes = plan.changes || {};
    const confirmed = await confirmAction({
      eyebrow: "Git 双阶段确认",
      title: action === "commit" ? "确认提交暂存区" : "确认推送当前分支",
      rows: [
        ["仓库", plan.repository || "当前仓库"],
        ["分支", plan.branch || "detached"],
        [action === "commit" ? "暂存变更" : "上游", action === "commit" ? `${changes.staged || 0} 个文件` : plan.upstream || "未配置"],
        ["计划有效期", formatTime(plan.expiresAt)],
      ],
      warning: action === "commit"
        ? "只提交计划签名时的暂存内容；暂存区变化会使计划失效。"
        : "只执行普通 git push；HEAD 或 upstream 变化会使计划失效。",
      confirmLabel: action === "commit" ? "提交" : "推送",
      confirmationText: plan.confirmation,
      danger: true,
    });
    if (!confirmed) return;
    const result = await request(API.workbenchGitExecute, {
      method: "POST",
      body: { planId: plan.planId, confirmation: plan.confirmation },
    });
    toast(result.summary || (action === "commit" ? "提交完成" : "推送完成"), "success", 5000);
    workbenchEnvironmentPanel?.refresh?.();
  } catch (error) {
    toast(`Git 操作未执行：${error.message}`, "error", 7000);
  }
}

// 外链统一出口：先开 about:blank 再断 opener 后 replace——绝不把本控制面的 window 引用交给外站。
// 右栏浏览器页与「在浏览器中打开」对话框共用这一条路径，避免两处安全实现漂移。
function openExternalUrl(href) {
  try {
    const target = new URL(href);
    if (!new Set(["http:", "https:"]).has(target.protocol)) throw new Error("只允许 HTTP(S) 地址");
    const opened = window.open("about:blank", "_blank");
    if (!opened) {
      toast("浏览器拦截了新标签页，请允许此站点打开窗口", "warning", 5000);
      return false;
    }
    opened.opener = null;
    opened.location.replace(target.href);
    return true;
  } catch (error) {
    toast(`无法打开地址：${error.message}`, "error");
    return false;
  }
}

function openWorkbenchBrowser(initialUrl = "") {
  const dialog = byId("workbench-browser-dialog");
  const input = byId("workbench-browser-url");
  if (!dialog || !input) return;
  dialog.returnValue = "";
  input.value = initialUrl || "https://";
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "open") return;
    openExternalUrl(input.value);
  }, { once: true });
  dialog.showModal();
  input.focus({ preventScroll: true });
  input.select();
}

function setMissionSideChat(open) {
  const panel = byId("mission-side-chat");
  const input = byId("mission-side-chat-input");
  if (!panel || !input) return;
  panel.hidden = !open;
  if (!open) return;
  syncSideChatTarget();
  input.value = elements["task-input"]?.value || "";
  input.focus({ preventScroll: true });
}

function syncSideChatDraftFromComposer() {
  const panel = byId("mission-side-chat");
  const input = byId("mission-side-chat-input");
  if (!panel || panel.hidden || !input || document.activeElement === input) return;
  input.value = elements["task-input"]?.value || "";
}

// 换 run 不触发标签激活，但审阅/文件页的内容是随 run 走的——必须主动让当前页重新对账。
// railPanels 内部按 runId 缓存，重复调用不会产生多余请求。
function syncRailToActiveRun() {
  const activeId = railTools?.activeId();
  if (activeId) railPanels?.activate(activeId);
}

function handleWorkbenchEnvironmentAction(action, payload = {}) {
  const run = selectedRun() && !state.sessionPreview ? selectedRun() : null;
  if (action === "commit" || action === "push") {
    void runWorkbenchGitAction(action);
    return;
  }
  if (action === "pull-request") {
    if (payload.url) openWorkbenchBrowser(payload.url);
    else toast("当前分支没有可打开的 Pull Request", "warning");
    return;
  }
  if (action === "terminal") {
    byId("global-terminal-toggle")?.click(); // 终端是底部抽屉（LO 图4：左图标开下侧终端）
    return;
  }
  if (action === "browser") {
    if (railTools) railTools.open("browser");
    else openWorkbenchBrowser();
    return;
  }
  if (action === "files") {
    if (railTools) railTools.open("files");
    else if (!missionControlDock?.openWorkspace?.()) toast("先选择一个任务，再打开其受控项目文件", "warning");
    return;
  }
  if (action === "sources-add") {
    // 环境舱的来源 ➕ 与 Composer 附件是同一条链路：只有一处真相，避免两套附件状态漂移
    elements["attach-button"]?.click();
    return;
  }
  if (action === "review" || action === "changes") {
    if (!run) {
      toast("先选择一个任务，再打开审阅产物", "warning");
      return;
    }
    // 审阅现在是右栏独立工具页（参考图形态）；无 railTools 时退回产物页内的 diff 折叠
    if (railTools) {
      railTools.open("review");
      if (!run.worktreePath) toast("该任务没有隔离 worktree；审阅页只显示工作树状态", "info", 4500);
      return;
    }
    missionControlDock?.activateTab?.("artifacts");
    if (run.worktreePath) void toggleRunDiff(run.id);
    else toast("该任务没有隔离 worktree diff；已打开任务产物与文件入口", "info", 4500);
    return;
  }
  if (action === "side-chat") setMissionSideChat(byId("mission-side-chat")?.hidden !== false);
}

function confirmAction({
  eyebrow,
  title,
  rows = [],
  warning = "",
  confirmLabel = "确认",
  danger = false,
  checkbox = null,
  confirmationText = null,
}) {
  return new Promise((resolve) => {
    const dialog = elements["action-dialog"];
    elements["dialog-eyebrow"].textContent = eyebrow;
    elements["dialog-title"].textContent = title;
    elements["dialog-body"].innerHTML = `
      <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
      ${warning ? `<div class="dialog-warning">${escapeHtml(warning)}</div>` : ""}
      ${checkbox ? `<label class="dialog-check"><input type="checkbox" id="dialog-check-input"${checkbox.checked ? " checked" : ""} /><span>${escapeHtml(checkbox.label)}</span></label>` : ""}
      ${confirmationText ? `<label class="field dialog-confirmation-field"><span class="field-label">输入 ${escapeHtml(confirmationText)} 确认</span><input id="dialog-confirmation-input" autocomplete="off" spellcheck="false" /></label>` : ""}`;
    elements["dialog-confirm-button"].textContent = confirmLabel;
    elements["dialog-confirm-button"].className = `button ${danger ? "danger" : "primary"}`;
    elements["dialog-confirm-button"].value = "confirm";
    elements["dialog-confirm-button"].disabled = Boolean(confirmationText);
    if (confirmationText) {
      const confirmationInput = byId("dialog-confirmation-input");
      confirmationInput?.addEventListener("input", () => {
        elements["dialog-confirm-button"].disabled = confirmationInput.value !== confirmationText;
      });
    }
    const closeHandler = () => {
      const confirmed = dialog.returnValue === "confirm";
      // 带复选框时回结构化结果，不破坏既有布尔调用方
      resolve(checkbox ? { confirmed, checked: confirmed && (byId("dialog-check-input")?.checked ?? false) } : confirmed);
    };
    dialog.addEventListener("close", closeHandler, { once: true });
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      if (confirmationText) byId("dialog-confirmation-input")?.focus({ preventScroll: true });
    }
    else resolve(checkbox ? { confirmed: window.confirm(title), checked: false } : window.confirm(title));
  });
}

const RUN_HISTORY_MAX_RUNS = 6;
const RUN_HISTORY_MAX_EVENTS = 15_000;
const RUN_HISTORY_MAX_EVENTS_PER_RUN = 5_000; // 与服务端审计回放上限一致，不截短单次审计
const RUN_HISTORY_MAX_INFLIGHT = 6;
const RUN_HISTORY_MAX_BYTES = 20 * 1024 * 1024;
const RUN_HISTORY_MAX_BYTES_PER_RUN = 16 * 1024 * 1024;
const RUN_HISTORY_MAX_WIRE_BYTES = RUN_HISTORY_MAX_BYTES_PER_RUN + 128 * 1024; // JSON wrapper/comma allowance
const RUN_HISTORY_JSON_FALLBACK_MAX_BYTES = 512 * 1024;
const RUN_HISTORY_PARSE_SLICE_BYTES = 32 * 1024;
const RUN_HISTORY_PARSE_SLICE_MS = 4;
const MERGED_DELTA_TRACKED_ID_LIMIT = 256;
const runHistoryLru = new Map();
const runHistoryInflight = new Map(); // runId → { promise, controller, order, pendingEvents, pendingHead, pendingBytes }
const runHistoryEventBytes = new WeakMap();
const mergedDeltaEventIds = new WeakMap();
const mergedDeltaSequenceRanges = new WeakMap();
const runHistoryTextEncoder = new TextEncoder();
let runHistoryRequestOrder = 0;

function utf8Bytes(value) {
  return runHistoryTextEncoder.encode(String(value ?? "")).byteLength;
}

function estimateUiValueResidentBytes(value, depth = 0) {
  if (value == null) return 8;
  if (typeof value === "string") return value.length * 2 + 16;
  if (typeof value === "number" || typeof value === "boolean") return 16;
  if (depth >= 8) return 64;
  if (Array.isArray(value)) {
    let bytes = 32 + value.length * 8;
    for (const item of value) bytes += estimateUiValueResidentBytes(item, depth + 1);
    return bytes;
  }
  if (typeof value !== "object") return String(value).length * 2 + 16;
  let bytes = 64;
  for (const [key, item] of Object.entries(value)) {
    bytes += key.length * 2 + 24 + estimateUiValueResidentBytes(item, depth + 1);
  }
  return bytes;
}

function normalizedEventResidentBytes(event) {
  const known = runHistoryEventBytes.get(event);
  if (known != null) return known;
  const bytes = NORMALIZED_EVENT_FIXED_OVERHEAD + estimateUiValueResidentBytes(event);
  runHistoryEventBytes.set(event, bytes);
  return bytes;
}

function serializedRunHistoryEventBytes(event) {
  return normalizedEventResidentBytes(event);
}

function eventIdsForTracking(event) {
  const mergedIds = mergedDeltaEventIds.get(event);
  return mergedIds ? [...mergedIds] : [event?.id];
}

function eventTracksId(event, id) {
  if (!event || id == null) return false;
  return event.id === id || Boolean(mergedDeltaEventIds.get(event)?.has(id));
}

function eventSequenceRange(event) {
  const tracked = mergedDeltaSequenceRanges.get(event);
  if (tracked) return tracked;
  const sequence = Number(event?.seq);
  return Number.isSafeInteger(sequence) ? { min: sequence, max: sequence } : null;
}

function eventTracksEvent(tracked, incoming) {
  if (!tracked || !incoming) return false;
  if (eventIdsForTracking(incoming).some((id) => eventTracksId(tracked, id))) return true;
  // sequence 只在同一 delta 流内才有去重语义。不同 run/session/correlation 都可能从
  // 相同序号起步，跨流套 range 会把合法事件吞掉。
  if (!sameDeltaStream(tracked, incoming)) return false;
  const sequence = Number(incoming.seq);
  const range = eventSequenceRange(tracked);
  return Number.isSafeInteger(sequence) && Boolean(range && sequence >= range.min && sequence <= range.max);
}

function sameDeltaStream(left, right) {
  return Boolean(
    left
    && isDeltaEventType(right.type)
    && left.type === right.type
    && left.runId === right.runId
    && left.sessionId === right.sessionId
    && left.correlationId === right.correlationId
  );
}

function canMergeDeltaEvent(target, incoming) {
  if (!sameDeltaStream(target, incoming)) return false;
  const targetRange = eventSequenceRange(target);
  const incomingRange = eventSequenceRange(incoming);
  if (targetRange || incomingRange) {
    // range 只代表已经证实连续的片段。10,12,11 必须保留三片，不能先把 10-12
    // 当成闭区间再把迟到的 11 误判为重放。
    return Boolean(targetRange && incomingRange && incomingRange.min === targetRange.max + 1);
  }
  const trackedIds = mergedDeltaEventIds.get(target);
  const trackedCount = trackedIds?.size ?? (target?.id == null ? 0 : 1);
  const newIds = eventIdsForTracking(incoming)
    .filter((id) => id != null && !eventTracksId(target, id));
  // 无 sequence 时只能靠显式 ID 去重。达到 256 后开启下一聚合项，避免淘汰最早 ID
  // 后的重放再次拼进尾部，也让每个聚合 envelope 的元数据保持严格有界。
  return trackedCount + newIds.length <= MERGED_DELTA_TRACKED_ID_LIMIT;
}

function mergeDeltaEvent(target, incoming) {
  let mergedIds = mergedDeltaEventIds.get(target);
  if (!mergedIds) {
    mergedIds = new Set([target.id]);
    mergedDeltaEventIds.set(target, mergedIds);
  }
  for (const id of eventIdsForTracking(incoming)) {
    if (id != null) mergedIds.add(id);
  }
  while (mergedIds.size > MERGED_DELTA_TRACKED_ID_LIMIT) {
    mergedIds.delete(mergedIds.values().next().value);
  }
  const targetRange = eventSequenceRange(target);
  const incomingRange = eventSequenceRange(incoming);
  if (targetRange || incomingRange) {
    mergedDeltaSequenceRanges.set(target, {
      min: Math.min(targetRange?.min ?? incomingRange.min, incomingRange?.min ?? targetRange.min),
      max: Math.max(targetRange?.max ?? incomingRange.max, incomingRange?.max ?? targetRange.max),
    });
  }
  target.summary = `${target.summary}${incoming.summary}`.slice(-500);
  target.content = `${target.content}${incoming.content}`.slice(-4000);
  target.timestamp = incoming.timestamp;
  target.seq = incoming.seq;
}

function touchRunHistory(runId) {
  if (!Object.hasOwn(state.runEvents, runId)) return;
  runHistoryLru.delete(runId);
  runHistoryLru.set(runId, Date.now());
}

function historyEventsForRun(runId) {
  const events = state.runEvents[runId] ?? [];
  if (events.length) touchRunHistory(runId);
  return events;
}

function evictRunHistory(runId, { abort = true } = {}) {
  const inflight = runHistoryInflight.get(runId);
  if (abort && inflight) {
    // 先撤销所有权再 abort：close 后同 tick 重开必须创建新请求，旧 Promise 也无权写回。
    if (runHistoryInflight.get(runId) === inflight) runHistoryInflight.delete(runId);
    inflight.controller.abort();
  }
  delete state.runEvents[runId];
  runHistoryLru.delete(runId);
}

function runHistoryIsReferenced(runId) {
  return state.selectedRunId === runId || state.tabs.some((tab) => tab.runId === runId);
}

function trimRunHistoryInflight() {
  while (runHistoryInflight.size >= RUN_HISTORY_MAX_INFLIGHT) {
    const candidates = [...runHistoryInflight.entries()].sort(([leftId, left], [rightId, right]) => {
      const referenceOrder = Number(runHistoryIsReferenced(leftId)) - Number(runHistoryIsReferenced(rightId));
      if (referenceOrder) return referenceOrder; // 无引用请求优先回收
      const selectedOrder = Number(leftId === state.selectedRunId) - Number(rightId === state.selectedRunId);
      if (selectedOrder) return selectedOrder; // 当前可见请求最后回收
      return left.order - right.order;
    });
    const candidate = candidates[0];
    if (!candidate) break;
    const [runId, inflight] = candidate;
    if (runHistoryInflight.get(runId) === inflight) runHistoryInflight.delete(runId);
    inflight.controller.abort();
  }
}

function trimRunHistoryCache() {
  let total = [...runHistoryLru.keys()].reduce((sum, runId) => sum + (state.runEvents[runId]?.length ?? 0), 0);
  let totalBytes = [...runHistoryLru.keys()].reduce(
    (sum, runId) => sum + Number(state.runEvents[runId]?.historyBytes ?? 0),
    0,
  );
  while (
    runHistoryLru.size > RUN_HISTORY_MAX_RUNS
    || total > RUN_HISTORY_MAX_EVENTS
    || totalBytes > RUN_HISTORY_MAX_BYTES
  ) {
    const candidate = [...runHistoryLru.keys()].find((runId) => runId !== state.selectedRunId);
    if (!candidate) break; // 单个选中 run 同时受 5000 条与 16 MiB 上限约束
    total -= state.runEvents[candidate]?.length ?? 0;
    totalBytes -= Number(state.runEvents[candidate]?.historyBytes ?? 0);
    evictRunHistory(candidate);
  }
}

function releaseRunHistoryIfUnreferenced(runId) {
  if (!runId || state.selectedRunId === runId || state.tabs.some((tab) => tab.runId === runId)) return;
  evictRunHistory(runId);
  releaseConversationWindows(runId);
}

async function normalizeHistoryEvents(rawEvents, signal = null) {
  const events = [];
  const conversationEvents = [];
  const conversationMessages = [];
  let historyBytes = 0;
  let sliceBytes = 0;
  let sliceStartedAt = performance.now();
  for (let index = 0; index < rawEvents.length; index += 1) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const before = historyBytes;
    historyBytes = appendNormalizedHistoryEvent(events, conversationEvents, conversationMessages, rawEvents[index], historyBytes);
    sliceBytes += historyBytes - before;
    if (index + 1 < rawEvents.length && (
      sliceBytes >= RUN_HISTORY_PARSE_SLICE_BYTES
      || performance.now() - sliceStartedAt >= RUN_HISTORY_PARSE_SLICE_MS
    )) {
      await yieldToMainThread();
      sliceBytes = 0;
      sliceStartedAt = performance.now();
    }
  }
  return attachConversationEvents(events, conversationEvents, conversationMessages, historyBytes);
}

function attachConversationEvents(events, conversationEvents, conversationMessages, historyBytes = null) {
  const eventIds = new Set();
  for (const event of events) {
    for (const id of eventIdsForTracking(event)) {
      if (id != null) eventIds.add(id);
    }
  }
  const bytes = historyBytes ?? events.reduce((sum, event) => sum + serializedRunHistoryEventBytes(event), 0);
  Object.defineProperties(events, {
    conversationEvents: { value: conversationEvents, enumerable: false },
    conversationMessages: { value: conversationMessages, enumerable: false },
    eventIds: { value: eventIds, enumerable: false },
    historyBytes: { value: bytes, writable: true, enumerable: false },
  });
  return events;
}

function appendNormalizedHistoryEvent(events, conversationEvents, conversationMessages, rawEvent, historyBytes, sourceCharacters = 0) {
  if (events.length >= RUN_HISTORY_MAX_EVENTS_PER_RUN) {
    throw new ApiError(`任务历史响应超过 ${RUN_HISTORY_MAX_EVENTS_PER_RUN} 条事件上限`);
  }
  const event = normalizeEvent(rawEvent, "message", { sourceCharacters });
  // 预算按实际驻留的 normalized envelope 计量。normalizeEvent 会保留 data，同时生成
  // content/summary；按 wire 行字节计量会把大 text/status 的复制放大漏掉一半。
  const eventBytes = Math.max(normalizedEventSourceBytes(sourceCharacters), normalizedEventResidentBytes(event));
  runHistoryEventBytes.set(event, eventBytes);
  if (eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN || historyBytes + eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN) {
    throw new ApiError(`任务历史响应超过 ${RUN_HISTORY_MAX_BYTES_PER_RUN / 1024 / 1024} MiB 浏览器缓存上限`);
  }
  events.push(event);
  // 保留完整审计数组给窗口计数/诊断；会话重建只需带 UI 语义的事件，
  // heartbeat 等噪声不应在每次 renderSelectedRun 时再次经过分支、去重和排序。
  if (eventAffectsConversation(event)) {
    conversationEvents.push(event);
    const message = conversationMessageFromEvent(event);
    if (message) insertConversationMessageSorted(conversationMessages, message);
  }
  return historyBytes + eventBytes;
}

function adjustConversationWindowsAfterDrop(runId, droppedMessages) {
  if (!droppedMessages.length) return;
  const prefix = `${runId}\u0000`;
  for (const [key, start] of conversationWindowStarts.entries()) {
    if (!key.startsWith(prefix)) continue;
    const rawAgentId = key.slice(prefix.length);
    const agentId = rawAgentId === "all" ? null : rawAgentId;
    const shift = droppedMessages.filter((message) => messageMatchesAgentPage(message, agentId)).length;
    if (shift) conversationWindowStarts.set(key, Math.max(0, (Number(start) || 0) - shift));
  }
}

function dropOldestRunHistoryEvent(events) {
  const dropped = events.shift();
  if (!dropped) return { bytes: 0, conversationMessage: null };
  for (const id of eventIdsForTracking(dropped)) events.eventIds?.delete(id);
  const bytes = serializedRunHistoryEventBytes(dropped);
  events.historyBytes = Math.max(0, Number(events.historyBytes ?? 0) - bytes);
  const conversationEvents = events.conversationEvents ?? [];
  const conversationIndex = conversationEvents.indexOf(dropped);
  const conversationMessage = conversationIndex >= 0
    ? events.conversationMessages.find((message) => message.key === dropped.id) ?? conversationMessageFromEvent(dropped)
    : null;
  if (conversationIndex >= 0) {
    conversationEvents.splice(conversationIndex, 1);
    removeRunHistoryMessageIndexes(events, dropped);
  }
  return { bytes, conversationMessage };
}

function bufferInflightRunHistoryEvent(runId, event) {
  const inflight = runHistoryInflight.get(runId);
  if (!inflight || inflight.controller.signal.aborted || Object.hasOwn(state.runEvents, runId)) return false;
  const bufferedEvent = { ...event };
  const eventBytes = serializedRunHistoryEventBytes(bufferedEvent);
  if (eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN || inflight.pendingBytes + eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN) {
    if (runHistoryInflight.get(runId) === inflight) runHistoryInflight.delete(runId);
    inflight.controller.abort();
    appendDiagnostic(`任务历史实时尾部 ${runId} 超过 16 MiB，已取消回放并保留实时窗口`, "warning", { render: false });
    return false;
  }
  inflight.pendingEvents.push({ event: bufferedEvent, bytes: eventBytes });
  inflight.pendingBytes += eventBytes;
  while (inflight.pendingEvents.length - inflight.pendingHead > RUN_HISTORY_MAX_EVENTS_PER_RUN) {
    const dropped = inflight.pendingEvents[inflight.pendingHead++];
    inflight.pendingBytes -= dropped.bytes;
  }
  if (inflight.pendingHead > 1024 && inflight.pendingHead * 2 > inflight.pendingEvents.length) {
    inflight.pendingEvents.splice(0, inflight.pendingHead);
    inflight.pendingHead = 0;
  }
  return true;
}

function appendLiveRunHistoryEvent(runId, event, { trim = true } = {}) {
  const events = state.runEvents[runId];
  if (!events) return false;
  const incomingIds = eventIdsForTracking(event).filter((id) => id != null);
  if (incomingIds.some((id) => events.eventIds?.has(id))) return false;
  const conversationEvents = events.conversationEvents ?? [];
  const eventBytes = serializedRunHistoryEventBytes(event);
  // per-run 历史始终保留原始 SSE envelope。全局窗口可以聚合 delta 以降低渲染成本，
  // 但审计缓存必须逐事件对账，才能正确合并与 HTTP 快照部分重叠的实时尾部。
  const cachedEvent = { ...event };
  if (incomingIds.length > 1) mergedDeltaEventIds.set(cachedEvent, new Set(incomingIds));
  runHistoryEventBytes.set(cachedEvent, eventBytes);
  if (eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN) {
    appendDiagnostic(`任务历史事件 ${runId} 单条超过 16 MiB，已跳过该事件并保留现有缓存`, "warning", { render: false });
    return false;
  }

  let droppedCount = 0;
  const droppedConversationMessages = [];
  let droppedForBytes = false;
  while (
    events.length >= RUN_HISTORY_MAX_EVENTS_PER_RUN
    || Number(events.historyBytes ?? 0) + eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN
  ) {
    const overByteBudget = Number(events.historyBytes ?? 0) + eventBytes > RUN_HISTORY_MAX_BYTES_PER_RUN;
    const dropped = dropOldestRunHistoryEvent(events);
    if (!dropped.bytes) break;
    droppedCount += 1;
    if (dropped.conversationMessage) droppedConversationMessages.push(dropped.conversationMessage);
    droppedForBytes ||= overByteBudget;
  }
  adjustConversationWindowsAfterDrop(runId, droppedConversationMessages);
  if (droppedForBytes) {
    appendDiagnostic(`任务历史缓存 ${runId} 已裁剪最旧 ${droppedCount} 条，继续保留 16 MiB 滑动尾部`, "warning", { render: false });
  }

  const sequence = Number(event.seq);
  const lastSequence = Number(events.at(-1)?.seq);
  const conversationEvent = eventAffectsConversation(cachedEvent);
  if (events.length && Number.isFinite(sequence) && Number.isFinite(lastSequence) && sequence < lastSequence) {
    let index = events.findIndex((candidate) => Number(candidate.seq) > sequence);
    if (index < 0) index = events.length;
    events.splice(index, 0, cachedEvent);
    if (conversationEvent) {
      let conversationIndex = conversationEvents.findIndex((candidate) => Number(candidate.seq) > sequence);
      if (conversationIndex < 0) conversationIndex = conversationEvents.length;
      conversationEvents.splice(conversationIndex, 0, cachedEvent);
      appendRunHistoryMessageIndexes(events, cachedEvent);
    }
  } else {
    events.push(cachedEvent);
    if (conversationEvent) {
      conversationEvents.push(cachedEvent);
      appendRunHistoryMessageIndexes(events, cachedEvent);
    }
  }
  for (const id of incomingIds) events.eventIds?.add(id);
  events.historyBytes += eventBytes;

  touchRunHistory(runId);
  if (trim) trimRunHistoryCache();
  return true;
}

function mergeRealtimeTailIntoHistory(runId, events, inflight) {
  state.runEvents[runId] = events;
  touchRunHistory(runId);
  const liveTail = inflight.pendingEvents
    .slice(inflight.pendingHead)
    .map((entry) => entry.event)
    .sort((left, right) => Number(left.seq) - Number(right.seq));
  for (const event of liveTail) {
    if (!Object.hasOwn(state.runEvents, runId)) break;
    appendLiveRunHistoryEvent(runId, event, { trim: false });
  }
  if (Object.hasOwn(state.runEvents, runId)) trimRunHistoryCache();
  return state.runEvents[runId] ?? [];
}

async function readBoundedResponseText(response, maxBytes, signal) {
  if (!response.body) {
    const text = await response.text();
    if (utf8Bytes(text) > maxBytes) throw new ApiError("任务历史 JSON 响应超过兼容上限");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts = [];
  let bytes = 0;
  let bytesSinceYield = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      bytesSinceYield += value.byteLength;
      if (bytes > maxBytes) throw new ApiError("任务历史 JSON 响应超过兼容上限");
      parts.push(decoder.decode(value, { stream: true }));
      if (bytesSinceYield >= RUN_HISTORY_PARSE_SLICE_BYTES) {
        await yieldToMainThread();
        bytesSinceYield = 0;
      }
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  }
}

async function requestRunEventHistory(runId, signal) {
  const headers = new Headers({ Accept: "application/x-ndjson, application/json;q=0.9" });
  if (getAccessToken()) headers.set("Authorization", `Bearer ${getAccessToken()}`);
  let response;
  try {
    response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events?view=ui`, { headers, signal });
  } catch (error) {
    throw new ApiError(`无法连接控制面：${error?.message ?? error}`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = payload?.error?.message ?? payload?.error?.code ?? payload?.message ?? `HTTP ${response.status}`;
    throw new ApiError(String(detail), response.status, payload);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > RUN_HISTORY_MAX_WIRE_BYTES) {
    throw new ApiError("任务历史响应超过浏览器传输上限");
  }
  if (!contentType.toLowerCase().includes("application/x-ndjson") || !response.body) {
    if (Number.isFinite(declaredLength) && declaredLength > RUN_HISTORY_JSON_FALLBACK_MAX_BYTES) {
      throw new ApiError("任务历史 JSON 响应过大；控制面必须返回增量 NDJSON");
    }
    const text = await readBoundedResponseText(response, RUN_HISTORY_JSON_FALLBACK_MAX_BYTES, signal);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new ApiError(`任务历史 JSON 格式无效：${error.message}`);
    }
    return normalizeHistoryEvents((payload?.events || []).slice(-RUN_HISTORY_MAX_EVENTS_PER_RUN), signal);
  }

  const events = [];
  const conversationEvents = [];
  const conversationMessages = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let carry = "";
  let parsedBytesSinceYield = 0;
  let parseSliceStartedAt = performance.now();
  let wireBytes = 0;
  let historyBytes = 0;
  const parseLines = async (lines) => {
    for (const line of lines) {
      if (!line.trim()) continue;
      if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
      const before = historyBytes;
      historyBytes = appendNormalizedHistoryEvent(
        events,
        conversationEvents,
        conversationMessages,
        JSON.parse(line),
        historyBytes,
        line.length,
      );
      parsedBytesSinceYield += historyBytes - before;
      if (
        parsedBytesSinceYield >= RUN_HISTORY_PARSE_SLICE_BYTES
        || performance.now() - parseSliceStartedAt >= RUN_HISTORY_PARSE_SLICE_MS
      ) {
        parsedBytesSinceYield = 0;
        await yieldToMainThread();
        parseSliceStartedAt = performance.now();
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      wireBytes += value.byteLength;
      if (wireBytes > RUN_HISTORY_MAX_BYTES_PER_RUN) throw new ApiError("任务历史流超过浏览器传输上限");
      const lines = `${carry}${decoder.decode(value, { stream: true })}`.split("\n");
      carry = lines.pop() ?? "";
      await parseLines(lines);
    }
    carry += decoder.decode();
    if (carry.trim()) await parseLines([carry]);
    return attachConversationEvents(events, conversationEvents, conversationMessages, historyBytes);
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    if (error instanceof ApiError || error?.name === "AbortError") throw error;
    throw new ApiError(`任务历史流格式无效：${error.message}`);
  }
}

function fetchRunEvents(runId) {
  if (!runId) return Promise.resolve([]);
  if (Object.hasOwn(state.runEvents, runId)) {
    touchRunHistory(runId);
    return Promise.resolve(state.runEvents[runId]);
  }
  const existing = runHistoryInflight.get(runId);
  if (existing) return existing.promise;
  trimRunHistoryInflight();
  const controller = new AbortController();
  const inflight = {
    promise: null,
    controller,
    order: ++runHistoryRequestOrder,
    pendingEvents: [],
    pendingHead: 0,
    pendingBytes: 0,
  };
  const promise = requestRunEventHistory(runId, controller.signal)
    .then(async (events) => {
      if (controller.signal.aborted || runHistoryInflight.get(runId) !== inflight) return [];
      events = mergeRealtimeTailIntoHistory(runId, events, inflight);
      if (state.view === "workbench" && state.selectedRunId === runId && !state.sessionPreview) {
        // 流式末批可能与首屏 160 条 DOM 提交落在同一 macrotask；先让浏览器处理输入/绘制，
        // 再渲染。延后期间 tab 若被关闭或切走，下面的 ownership 检查会直接丢弃旧提交。
        await yieldToMainThread();
        if (!controller.signal.aborted && runHistoryInflight.get(runId) === inflight
          && state.view === "workbench" && state.selectedRunId === runId && !state.sessionPreview) {
          renderSelectedRun({ preserveStreamState: false });
        }
      }
      return events;
    })
    .catch((error) => {
      if (!controller.signal.aborted && runHistoryInflight.get(runId) === inflight) {
        appendDiagnostic(`任务历史回放失败 ${runId}: ${error.message}`, "warning");
      }
      return [];
    })
    .finally(() => {
      if (runHistoryInflight.get(runId) === inflight) runHistoryInflight.delete(runId);
    });
  inflight.promise = promise;
  runHistoryInflight.set(runId, inflight);
  return promise;
}

// 产物 diff 面板开合：重复点击同一 run 收起；展开时按需拉取（面板态不进 run 持久化，纯视图态）
async function toggleRunDiff(runId) {
  if (state.runDiffView?.runId === runId) {
    state.runDiffView = null;
    renderSelectedRun();
    return;
  }
  state.runDiffView = { runId, status: "loading" };
  renderSelectedRun();
  try {
    const data = await request(`${API.runs}/${encodeURIComponent(runId)}/diff`);
    if (state.runDiffView?.runId !== runId) return; // 等待期间已换 run/收起——迟到响应直接丢弃
    state.runDiffView = { runId, status: "ok", data };
  } catch (error) {
    if (state.runDiffView?.runId !== runId) return;
    state.runDiffView = { runId, status: "error", error: error.message };
  }
  renderSelectedRun();
}

// ===== 浏览器式 tab 页签 + 成员 agent 独立页（LO 的信息架构） =====
// 项目 → 会话 → 成员页；每个可发送页签都绑定唯一真实成员。
// 会话行默认打开执行所有者；成员条/拓扑点击开对应成员页（只看 ta、直接问 ta）。
// 多页并存于 tab 栏实时切换，非活跃页有新消息落脏标。页签 sessionStorage 持久化（刷新不丢）。
const TABS_KEY = "514cc-conv-tabs";

function runRecipientIds(run) {
  return [...new Set([
    ...(Array.isArray(run?.teamMembers) ? run.teamMembers : []),
    run?.executionOwnerId,
    run?.startAgentId,
    run?.coordinatorId,
    ...sessionAgentIds(run?.sessions),
  ].map((id) => String(id || "").trim()).filter(Boolean))];
}

function defaultRunRecipient(run) {
  const members = runRecipientIds(run);
  return [run?.executionOwnerId, run?.startAgentId, run?.coordinatorId, ...members]
    .map((id) => String(id || "").trim())
    .find((id) => id && members.includes(id)) || null;
}

function runRecipient(run, requestedAgentId = null) {
  const members = runRecipientIds(run);
  const requested = String(requestedAgentId || "").trim();
  return requested && members.includes(requested) ? requested : defaultRunRecipient(run);
}

function tabKeyOf(runId, agentId) {
  return `${runId}::${agentId}`;
}

function activeTab() {
  return state.tabs.find((tab) => tab.key === state.activeTabKey) ?? null;
}

function activeAgentId() {
  return activeTab()?.agentId ?? null;
}

function persistTabs() {
  try {
    sessionStorage.setItem(TABS_KEY, JSON.stringify({ tabs: state.tabs, active: state.activeTabKey }));
  } catch {
    // 隐私模式等写失败：页签退化为内存态，不阻断使用
  }
}

function restoreTabs() {
  const runIds = new Set(state.runs.map((run) => run.id));
  try {
    const saved = JSON.parse(sessionStorage.getItem(TABS_KEY) ?? "null");
    if (saved) {
      const restored = new Map();
      for (const tab of saved.tabs ?? []) {
        if (!runIds.has(tab.runId)) continue;
        const run = state.runs.find((item) => item.id === tab.runId);
        const agentId = runRecipient(run, tab.agentId);
        if (!agentId) continue;
        const key = tabKeyOf(tab.runId, agentId);
        const previous = restored.get(key);
        restored.set(key, {
          ...tab,
          key,
          agentId,
          title: run?.title ?? tab.title,
          dirty: Boolean(previous?.dirty || tab.dirty),
        });
      }
      state.tabs = [...restored.values()];
      const savedActive = (saved.tabs ?? []).find((tab) => tab.key === saved.active);
      const activeRun = savedActive && state.runs.find((run) => run.id === savedActive.runId);
      const activeAgentId = activeRun ? runRecipient(activeRun, savedActive.agentId) : null;
      const migratedActiveKey = activeAgentId ? tabKeyOf(activeRun.id, activeAgentId) : null;
      state.activeTabKey = state.tabs.some((tab) => tab.key === migratedActiveKey) ? migratedActiveKey : state.tabs.at(-1)?.key ?? null;
      const tab = activeTab();
      if (tab) state.selectedRunId = tab.runId;
    }
  } catch {
    state.tabs = [];
    state.activeTabKey = null;
  }
  if (state.deepLinkRunId && runIds.has(state.deepLinkRunId)) {
    const runId = state.deepLinkRunId;
    state.deepLinkRunId = null;
    openTab(runId);
  }
}

function openTab(runId, agentId = null) {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return;
  const recipientId = runRecipient(run, agentId);
  if (!recipientId) {
    toast("当前会话没有可发送的真实成员", "error");
    return;
  }
  const key = tabKeyOf(runId, recipientId);
  if (!state.tabs.some((tab) => tab.key === key)) {
    state.tabs.push({ key, runId, agentId: recipientId, title: run.title, dirty: false });
  }
  activateTab(key);
}

function focusRenderedTab(key) {
  requestAnimationFrame(() => {
    elements["conv-tabs"]
      ?.querySelector(`[data-tab-activate="${CSS.escape(key)}"]`)
      ?.focus({ preventScroll: true });
  });
}

function activateTab(key, { focusTab = false } = {}) {
  const tab = state.tabs.find((item) => item.key === key);
  if (!tab) return;
  tab.dirty = false;
  state.activeTabKey = key;
  state.selectedRunId = tab.runId;
  state.selectionClearedByUser = false;
  state.sessionPreview = null; // 切页即离开历史预览
  state.runDiffView = null; // 切页收起产物面板
  persistTabs();
  renderTabs();
  renderMemberStrip();
  void syncModelPick();
  renderRuns(); // 左栏选中态跟随 tab
  if (state.view !== "workbench") setView("workbench");
  void fetchRunEvents(tab.runId);
  if (focusTab) focusRenderedTab(key);
}

function closeTab(key, { restoreFocus = false } = {}) {
  const index = state.tabs.findIndex((tab) => tab.key === key);
  if (index < 0) return;
  const closedRunId = state.tabs[index].runId;
  state.tabs.splice(index, 1);
  if (state.activeTabKey === key) {
    // 删除后原右邻仍占同一 index；没有右邻时才退到左邻。
    const next = state.tabs[index] ?? state.tabs[index - 1] ?? null;
    if (next) {
      activateTab(next.key, { focusTab: restoreFocus });
      releaseRunHistoryIfUnreferenced(closedRunId);
      return;
    }
    state.activeTabKey = null;
    state.selectedRunId = null;
    state.selectionClearedByUser = true;
  }
  persistTabs();
  renderTabs();
  renderMemberStrip();
  renderRuns();
  releaseRunHistoryIfUnreferenced(closedRunId);
  if (restoreFocus) {
    const fallback = state.tabs[Math.min(index, state.tabs.length - 1)] ?? state.tabs[index - 1] ?? null;
    if (fallback) focusRenderedTab(fallback.key);
    else elements["task-input"]?.focus({ preventScroll: true });
  }
}

function renderTabs() {
  const bar = elements["conv-tabs"];
  if (!bar) return;
  bar.hidden = state.tabs.length === 0;
  bar.innerHTML = state.tabs
    .map((tab, index) => {
      const active = tab.key === state.activeTabKey;
      const roving = active || (!state.activeTabKey && index === 0);
      const agent = agentLabel(tab.agentId);
      const slug = ` is-agent-${agentSlug(tab.agentId)}`;
      const tabId = `conv-tab-${index}`;
      return `<div class="conv-tab${active ? " is-active" : ""}${slug}" role="presentation">
        <button class="conv-tab-main" id="${tabId}" type="button" role="tab"
          aria-selected="${active}" aria-controls="conversation-stream" tabindex="${roving ? 0 : -1}"
          data-tab-activate="${escapeHtml(tab.key)}" title="${escapeHtml(tab.title)} · 直接发送给 ${escapeHtml(agent)}">
          <span class="conv-tab-agent">${escapeHtml(agent)}</span>
          <span class="conv-tab-title">${escapeHtml(tab.title)}</span>
          ${tab.dirty ? '<span class="conv-tab-dirty" aria-label="有新消息"></span>' : ""}
        </button>
        <button class="conv-tab-close" type="button" data-tab-close="${escapeHtml(tab.key)}" aria-label="关闭「${escapeHtml(tab.title)}」页签">×</button>
      </div>`;
    })
    .join("");
  const panel = elements["conversation-stream"];
  const activeIndex = state.tabs.findIndex((tab) => tab.key === state.activeTabKey);
  panel?.setAttribute("aria-labelledby", activeIndex >= 0 ? `conv-tab-${activeIndex}` : "conversation-title");
}

function selectComposerTarget(agentId = null, { focusInput = true } = {}) {
  const target = activeComposerTarget();
  const normalized = agentId && target.members.includes(agentId) ? agentId : null;
  const nextDirectTarget = normalized || target.coordinatorId;
  if (!target.run && nextDirectTarget && state.requestedAgentIds.includes(nextDirectTarget)) {
    removeRequestedAgent(nextDirectTarget, { focusInput: false });
  }
  if (target.run) {
    openTab(target.run.id, nextDirectTarget);
  } else {
    rememberComposerControlDraft(target);
    state.composerTargetAgentId = nextDirectTarget;
    renderMemberStrip();
    void syncModelPick();
  }
  if (focusInput) elements["task-input"]?.focus({ preventScroll: true });
}

function keepActiveComposerTargetVisible(strip) {
  requestAnimationFrame(() => {
    if (!strip?.isConnected) return;
    const active = strip.querySelector('[data-composer-target][aria-checked="true"]');
    if (!active) return;
    const stripRect = strip.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    if (activeRect.left < stripRect.left) strip.scrollLeft += activeRect.left - stripRect.left - 4;
    else if (activeRect.right > stripRect.right) strip.scrollLeft += activeRect.right - stripRect.right + 4;
  });
}

// 唯一发送目标条：只呈现真实逻辑成员；活动成员就是直接收件人。
function renderMemberStrip() {
  const strip = elements["member-strip"];
  if (!strip) return;
  const target = activeComposerTarget();
  const { members } = target;
  if (!members.length) {
    strip.hidden = true;
    strip.innerHTML = "";
    syncComposerTargetUi(target);
    return;
  }
  const current = target.memberId;
  const chip = (agentId, label, title) => {
    const active = (agentId ?? null) === current;
    const slug = agentId ? ` is-agent-${agentSlug(agentId)}` : "";
    const cli = agentId ? agentCli(agentId) : null;
    const icon = cli ? `${cliIconMarkup(cli)} ` : "";
    return `<button class="member-chip${active ? " is-active" : ""}${slug}" type="button" role="radio"
      aria-checked="${active}" tabindex="${active ? 0 : -1}" data-composer-target="${escapeHtml(agentId ?? "")}" title="${escapeHtml(title)}">${icon}${escapeHtml(label)}</button>`;
  };
  strip.hidden = false;
  strip.innerHTML = `<span class="member-strip-label">直接发送</span>`
    + members.map((id) => chip(id, agentLabel(id), `直接发送给 ${agentLabel(id)}，使用其 CLI 专属配置`)).join("");
  syncComposerTargetUi(target);
  keepActiveComposerTargetVisible(strip);
}

function selectRun(id) {
  if (!id) return;
  markSelectedSessionLink(null, null);
  const run = state.runs.find((item) => item.id === id);
  if (run?.unread) void patchRunMeta(id, { unread: false }); // 打开即已读
  openTab(id); // 会话行默认进入真实执行所有者，不创建可发送的伪群聊页
}

const NAV_MOBILE_QUERY = window.matchMedia("(max-width: 820px)");

// 全尺寸导航均为按需抽屉；离屏时必须同时移出 Tab 顺序与 a11y 树。
function syncNavAccessibility() {
  const sidebar = byId("sidebar");
  if (!sidebar) return;
  const isOpen = document.querySelector(".app-shell")?.classList.contains("nav-open");
  const shouldHide = !isOpen;
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
  } else if (restoreFocus) {
    byId("mobile-menu-button")?.focus?.({ preventScroll: true });
  }
}

function bindEvents() {
  byId("mobile-menu-button")?.addEventListener("click", () => setNavDrawer(!navDrawerOpen()));
  byId("nav-backdrop")?.addEventListener("click", () => setNavDrawer(false));
  byId("mission-side-chat-close")?.addEventListener("click", () => setMissionSideChat(false));
  byId("mission-side-chat-input")?.addEventListener("input", (event) => {
    if (!elements["task-input"] || elements["task-input"].value === event.target.value) return;
    elements["task-input"].value = event.target.value;
    elements["task-input"].dispatchEvent(new Event("input", { bubbles: true }));
  });
  byId("mission-side-chat-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const sideInput = byId("mission-side-chat-input");
    if (!sideInput?.value.trim() || !elements["task-input"]) return;
    elements["task-input"].value = sideInput.value;
    elements["task-input"].dispatchEvent(new Event("input", { bubbles: true }));
    elements["submit-task-button"]?.click();
  });
  NAV_MOBILE_QUERY.addEventListener("change", syncNavAccessibility);
  syncNavAccessibility();
  document.addEventListener("keydown", (event) => {
    if (state.view !== "workbench" || event.defaultPrevented) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.key.toLowerCase() === "g") {
      event.preventDefault();
      handleWorkbenchEnvironmentAction("review");
    } else if (mod && event.altKey && !event.shiftKey && event.key.toLowerCase() === "b") {
      event.preventDefault();
      handleWorkbenchEnvironmentAction("browser");
    } else if (mod && event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      handleWorkbenchEnvironmentAction("files");
    } else if (mod && event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      setMissionSideChat(true);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || !navDrawerOpen()) return;
    // dialog / 命令面板位于导航上方，由更高层先消费 Escape。
    if (document.querySelector("dialog[open], .cmd-palette-overlay.is-open")) return;
    // 导航高于 Mission Control：消费本次 Escape，避免底层抽屉同轮折叠。
    event.preventDefault();
    setNavDrawer(false);
  });

  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      if (navDrawerOpen()) setNavDrawer(false, { restoreFocus: false }); // 选视图后收起抽屉，但保留 h1 焦点
    }
    const jump = event.target.closest("[data-view-jump]");
    if (jump) setView(jump.dataset.viewJump);
    const configSurface = event.target.closest("[data-config-surface]");
    if (configSurface) setConfigSurface(configSurface.dataset.configSurface);
    const configSurfaceJump = event.target.closest("[data-config-surface-jump]");
    if (configSurfaceJump) setView("config", { configSurface: configSurfaceJump.dataset.configSurfaceJump });
    const capabilitySource = event.target.closest("[data-capability-source-id]");
    if (capabilitySource) void openCapabilitySource(capabilitySource.dataset.capabilitySourceId);
    const archivedToggle = event.target.closest("#archived-toggle");
    if (archivedToggle) {
      state.archivedExpanded = !state.archivedExpanded;
      renderRailMetaSections(); // 折叠态不保留归档会话 DOM
      return;
    }
    const runMenu = event.target.closest("[data-run-menu]");
    if (runMenu) {
      const item = state.runs.find((run) => run.id === runMenu.dataset.runMenu);
      if (item) showContextMenuFromTrigger(runMenu, runContextItems(item));
      return;
    }
    const projectMenu = event.target.closest("[data-project-menu]");
    if (projectMenu) {
      const project = findProjectById(projectMenu.dataset.projectMenu);
      if (project) showContextMenuFromTrigger(projectMenu, projectContextItems(project));
      return;
    }
    // 配置图谱「配置目标」切换与远程面板动作（v41 波四）
    const configHostChip = event.target.closest("[data-config-host]");
    if (configHostChip) selectConfigHost(configHostChip.dataset.configHost || null);
    if (event.target.closest("[data-config-host-manage]")) setView("hosts");
    const configHostProbe = event.target.closest("[data-config-host-probe]");
    if (configHostProbe) void probeConfigHost(configHostProbe.dataset.configHostProbe);
    const configInstallCli = event.target.closest("[data-config-install-cli]");
    if (configInstallCli) {
      const [hostId, toolId] = String(configInstallCli.dataset.configInstallCli).split(":");
      if (hostId && toolId) void installConfigCli(hostId, toolId);
    }
    const configHostSync = event.target.closest("[data-config-host-sync]");
    if (configHostSync) {
      const syncHost = (state.configHosts ?? []).find((entry) => entry.id === configHostSync.dataset.configHostSync);
      if (syncHost) void openConfigSyncDialog(syncHost);
    }
    const configHostTerminal = event.target.closest("[data-config-host-terminal]");
    if (configHostTerminal) void openConfigHostTerminal(configHostTerminal.dataset.configHostTerminal);
    const run = event.target.closest("[data-run-select]");
    if (run) selectRun(run.dataset.runSelect);
    const teamOption = event.target.closest("[data-team-select]");
    if (teamOption) selectTeam(teamOption.dataset.teamSelect);
    const projectToggle = event.target.closest("[data-project-toggle]");
    if (projectToggle) toggleProject(projectToggle.dataset.projectToggle, projectToggle);
    // Codex 式「展开显示」：整列表重渲染为全量（焦点让位给列表首个可交互行——按钮本身被替换，无处归还）
    const showMore = event.target.closest("[data-sessions-showmore]");
    if (showMore) {
      const project = findProjectById(showMore.dataset.sessionsShowmore);
      const list = showMore.closest("ul");
      if (project && list) {
        state.showAllSessions.add(project.id);
        // 远程项目没有本地原生会话，整列重渲必须走 run 台账聚合（否则被刷成「无历史对话」）
        list.innerHTML = project.remoteProject
          ? remoteProjectSessionItems(project) || `<li class="project-empty">${REMOTE_PROJECT_EMPTY_HINT}</li>`
          : sessionGroupsMarkup(project, visibleTreeSessions(project)) || `<li class="project-empty">无历史对话</li>`;
        list.querySelector(".run-group-toggle, .cli-group-toggle, .session-link")?.focus({ preventScroll: true });
      }
    }
    const teamToggle = event.target.closest("[data-team-toggle]");
    if (teamToggle) {
      // 团队节点：折叠时释放整棵项目子树；展开时才按当前模型创建。
      const id = teamToggle.dataset.teamToggle;
      const wasExpanded = state.expandedTeams.has(id);
      if (wasExpanded) state.expandedTeams.delete(id);
      else state.expandedTeams.add(id);
      teamToggle.setAttribute("aria-expanded", String(!wasExpanded));
      const list = byId(teamToggle.getAttribute("aria-controls"));
      if (list) {
        if (wasExpanded) list.replaceChildren();
        else if (id === UNASSIGNED_TEAM_NODE_ID) {
          // 未归属虚拟组不在 model.teams 里，走通用查找会误报「团队已不存在」（2026-08-11 拍平后唯一 team-toggle 消费者）
          const model = projectTreeModel();
          list.innerHTML = model.unassignedProjects.map((project, itemIndex) => projectNodeMarkup(project, `u-${itemIndex}`)).join("")
            || `<li class="project-empty">无未归属项目</li>`;
        } else {
          const model = projectTreeModel();
          const index = model.teams.findIndex((team) => team.id === id);
          const team = model.teams[index];
          list.innerHTML = team
            ? teamChildrenMarkup(team, index, model.projectsByTeam.get(id) ?? [], model.looseByTeam.get(id) ?? [])
            : `<li class="project-empty">团队已不存在</li>`;
        }
        list.hidden = wasExpanded;
      }
    }
    // 协作会话组折叠：成员行是静态 markup，只需 hidden 切换 + aria 同步（不做全量重渲染，保焦点）
    const runGroupToggle = event.target.closest("[data-run-group-toggle]");
    if (runGroupToggle) {
      const id = runGroupToggle.dataset.runGroupToggle;
      const wasCollapsed = state.collapsedRunGroups.has(id);
      if (wasCollapsed) state.collapsedRunGroups.delete(id);
      else state.collapsedRunGroups.add(id);
      runGroupToggle.setAttribute("aria-expanded", String(wasCollapsed));
      const members = byId(runGroupToggle.getAttribute("aria-controls"));
      if (members) members.hidden = !wasCollapsed;
    }
    // CLI 分组折叠：同协作组纪律（hidden 切换 + aria 同步，不做全量重渲染）
    const cliGroupToggle = event.target.closest("[data-cli-group-toggle]");
    if (cliGroupToggle) {
      const key = cliGroupToggle.dataset.cliGroupToggle;
      const wasCollapsed = state.collapsedCliGroups.has(key);
      if (wasCollapsed) state.collapsedCliGroups.delete(key);
      else state.collapsedCliGroups.add(key);
      cliGroupToggle.setAttribute("aria-expanded", String(wasCollapsed));
      const members = byId(cliGroupToggle.getAttribute("aria-controls"));
      if (members) members.hidden = !wasCollapsed;
    }
    const pinnedProject = event.target.closest("[data-pinned-project]");
    if (pinnedProject) {
      // 置顶区项目内联展开：与项目树同一交互，展开态独立记账
      const id = pinnedProject.dataset.pinnedProject;
      const wasExpanded = state.expandedPinnedProjects.has(id);
      if (wasExpanded) state.expandedPinnedProjects.delete(id);
      else state.expandedPinnedProjects.add(id);
      pinnedProject.setAttribute("aria-expanded", String(!wasExpanded));
      const list = byId(pinnedProject.getAttribute("aria-controls"));
      if (list) {
        if (wasExpanded) list.replaceChildren();
        else {
          const project = findProjectById(id);
          // 置顶远程项目同样走 run 台账聚合（无本地原生会话）
          const items = project
            ? (project.remoteProject ? remoteProjectSessionItems(project) : sessionGroupsMarkup(project, visibleTreeSessions(project)))
            : "";
          list.innerHTML = items || (project?.remoteProject
            ? `<li class="project-empty">${REMOTE_PROJECT_EMPTY_HINT}</li>`
            : `<li class="project-empty">无历史对话</li>`);
        }
        list.hidden = wasExpanded;
      }
    }
    const projectNewSession = event.target.closest("[data-project-newsession]");
    if (projectNewSession && !projectNewSession.disabled) {
      const project = findProjectById(projectNewSession.dataset.projectNewsession);
      if (project?.remoteProject) {
        // v41 波二：远程项目「写」= 在此远端目录建 agent 会话（remote run，SSH 桥执行）——
        // 不再只是开终端；终端入口保留在项目右键菜单
        state.selectedRunId = null;
        state.selectionClearedByUser = true;
        state.activeTabKey = null;
        persistTabs();
        renderTabs();
        state.sessionPreview = null;
        state.pendingCwd = null;
        state.pendingRemote = {
          hostId: project.remote.hostId,
          path: project.remote.path,
          hostName: project.remote.hostName || project.remote.hostId,
          projectId: project.id,
        };
        state.agentPickerOpen = true; // 新建会话先选直接发送目标（官方徽标悬浮卡）
        renderRuns();
        elements["task-input"].focus();
        toast(`已切到新任务模式（远程 ${state.pendingRemote.hostName} · ${project.remote.path}）——请选择直接发送目标`, "success");
      } else if (project?.path) {
        // 行尾「写」图标：在此项目目录下新建会话（cwd 已定，跳过选址对话框）→ 会话区弹 agent 徽标选择器
        state.selectedRunId = null;
        state.selectionClearedByUser = true;
        state.activeTabKey = null;
        persistTabs();
        renderTabs();
        state.sessionPreview = null;
        state.pendingCwd = project.path;
        state.pendingRemote = null; // 本地项目与远程位置互斥
        state.agentPickerOpen = true; // 新建会话先选直接发送目标（官方徽标悬浮卡）
        renderRuns();
        elements["task-input"].focus();
        toast(`已切到新任务模式（项目地址 ${project.path}）——请选择直接发送目标`, "success");
      }
    }
    // agent 徽标选择器：选定直接收件人标签并联动 CLI 专属控制目录。
    const pickAgent = event.target.closest("[data-pick-agent]");
    if (pickAgent) {
      const agentId = pickAgent.dataset.pickAgent;
      selectComposerTarget(agentId, { focusInput: false });
      state.agentPickerOpen = false;
      renderSelectedRun();
      elements["task-input"].focus({ preventScroll: true });
      toast(`直接发送给 ${agentLabel(agentId)}——已切换其 CLI 配置`, "success", 2600);
    }
    const sessionLink = event.target.closest("[data-session-project][data-session-id]");
    if (sessionLink) void openSessionPreview(sessionLink.dataset.sessionProject, sessionLink.dataset.sessionId, sessionLink.dataset.sessionCli ?? "claude", sessionLink.dataset.sessionScope ?? "");
    const previewClose = event.target.closest("[data-preview-close]");
    if (previewClose) closeSessionPreview();
    const sourceGroupHeader = event.target.closest("[data-source-group]");
    if (sourceGroupHeader) {
      const key = sourceGroupHeader.dataset.sourceGroup;
      if (state.sourceGroupsExpanded.has(key)) state.sourceGroupsExpanded.delete(key);
      else state.sourceGroupsExpanded.add(key);
      renderSources();
    }
    const source = event.target.closest("[data-source-id]");
    if (source) void selectSource(source.dataset.sourceId);
    const rollback = event.target.closest("[data-version-id]");
    if (rollback) void rollbackConfig(rollback.dataset.versionId);
    const approval = event.target.closest("[data-approval-id][data-approval-decision]");
    if (approval) void resolveApproval(approval.dataset.approvalId, approval.dataset.approvalDecision);
    // 协作台会话流内联审批：跳过二次弹窗，哈希随决议回传校验
    const inlineApproval = event.target.closest("[data-inline-approval-id][data-inline-approval-decision]");
    if (inlineApproval) void resolveInlineApproval(inlineApproval.dataset.inlineApprovalId, inlineApproval.dataset.inlineApprovalDecision);
    const leaseRevoke = event.target.closest("[data-lease-revoke-run]");
    if (leaseRevoke) void revokeCapabilityLease(leaseRevoke.dataset.leaseRevokeRun);
    const recoveryAck = event.target.closest("[data-recovery-ack]");
    if (recoveryAck) acknowledgeRecovery();
    // ask 回答卡：先切到提问成员标签，再聚焦输入框；否则发送会成为 steer。
    const focusAnswer = event.target.closest("[data-focus-answer]");
    if (focusAnswer) selectComposerTarget(focusAnswer.dataset.focusAnswer, { focusInput: true });
    // 欢迎空态快捷模板：填进 composer 不自动提交（可同步切换直接发送目标）
    const quickTemplate = event.target.closest("[data-quick-template]");
    if (quickTemplate) {
      applyQuickTemplate(quickTemplate.dataset.quickTemplate, quickTemplate.dataset.quickStartAgent || "");
    }
    const welcomeCat = event.target.closest("[data-welcome-cat]");
    if (welcomeCat) {
      state.welcomeCategory = welcomeCat.dataset.welcomeCat || "all";
      renderSelectedRun();
    }
    // （旧命令面板 <dialog> 已退役：条目点击由 command-palette.js 模块内部委托）
    // @ 提及菜单
    const mentionItem = event.target.closest("[data-mention-id]");
    if (mentionItem) {
      event.preventDefault();
      applyMention(mentionItem.dataset.mentionId);
    }
    // / 斜杠命令菜单
    const slashItem = event.target.closest("[data-slash-id]");
    if (slashItem) {
      event.preventDefault();
      applySlashCommand(slashItem.dataset.slashId);
    }
    const automationEdit = event.target.closest("[data-automation-edit]");
    if (automationEdit) openAutomationManager(automationEdit.dataset.automationEdit);
    const automationHistoryRun = event.target.closest("[data-automation-history-run]");
    if (automationHistoryRun) {
      closeAutomationManager();
      const runId = automationHistoryRun.dataset.automationHistoryRun;
      if (state.runs.some((run) => run.id === runId)) selectRun(runId);
      else toast("该运行已不在会话列表（可能已清除）", "info");
    }
    // 失败任务重发：prompt 回填 composer 新任务模式
    const retry = event.target.closest("[data-retry-run]");
    if (retry) retryRun(retry.dataset.retryRun);
    // 产物 diff：终态+有 worktree 的 run 展开/收起产物面板（内容服务端脱敏）
    const runDiff = event.target.closest("[data-run-diff]");
    if (runDiff) void toggleRunDiff(runDiff.dataset.runDiff);
    const settlementWorktree = event.target.closest("[data-settlement-continue-worktree]");
    if (settlementWorktree) {
      const run = state.runs.find((item) => item.id === settlementWorktree.dataset.settlementContinueWorktree);
      if (run) void continueRunInWorktree(run);
    }
    const settlementCopy = event.target.closest("[data-settlement-copy-path]");
    if (settlementCopy) {
      const path = settlementCopy.dataset.settlementCopyPath || "";
      void navigator.clipboard.writeText(path).then(
        () => toast("工作树路径已复制", "success", 1800),
        (error) => toast(`复制失败：${error.message}`, "error"),
      );
    }
    const settlementGit = event.target.closest("[data-settlement-copy-git]");
    if (settlementGit) {
      const text = settlementGit.dataset.settlementCopyGit || "";
      void navigator.clipboard.writeText(text).then(
        () => toast("git 命令已复制", "success", 1800),
        (error) => toast(`复制失败：${error.message}`, "error"),
      );
    }
    const settlementReveal = event.target.closest("[data-settlement-reveal]");
    if (settlementReveal) {
      const path = settlementReveal.dataset.settlementReveal || "";
      // 浏览器沙箱无法真正 open explorer；复制路径并提示
      void navigator.clipboard.writeText(path).then(
        () => toast("路径已复制——请在资源管理器地址栏粘贴打开", "info", 2800),
        (error) => toast(`复制失败：${error.message}`, "error"),
      );
    }
    const copyResume = event.target.closest("[data-copy-resume]");
    if (copyResume) {
      const cmd = copyResume.dataset.copyResume || "";
      void navigator.clipboard.writeText(cmd).then(
        () => toast("恢复命令已复制", "success", 1800),
        (error) => toast(`复制失败：${error.message}`, "error"),
      );
    }
    const loadEarlier = event.target.closest("[data-load-earlier]");
    if (loadEarlier) loadEarlierConversation();
    const loadNewer = event.target.closest("[data-load-newer]");
    if (loadNewer) loadNewerConversation();
    const returnLatest = event.target.closest("[data-return-latest]");
    if (returnLatest) returnToLatestConversation();
    // tab 页签：激活 / 关闭
    const tabActivate = event.target.closest("[data-tab-activate]");
    if (tabActivate) activateTab(tabActivate.dataset.tabActivate, { focusTab: true });
    const tabClose = event.target.closest("[data-tab-close]");
    if (tabClose) closeTab(tabClose.dataset.tabClose, { restoreFocus: true });
    const composerCliTab = event.target.closest("[data-composer-cli-tab]");
    if (composerCliTab) setComposerCliTab(composerCliTab.dataset.composerCliTab, { focus: true });
    const composerCliCommand = event.target.closest("[data-composer-cli-command]");
    if (composerCliCommand) applyComposerCliCommand(composerCliCommand.dataset.composerCliCommand);
    const composerCliAction = event.target.closest("[data-composer-cli-action]");
    if (composerCliAction) void runComposerCliAction(composerCliAction.dataset.composerCliAction);
    // 目标标签只含真实成员，它是唯一直接收件人入口。
    const composerTarget = event.target.closest("[data-composer-target]");
    if (composerTarget) selectComposerTarget(composerTarget.dataset.composerTarget);
    const requestedAgentRemove = event.target.closest("[data-requested-agent-remove]");
    if (requestedAgentRemove) removeRequestedAgent(requestedAgentRemove.dataset.requestedAgentRemove);
    // 拓扑参与者卡：点击=开该成员独立页（与成员条同语义）
    const topologyAgent = event.target.closest("[data-topology-agent]");
    if (topologyAgent && state.selectedRunId) openTab(state.selectedRunId, topologyAgent.dataset.topologyAgent);
    // 配置图谱能力面：MCP 隔离启停
    const mcpToggle = event.target.closest("[data-mcp-toggle]");
    if (mcpToggle) void toggleMcp(mcpToggle);
    // 代码块一键复制（取同容器 pre 的已转义文本——内容已过 redact+escape 链）
    const copyCode = event.target.closest("[data-copy-code]");
    if (copyCode) {
      const pre = copyCode.parentElement?.querySelector("pre");
      if (pre) {
        void navigator.clipboard.writeText(pre.textContent ?? "").then(
          () => toast("代码已复制", "success", 1800),
          (error) => toast(`复制失败：${error.message}`, "error"),
        );
      }
    }
    // v3.7 自动化行操作：立即跑 / 启停 / 删除 / 点主体跳上次运行
    const automationRun = event.target.closest("[data-automation-run]");
    if (automationRun) void triggerAutomation(automationRun.dataset.automationRun);
    const automationToggle = event.target.closest("[data-automation-toggle]");
    if (automationToggle) void toggleAutomation(automationToggle.dataset.automationToggle);
    const automationRemove = event.target.closest("[data-automation-remove]");
    if (automationRemove) void removeAutomation(automationRemove.dataset.automationRemove);
    const automationOpen = event.target.closest("[data-automation-open]");
    if (automationOpen) openAutomationLastRun(automationOpen.dataset.automationOpen);
  });

  document.addEventListener("keydown", (event) => {
    // 命令面板快捷键与面板内导航由 command-palette.js 模块自绑定（v4.0 Forge），这里不再重复处理。

    // Composer 菜单键盘事件由 textarea 自己独占，避免冒泡后一次方向键移动两项。

    const row = event.target.closest?.("[data-run-select][role='button']"); // 合成事件 target 可为 document
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      selectRun(row.dataset.runSelect);
      return;
    }
    const targetRadio = event.target.closest?.("[role='radio'][data-composer-target]");
    if (targetRadio && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const radios = [...elements["member-strip"].querySelectorAll("[role='radio'][data-composer-target]")];
      if (!radios.length) return;
      event.preventDefault();
      const current = Math.max(0, radios.indexOf(targetRadio));
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? radios.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % radios.length
            : (current - 1 + radios.length) % radios.length;
      selectComposerTarget(radios[nextIndex].dataset.composerTarget);
      requestAnimationFrame(() => elements["member-strip"]?.querySelector(`[data-composer-target="${CSS.escape(radios[nextIndex].dataset.composerTarget)}"]`)?.focus({ preventScroll: true }));
      return;
    }
    const cliTab = event.target.closest?.("[role='tab'][data-composer-cli-tab]");
    if (cliTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      const tabs = [...elements["composer-cli-console"].querySelectorAll("[role='tab'][data-composer-cli-tab]")];
      if (!tabs.length) return;
      event.preventDefault();
      const current = Math.max(0, tabs.indexOf(cliTab));
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowRight"
            ? (current + 1) % tabs.length
            : (current - 1 + tabs.length) % tabs.length;
      setComposerCliTab(tabs[nextIndex].dataset.composerCliTab, { focus: true });
      return;
    }
    const tab = event.target.closest?.("[role='tab'][data-tab-activate]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...elements["conv-tabs"].querySelectorAll("[role='tab'][data-tab-activate]")];
    if (!tabs.length) return;
    event.preventDefault();
    const current = Math.max(0, tabs.indexOf(tab));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (current + 1) % tabs.length
          : (current - 1 + tabs.length) % tabs.length;
    activateTab(tabs[nextIndex].dataset.tabActivate, { focusTab: true });
  });

  // 侧栏右键菜单：会话（三分区共用）与项目树（document 级委托一次覆盖）
  document.addEventListener("contextmenu", (event) => {
    // data-run-select 通用匹配：run 轨道 + 项目树协作聚合组头/成员行共用同一 run 菜单——
    // 早前限定 .run-rail-list，聚合组右键落不到任何分支，弹浏览器默认菜单（LO 2026-08-10）
    const runButton = event.target.closest("[data-run-select]");
    if (runButton) {
      const run = state.runs.find((item) => item.id === runButton.dataset.runSelect);
      if (run) {
        event.preventDefault();
        showContextMenu(runContextItems(run), event.clientX, event.clientY, { restoreFocus: runButton });
      }
      return;
    }
    // 聚合组折叠 chevron 本身不带 data-run-select，右键同样归属该 run 的菜单
    const groupToggle = event.target.closest("[data-run-group-toggle]");
    if (groupToggle) {
      const run = state.runs.find((item) => item.id === groupToggle.dataset.runGroupToggle);
      if (run) {
        event.preventDefault();
        showContextMenu(runContextItems(run), event.clientX, event.clientY, { restoreFocus: groupToggle });
      }
      return;
    }
    const sessionLink = event.target.closest("[data-session-project][data-session-id]");
    if (sessionLink) {
      const project = findProjectById(sessionLink.dataset.sessionProject);
      if (project) {
        event.preventDefault();
        showContextMenu(sessionContextItems(project, sessionLink.dataset.sessionId, sessionLink.dataset.sessionCli ?? "claude", sessionLink.dataset.sessionScope ?? ""), event.clientX, event.clientY, { restoreFocus: sessionLink });
      }
      return;
    }
    const projectToggle = event.target.closest("[data-project-toggle]");
    if (projectToggle) {
      const project = findProjectById(projectToggle.dataset.projectToggle);
      if (project) {
        event.preventDefault();
        showContextMenu(projectContextItems(project), event.clientX, event.clientY, { restoreFocus: projectToggle });
      }
      return;
    }
    const pinnedProject = event.target.closest("[data-pinned-project]");
    if (pinnedProject) {
      const project = findProjectById(pinnedProject.dataset.pinnedProject);
      if (project) {
        event.preventDefault();
        showContextMenu(projectContextItems(project), event.clientX, event.clientY, { restoreFocus: pinnedProject });
      }
    }
  });

  window.addEventListener("hashchange", () => {
    const route = parseForgeRoute();
    if (!FORGE_VIEW_TITLES[route.view]) return;
    if (route.view === "config" && route.configSurface === "capabilities" && route.memberId) {
      void openMemberConfigTarget({
        surface: "capabilities",
        memberId: route.memberId,
        runtimeProfileId: route.runtimeProfileId,
      });
      return;
    }
    if (route.view === "config" && route.configSurface === "sources" && route.runtimeProfileId) {
      void openMemberConfigTarget({
        surface: "runtime",
        memberId: route.memberId,
        runtimeProfileId: route.runtimeProfileId,
      });
      return;
    }
    setView(route.view, { updateHash: false, focus: false, configSurface: route.configSurface });
  });

  elements["refresh-button"].addEventListener("click", () => void refreshCurrentView());
  elements["task-form"].addEventListener("submit", createRun);
  elements["composer-cli-console-toggle"]?.addEventListener("click", () => setComposerCliOpen(!state.composerCliOpen));
  elements["composer-cli-default-save"]?.addEventListener("click", () => void saveComposerCliDefaults());
  elements["composer-cli-open-seat"]?.addEventListener("click", () => void openComposerCliSeat());
  elements["composer-cli-open-capabilities"]?.addEventListener("click", () => void openComposerCliCapabilities());
  elements["composer-cli-open-connection"]?.addEventListener("click", () => void openComposerCliConnection());
  for (const controlId of ["task-model", "task-effort", "task-permission"]) {
    elements[controlId]?.addEventListener("change", () => {
      // 续聊：模型/Effort/权限都是 run 级热改（模型与 Effort 每轮原生可改，权限限白名单迁移），
      // 直接 PATCH，下一轮生效；失败由 applyRunControlChange 回滚 select
      if (selectedRun() && !state.sessionPreview) {
        void applyRunControlChange(controlId, elements[controlId].value);
        if (controlId === "task-permission") syncPermissionPill();
        return;
      }
      rememberComposerControlDraft();
      renderComposerCliConsole();
      if (controlId === "task-permission") syncPermissionPill();
    });
  }
  // 权限 pill：镜像 task-permission 原 select，点选即改 select 并走既有 change 链路。
  const permissionPill = elements["permission-pill"];
  const permissionMenu = elements["permission-menu"];
  permissionPill?.addEventListener("click", (event) => {
    event.stopPropagation();
    setPermissionMenuOpen(permissionMenu?.hidden !== false);
  });
  permissionMenu?.addEventListener("click", (event) => {
    const option = event.target.closest("[data-permission-option]");
    if (!option) return;
    const select = elements["task-permission"];
    if (!select) return;
    select.value = option.dataset.permissionOption;
    select.dispatchEvent(new Event("change"));
    setPermissionMenuOpen(false);
    syncPermissionPill();
  });
  permissionMenu?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setPermissionMenuOpen(false);
    permissionPill?.focus({ preventScroll: true });
  });
  document.addEventListener("click", (event) => {
    if (!permissionMenu || permissionMenu.hidden) return;
    if (event.target.closest("#task-permission-pick")) return;
    setPermissionMenuOpen(false);
  });
  elements["save-automation-button"]?.addEventListener("click", () => void saveAutomationFromComposer());
  elements["composer-new-task"].addEventListener("click", () => {
    // 退出续聊模式：保留当前成员选择作为新任务直接收件人，页签栏仍可切回。
    const currentTarget = activeComposerTarget();
    state.composerTargetAgentId = currentTarget.memberId;
    state.selectedRunId = null;
    state.selectionClearedByUser = true;
    state.activeTabKey = null;
    persistTabs();
    renderTabs();
    renderMemberStrip();
    void syncModelPick();
    elements["task-input"].value = "";
    renderRuns();
    elements["task-input"].focus({ preventScroll: true });
  });
  elements["new-session-button"].addEventListener("click", openSessionDialog);
  elements["new-task-row"].addEventListener("click", openSessionDialog); // Codex 式全宽入口，与 + 同路
  elements["team-newsession-button"]?.addEventListener("click", openSessionDialog); // Codex 式分区头「+」，同路
  elements["rail-search-row"]?.addEventListener("click", () => openForgePalette()); // Codex 式搜索行 → 命令面板
  // Codex 式「项目 ▾」：团队分区头折叠整棵项目树（DOM 手术，不重渲染；折叠态内存级）
  elements["team-tree-toggle"]?.addEventListener("click", () => {
    state.teamTreeCollapsed = !state.teamTreeCollapsed;
    elements["team-tree-toggle"].setAttribute("aria-expanded", String(!state.teamTreeCollapsed));
    const tree = elements["workbench-project-tree"];
    if (tree) tree.hidden = state.teamTreeCollapsed;
  });
  elements["composer-team"].addEventListener("change", () => selectTeam(elements["composer-team"].value)); // 创建会话时直接选从属团队
  elements["start-agent"].addEventListener("change", () => selectComposerTarget(elements["start-agent"].value)); // 隐藏兼容桥：旧模块采用建议时汇入唯一目标源
  elements["composer-cwd"].addEventListener("click", () => {
    if (!elements["composer-cwd"].disabled) openSessionDialog();
  });
  elements["session-form"].addEventListener("submit", confirmSessionDialog);
  elements["session-cwd-input"].addEventListener("input", () => {
    updateSessionCwdHint();
    renderSessionDirpick();
    syncSessionNameFromCwd();
  });
  elements["session-close-button"].addEventListener("click", () => elements["session-dialog"].close());
  elements["session-cancel-button"].addEventListener("click", () => elements["session-dialog"].close());
  elements["attach-button"].addEventListener("click", async () => {
    // ➕ 附件：服务端原生文件选择框（多选），路径入 chips、提交时并入 prompt
    const button = elements["attach-button"];
    button.disabled = true;
    try {
      const result = await request("/api/system/pick-file", { method: "POST" });
      if (Array.isArray(result.paths) && result.paths.length) {
        for (const path of result.paths) if (!state.attachments.includes(path)) state.attachments.push(path);
        renderAttachments();
      }
    } catch (error) {
      toast(`附件选择失败：${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
  elements["attach-chips"].addEventListener("click", (event) => {
    const detach = event.target.closest("[data-detach]");
    if (!detach) return;
    state.attachments.splice(Number(detach.dataset.detach), 1);
    renderAttachments();
  });
  // 会话向导：源文件夹选择区（原生目录框，与会话对话框旧「浏览…」同接口）
  elements["session-dirpick"].addEventListener("click", async () => {
    const button = elements["session-dirpick"];
    button.disabled = true;
    try {
      const result = await request("/api/system/pick-directory", { method: "POST" });
      if (result.path) {
        elements["session-cwd-input"].value = result.path;
        updateSessionCwdHint();
        renderSessionDirpick();
        syncSessionNameFromCwd();
      }
    } catch (error) {
      toast(`目录选择失败：${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });
  // 步骤导航与类型卡片（远程卡按台账可用性动态启停，点击记录类型）
  elements["session-next-button"].addEventListener("click", () => {
    setSessionDialogStep("info");
    (state.sessionDialogType === "remote" ? elements["session-remote-host"] : elements["session-cwd-input"]).focus();
  });
  elements["session-prev-button"].addEventListener("click", () => setSessionDialogStep("type"));
  for (const card of elements["session-step-type"].querySelectorAll("[data-session-type]")) {
    card.addEventListener("click", () => {
      if (card.disabled) return;
      selectSessionDialogType(card.dataset.sessionType);
    });
  }
  elements["session-name-input"].addEventListener("input", () => {
    elements["session-name-input"].dataset.touched = "1";
  });
  // 远程项目表单：主机切换重置路径回默认 home 并重列；路径/上级/目录点选都汇入同一浏览状态机
  elements["session-remote-host"].addEventListener("change", () => {
    elements["session-remote-path"].value = "";
    void loadRemoteBrowser({ force: true });
    syncRemoteNameFromPath();
  });
  elements["session-remote-path"].addEventListener("change", () => {
    void loadRemoteBrowser({ force: true });
    syncRemoteNameFromPath();
  });
  elements["session-remote-up"].addEventListener("click", () => {
    const input = elements["session-remote-path"];
    input.value = remotePathParent(input.value.trim() || "/");
    void loadRemoteBrowser({ force: true });
    syncRemoteNameFromPath();
  });
  elements["session-remote-browser"].addEventListener("click", (event) => {
    const item = event.target.closest("[data-remote-cd]");
    if (!item) return;
    const input = elements["session-remote-path"];
    input.value = remotePathJoin(input.value.trim() || "/", item.dataset.remoteCd);
    void loadRemoteBrowser({ force: true });
    syncRemoteNameFromPath();
  });
  elements["session-remote-name"].addEventListener("input", () => {
    elements["session-remote-name"].dataset.touched = "1";
  });
  for (const id of ["task-model", "task-effort", "task-permission"]) {
    elements[id]?.addEventListener("change", () => {
      renderStatusline();
      renderComposerCliConsole();
    });
  }
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
  elements["manage-teams-button"]?.addEventListener("click", () => void openTeamWorkspace(currentTeam()));
  elements["team-new-button"]?.addEventListener("click", async () => {
    if (!await confirmDiscardTeamDraft()) return;
    memberLibrary?.setSurface("orchestration", { focus: false });
    fillTeamForm(null);
    elements["team-name-input"]?.focus();
  });
  renderTeamPresetSelect();
  elements["team-preset-select"]?.addEventListener("change", () => {
    const presetId = elements["team-preset-select"].value;
    if (presetId) void applyTeamPreset(presetId);
    else renderTeamPresetSelect();
  });
  elements["team-export-button"]?.addEventListener("click", () => void exportEditingTeam());
  elements["team-import-button"]?.addEventListener("click", () => elements["team-import-file"]?.click());
  elements["team-import-file"]?.addEventListener("change", () => {
    const file = elements["team-import-file"].files?.[0];
    elements["team-import-file"].value = ""; // 允许重复选同一文件
    if (file) void importTeamPack(file);
  });
  elements["team-switch-select"]?.addEventListener("change", async () => {
    const id = elements["team-switch-select"].value;
    if (!await confirmDiscardTeamDraft()) {
      renderTeamSwitcher(teamById(state.editingTeamId));
      return;
    }
    fillTeamForm(state.teams.find((item) => item.id === id) ?? null);
  });
  elements["team-activate-button"]?.addEventListener("click", activateEditingTeam);
  elements["team-apply-providers-button"]?.addEventListener("click", () => {
    if (state.editingTeamId) void applyTeamProviders(state.editingTeamId);
  });
  elements["team-edit-button"]?.addEventListener("click", () => {
    memberLibrary?.setSurface("orchestration", { focus: false });
    elements["team-form"]?.scrollIntoView({ block: "start", behavior: "smooth" });
    requestAnimationFrame(() => {
      const target = elements["team-name-input"]?.disabled ? elements["team-form-title"] : elements["team-name-input"];
      if (target === elements["team-form-title"]) target?.setAttribute("tabindex", "-1");
      target?.focus?.({ preventScroll: true });
    });
  });
  elements["team-cancel-button"]?.addEventListener("click", resetTeamForm);
  // 芯片墙失败态「重试」：清错误后重拉目录，勾选意图取 teamChipsPending（失败时已暂存），钩子负责回填
  elements["team-settings-panel"]?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-chips-retry]")) return;
    state.capabilitiesError = null;
    const pending = state.teamChipsPending ?? { skills: [], mcp: [], readOnly: false };
    renderTeamChips(pending.skills, pending.mcp, pending.readOnly);
  });
  elements["team-form"]?.addEventListener("submit", (event) => void saveTeamForm(event));
  elements["team-members-list"]?.addEventListener("change", (event) => {
    const card = event.target.closest(".team-member-option");
    if (!card) return;
    const checkbox = card.querySelector('input[type="checkbox"]');
    const radio = card.querySelector('input[name="team-coordinator"]');
    if (event.target === radio && radio.checked) {
      if (checkbox && !checkbox.checked) checkbox.checked = true;
      elements["team-form"].dataset.coordinator = radio.value;
    }
    if (event.target === checkbox && !checkbox.checked && radio?.checked) {
      radio.checked = false;
      elements["team-form"].dataset.coordinator = "";
      toast("已移除原主脑，请为团队重新指定主脑", "warning", 4200);
    }
    updateTeamRosterSummary();
    memberLibrary?.updateTeamToggle();
  });
  elements["team-members-list"]?.addEventListener("click", (event) => {
    const groupToggle = event.target.closest("[data-toggle-member-group]");
    if (groupToggle) {
      const brand = groupToggle.closest(".tm-group")?.dataset.groupBrand;
      if (!brand) return;
      if (teamMemberGroupCollapsed.has(brand)) teamMemberGroupCollapsed.delete(brand);
      else teamMemberGroupCollapsed.add(brand);
      applyTeamMemberFilter();
      return;
    }
    const edit = event.target.closest("[data-edit-team-member]");
    if (!edit) return;
    event.preventDefault();
    event.stopPropagation();
    void memberLibrary?.open(edit.dataset.editTeamMember);
  });
  elements["team-members-search"]?.addEventListener("input", (event) => {
    event.stopPropagation(); // 搜索框不是团队草稿字段，绝不能让 form 的 input 监听误标脏
    teamMembersQuery = elements["team-members-search"].value || "";
    applyTeamMemberFilter();
  });
  elements["team-members-search"]?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements["team-members-search"].value) {
      elements["team-members-search"].value = "";
      teamMembersQuery = "";
      applyTeamMemberFilter();
      event.stopPropagation();
    }
  });
  elements["team-member-create-button"]?.addEventListener("click", () => void memberLibrary?.createNew());
  elements["team-form"]?.addEventListener("input", markTeamFormDirty);
  elements["team-form"]?.addEventListener("change", markTeamFormDirty);
  elements["team-delete-button"]?.addEventListener("click", () => void deleteEditingTeam());
  // LO 2026-08-04：团队选择持久化到 localStorage（退出客户端重进后恢复上次团队）；旧 sessionStorage 值迁移一次
  state.selectedTeamId = localStorage.getItem(TEAM_KEY) || sessionStorage.getItem(TEAM_KEY) || BUILTIN_TEAM_ID;
  localStorage.setItem(TEAM_KEY, state.selectedTeamId);
  initProjectSummariesToggle();
  initSubagentsToggle();
  initRecentOnlyToggle();
  initShowHiddenToggle();
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
  elements["diagnostic-log-filter"]?.addEventListener("change", (event) => {
    state.diagnosticLogFilter = event.target.value;
    renderDiagnosticLog();
  });
  elements["capabilities-refresh-button"]?.addEventListener("click", () => void loadCapabilities({ fresh: true }));
  elements["config-topology-tabs"]?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...elements["config-topology-tabs"].querySelectorAll("[data-config-surface]")];
    const current = Math.max(0, tabs.indexOf(document.activeElement));
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    setConfigSurface(tabs[next].dataset.configSurface);
    tabs[next].focus();
  });
  // 供应商方案：面板委托（启用/编辑/删除/检查/测速/排序/故障转移/用量卡片按钮）+ 对话框 + 应用团队方案
  elements["provider-columns"]?.addEventListener("click", (event) => {
    const appTab = event.target.closest("[data-provider-app-tab]");
    if (appTab) {
      setProviderActiveApp(appTab.dataset.providerAppTab);
      return;
    }
    const addButton = event.target.closest("[data-provider-add-app]");
    if (addButton) {
      openProviderDialog(null, { app: addButton.dataset.providerAddApp || null });
      return;
    }
    // 官方登录虚拟行「存为档案」：开新增对话框并预填端点/官方分类，凭据仍留 CLI 托管
    const archiveOfficial = event.target.closest("[data-provider-archive-official]");
    if (archiveOfficial) {
      const app = archiveOfficial.dataset.providerArchiveOfficial;
      const liveInfo = state.providersData?.live?.[app] ?? {};
      const label = PROVIDER_APP_META.find((entry) => entry.app === app)?.label ?? app;
      openProviderDialog(null, {
        app,
        prefill: {
          name: `${label} 官方`,
          baseUrl: liveInfo.baseUrl ?? "",
          category: "official",
          notes: "官方登录态认亲档案——OAuth 凭据由 CLI 托管（managed 块），此处仅存端点用于统一管理与 live 认亲。",
        },
      });
      return;
    }
    const switchButton = event.target.closest("[data-provider-switch]");
    if (switchButton) {
      const [app, providerId] = String(switchButton.dataset.providerSwitch).split("::");
      void switchProvider(app, providerId);
      return;
    }
    const editButton = event.target.closest("[data-provider-edit]");
    if (editButton) {
      const provider = providerById(editButton.dataset.providerEdit);
      if (provider) openProviderDialog(provider);
      return;
    }
    const deleteButton = event.target.closest("[data-provider-delete]");
    if (deleteButton) {
      void deleteProvider(deleteButton.dataset.providerDelete);
      return;
    }
    const checkButton = event.target.closest("[data-provider-check]");
    if (checkButton) {
      void checkProviderHealth(checkButton.dataset.providerCheck);
      return;
    }
    const speedButton = event.target.closest("[data-provider-speed]");
    if (speedButton) {
      void speedTestProvider(speedButton.dataset.providerSpeed);
      return;
    }
    const usageButton = event.target.closest("[data-provider-usage]");
    if (usageButton) {
      void queryProviderUsageNow(usageButton.dataset.providerUsage);
      return;
    }
    const moveButton = event.target.closest("[data-provider-move]");
    if (moveButton) {
      const [app, providerId, direction] = String(moveButton.dataset.providerMove).split("::");
      void moveProvider(app, providerId, Number(direction));
      return;
    }
    const failoverAdd = event.target.closest("[data-provider-failover-add]");
    if (failoverAdd) {
      const [app, providerId] = String(failoverAdd.dataset.providerFailoverAdd).split("::");
      void failoverSetMembership(app, providerId, true);
      return;
    }
    const failoverRemove = event.target.closest("[data-provider-failover-remove]");
    if (failoverRemove) {
      const [app, providerId] = String(failoverRemove.dataset.providerFailoverRemove).split("::");
      void failoverSetMembership(app, providerId, false);
    }
  });
  elements["provider-columns"]?.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-failover-toggle]");
    if (toggle) void failoverToggleAuto(toggle.dataset.failoverToggle, toggle.checked);
  });
  // app 图标条：切换聚焦应用（一次只看一个应用的供应商列表）
  elements["provider-app-bar"]?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-provider-app-tab]");
    if (tab) setProviderActiveApp(tab.dataset.providerAppTab);
  });
  // 行式列表拖拽排序：dragstart 记档案 id → dragover 标插入位 → drop 落 appOrder
  elements["provider-columns"]?.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-provider-row]");
    if (!row || !event.dataTransfer) return;
    providerDragId = row.dataset.providerRow;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", providerDragId);
    row.classList.add("is-dragging");
  });
  elements["provider-columns"]?.addEventListener("dragover", (event) => {
    if (!providerDragId) return;
    event.preventDefault(); // 允许 drop（含落到列表空白 = 排到末尾）
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const row = event.target.closest("[data-provider-row]");
    if (!row || row.dataset.providerRow === providerDragId) return;
    const rect = row.getBoundingClientRect();
    const after = event.clientY - rect.top > rect.height / 2;
    row.classList.toggle("is-dragover-before", !after);
    row.classList.toggle("is-dragover-after", after);
  });
  elements["provider-columns"]?.addEventListener("drop", (event) => {
    if (!providerDragId) return;
    event.preventDefault();
    const row = event.target.closest("[data-provider-row]");
    const targetId = row?.dataset.providerRow ?? null;
    const insertAfter = row ? row.classList.contains("is-dragover-after") : true;
    const dragId = providerDragId;
    clearProviderDragState();
    if (!targetId || targetId === dragId) return;
    void dropProviderRow(dragId, targetId, insertAfter);
  });
  elements["provider-columns"]?.addEventListener("dragend", clearProviderDragState);
  elements["provider-add-button"]?.addEventListener("click", () => openProviderDialog());
  elements["provider-form"]?.addEventListener("submit", (event) => void saveProviderForm(event));
  elements["provider-cancel-button"]?.addEventListener("click", closeProviderDialog);
  elements["provider-close-button"]?.addEventListener("click", closeProviderDialog);
  elements["provider-delete-button"]?.addEventListener("click", () => {
    if (state.editingProviderId) void deleteProvider(state.editingProviderId);
  });
  elements["provider-apply-team-button"]?.addEventListener("click", () => void applyTeamProviders());
  // 工具条：排序模式 / 导入 / 导出 / 深链接 / 环境检查
  elements["provider-sort-button"]?.addEventListener("click", () => {
    state.providerSortMode = !state.providerSortMode;
    renderProviders();
  });
  elements["provider-import-button"]?.addEventListener("click", importProvidersFromFile);
  elements["provider-export-button"]?.addEventListener("click", () => void exportProviders());
  elements["provider-deeplink-button"]?.addEventListener("click", () => openProviderDeeplink());
  elements["provider-envcheck-button"]?.addEventListener("click", () => void checkProviderEnvConflicts());
  // 对话框：分区 tab + 端点管理 + 模板联动 + 脚本测试
  elements["provider-dialog"]?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-provider-tab]");
    if (tab) {
      setProviderDialogTab(tab.dataset.providerTab);
      return;
    }
    const endpointRemove = event.target.closest("[data-endpoint-remove]");
    if (endpointRemove) {
      state.providerDialogEndpoints.splice(Number(endpointRemove.dataset.endpointRemove), 1);
      renderProviderEndpoints();
      return;
    }
    const endpointUse = event.target.closest("[data-endpoint-use]");
    if (endpointUse) {
      const entry = state.providerDialogEndpoints[Number(endpointUse.dataset.endpointUse)];
      if (entry) {
        const previous = elements["provider-baseurl-input"].value.trim();
        elements["provider-baseurl-input"].value = entry.url;
        state.providerDialogEndpoints.splice(Number(endpointUse.dataset.endpointUse), 1);
        if (previous) state.providerDialogEndpoints.push({ url: previous, addedAt: new Date().toISOString(), lastUsed: null });
        renderProviderEndpoints();
      }
    }
  });
  elements["provider-endpoint-add-button"]?.addEventListener("click", addProviderEndpoint);
  elements["provider-endpoint-input"]?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addProviderEndpoint();
    }
  });
  elements["provider-endpoint-test-button"]?.addEventListener("click", () => void testProviderEndpoints());
  elements["provider-usage-template"]?.addEventListener("change", () => void applyUsageTemplate());
  elements["provider-usage-test-button"]?.addEventListener("click", () => void testUsageScriptNow());
  elements["provider-model-test-button"]?.addEventListener("click", () => void testProviderModelNow());
  for (const app of PROVIDER_APPS) {
    elements[`provider-app-${app}`]?.addEventListener("change", (event) => {
      const block = elements[`provider-models-${app}`];
      if (block) block.hidden = !event.target.checked;
      renderProviderPresetGrid(); // 预设网格按勾选应用过滤
    });
  }
  // 预设选择器：搜索过滤 + 网格点选自动填充
  elements["provider-preset-search"]?.addEventListener("input", (event) => {
    state.providerPresetQuery = event.target.value;
    renderProviderPresetGrid();
  });
  elements["provider-preset-grid"]?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-preset-key]");
    if (!card) return;
    const [app, ...nameParts] = card.dataset.presetKey.split(":");
    const preset = (state.providerPresets?.[app] ?? []).find((entry) => entry.name === nameParts.join(":"));
    if (preset) applyProviderPreset(app, preset);
  });
  // 通用配置对话框：开关 ↔ JSON 双向同步 + 三应用 tab + 保存
  elements["provider-common-config-button"]?.addEventListener("click", openCommonConfigDialog);
  elements["common-config-close-button"]?.addEventListener("click", () => elements["common-config-dialog"].close());
  elements["common-config-cancel-button"]?.addEventListener("click", () => elements["common-config-dialog"].close());
  elements["common-config-form"]?.addEventListener("submit", (event) => void saveCommonConfigForm(event));
  elements["common-config-dialog"]?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-common-tab]");
    if (tab) setCommonConfigTab(tab.dataset.commonTab);
  });
  elements["common-config-claude"]?.addEventListener("input", syncCommonTogglesFromJson);
  for (const def of COMMON_TOGGLE_DEFS) {
    elements[def.id]?.addEventListener("change", () => applyCommonToggleToJson(def));
  }
  // 行号编辑器：供应商对话框「配置预览」区块 + 通用配置对话框 Claude JSON
  providerCommonJsonEditorHandle = attachJsonEditor(elements["provider-common-json-editor"]);
  commonClaudeJsonEditorHandle = attachJsonEditor(elements["common-config-claude-editor"]);
  // 供应商对话框「配置预览」：表单任一字段变化防抖重跑干跑预览（服务端掩码；手改不盖）
  elements["provider-dialog"]?.addEventListener("input", refreshProviderConfigPreview);
  elements["provider-dialog"]?.addEventListener("change", refreshProviderConfigPreview);
  elements["provider-preview-tabs"]?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-preview-tab]");
    if (!tab) return;
    providerPreviewState.active = Number(tab.dataset.previewTab) || 0;
    renderProviderPreview();
  });
  // 聚焦取明文 → 可编辑；手改进 edits（保存时以 rawConfig 补丁落档案）
  elements["provider-common-json"]?.addEventListener("focus", () => void maybeRevealProviderPreview());
  elements["provider-common-json"]?.addEventListener("input", () => {
    const current = providerPreviewCurrent();
    if (!current || current.removed) return;
    if (providerPreviewState.revealed[current.path] === undefined) return; // 未取明文前只读（readOnly 已挡，双保险）
    providerPreviewState.edits[current.path] = elements["provider-common-json"].value;
    providerPreviewState.rawDirty = true;
    refreshProviderConfigPreview();
  });
  elements["provider-preview-reset-button"]?.addEventListener("click", () => {
    const current = providerPreviewCurrent();
    if (!current) return;
    providerPreviewState.resets.add(current.path);
    delete providerPreviewState.edits[current.path];
    delete providerPreviewState.revealed[current.path];
    providerPreviewState.rawDirty = true;
    renderProviderPreview();
    refreshProviderConfigPreview();
    toast("已重置为投影——保存后生效", "info", 3000);
  });
  elements["provider-edit-common-button"]?.addEventListener("click", openCommonConfigDialog);
  elements["provider-deeplink-preview-button"]?.addEventListener("click", () => void previewProviderDeeplink());
  elements["provider-deeplink-form"]?.addEventListener("submit", (event) => void importProviderDeeplink(event));
  elements["provider-deeplink-close-button"]?.addEventListener("click", () => elements["provider-deeplink-dialog"].close());
  elements["provider-deeplink-cancel-button"]?.addEventListener("click", () => elements["provider-deeplink-dialog"].close());
  elements["provider-deeplink-input"]?.addEventListener("input", () => {
    state.providerDeeplinkPreview = null;
    elements["provider-deeplink-import-button"].disabled = true;
    elements["provider-deeplink-preview"].textContent = "链接已改变，请重新预览。";
  });
  window.addEventListener("forge:ccswitch-deeplink", (event) => {
    const url = typeof event.detail === "string" ? event.detail : event.detail?.url;
    if (url) void enqueueCcSwitchDeeplink(url);
  });
  const pendingCcSwitchDeeplinks = Array.isArray(window.__FORGE_CCSWITCH_DEEPLINKS__)
    ? window.__FORGE_CCSWITCH_DEEPLINKS__.splice(0)
    : [];
  for (const entry of pendingCcSwitchDeeplinks) {
    const url = typeof entry === "string" ? entry : entry?.url;
    if (url) void enqueueCcSwitchDeeplink(url);
  }
  elements["cap-skills-body"]?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-skill-toggle]");
    if (checkbox) void toggleAgentSkill(checkbox);
  });
  // composer 成熟产品键位：Enter 发送、Shift+Enter 换行；@ 提及 / 斜杠命令激活时拦截
  const taskInput = elements["task-input"];
  if (taskInput) {
    taskInput.addEventListener("keydown", (event) => {
      if ((state.mentionActive || state.slashActive) && event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        hideMentionMenu();
        hideSlashMenu();
        return;
      }
      if ((state.mentionActive || state.slashActive) && (event.key === "Enter" || event.key === "Tab") && !event.isComposing) {
        if (state.mentionActive) {
          const pick = state.mentionCandidates?.[state.mentionIndex];
          if (pick) {
            event.preventDefault();
            applyMention(pick.id);
            return;
          }
        }
        if (state.slashActive) {
          const pick = state.slashCandidates?.[state.slashIndex];
          if (pick) {
            event.preventDefault();
            applySlashCommand(pick.id);
            return;
          }
        }
        event.stopPropagation();
      }
      if ((state.mentionActive || state.slashActive) && (event.key === "ArrowDown" || event.key === "ArrowUp") && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        if (state.mentionActive) {
          const list = state.mentionCandidates ?? [];
          if (!list.length) return;
          state.mentionIndex = Math.max(0, Math.min(list.length - 1, (state.mentionIndex ?? 0) + delta));
          byId("mention-menu")?.querySelectorAll(".mention-item").forEach((el, index) => {
            el.classList.toggle("is-active", index === state.mentionIndex);
          });
        } else {
          const list = state.slashCandidates ?? [];
          if (!list.length) return;
          state.slashIndex = Math.max(0, Math.min(list.length - 1, (state.slashIndex ?? 0) + delta));
          syncSlashActiveOption();
        }
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        elements["submit-task-button"]?.click();
      }
    });
    taskInput.addEventListener("input", () => {
      taskInput.style.height = "auto";
      taskInput.style.height = `${Math.min(taskInput.scrollHeight, 220)}px`;
      state.requestedAgentIds = pruneRequestedAgentIds(state.requestedAgentIds, taskInput.value, agentLabel);
      renderRequestedAgentChips();
      renderMentionMenu();
      renderSlashMenu();
      syncSideChatDraftFromComposer();
      syncSubmitButtonMode(); // 输入有无决定发送/停止双态
    });
    taskInput.addEventListener("click", () => {
      renderMentionMenu();
      renderSlashMenu();
    });
    taskInput.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (document.activeElement === taskInput || document.activeElement?.closest?.("#mention-menu, #slash-menu")) return;
        hideMentionMenu();
        hideSlashMenu();
      }, 120);
    });
    byId("slash-menu")?.addEventListener("pointerdown", (event) => event.preventDefault());
  }

  byId("automations-manage-button")?.addEventListener("click", () => openAutomationManager());
  byId("automation-close-button")?.addEventListener("click", () => closeAutomationManager());
  byId("automation-form-close")?.addEventListener("click", () => closeAutomationManager());
  byId("automation-form")?.addEventListener("submit", (event) => void saveAutomationEdits(event));
  byId("automation-edit-select")?.addEventListener("change", () => fillAutomationManager(byId("automation-edit-select").value));
  byId("automation-run-now-button")?.addEventListener("click", () => {
    const id = byId("automation-edit-select")?.value;
    if (id) void triggerAutomation(id);
  });
  byId("automation-cancel-run-button")?.addEventListener("click", () => {
    const id = byId("automation-edit-select")?.value;
    if (id) void cancelAutomationRun(id);
  });

  // 命令面板：旧 <dialog> 已退役，顶栏 chip 直接调 v4.0 Forge 面板（command-palette.js）
  byId("command-palette-trigger")?.addEventListener("click", () => openForgePalette());

  window.addEventListener("beforeunload", (event) => {
    state.eventController?.abort();
    missionControlDock?.destroy();
    if (!configIsDirty() && !teamFormDirty && !memberLibrary?.isDirty() && !runtimeSeatManager?.isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

// ─── v4.0 新增辅助函数 ──────────────────────────────────────

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function focusTaskInput() {
  const input = byId("task-input");
  if (input) {
    setView("workbench");
    requestAnimationFrame(() => input.focus());
  }
}

async function refreshAll() {
  await Promise.allSettled([
    loadHealth(),
    loadRuns(),
    loadProjects(),
    loadTeams(),
  ]);
}

function refreshTeamData() {
  const team = teamById(state.selectedTeamId) || state.teams.find((item) => item.builtin) || state.teams[0] || null;
  updateTeamData(buildTeamPanelData({
    team,
    runs: state.runs,
    components: state.components,
    catalog: state.bootstrap?.teamCatalog,
  }));
}

async function loadDeltaData() {
  // v4.0：delta-timeline 模块自取数（refreshDeltaTimeline 内部 fetch 并容错），此处置只负责触发
  try {
    await refreshDeltaTimeline();
  } catch {
    // 静默失败
  }
}

async function start() {
  cacheElements();
  await mountLucideSprite();
  remapLegacyIconUses(document);
  workbenchEnvironmentPanel = createWorkbenchEnvironmentPanel({
    root: byId("mission-environment-panel"),
    // 任务工具已由 railTools 接管（右栏标签条 ➕ 菜单与空态选择器），环境舱只管自己的动作
    toolsRoot: null,
    loadEnvironment: (runId, signal) => request(
      `${API.workbenchEnvironment}${runId ? `?runId=${encodeURIComponent(runId)}` : ""}`,
      { signal },
    ),
    onAction: handleWorkbenchEnvironmentAction,
    getAttachments: () => state.attachments,
    icon: (name) => lucideIcon(name, "icon lucide"),
    escapeHtml,
    renderAgentAvatar: (agentId) => cliIconMarkup(agentCli(agentId), "cli-logo")
      || `<i>${escapeHtml(AGENT_SHORT[agentId] || String(agentId).slice(0, 2))}</i>`,
    agentLabel,
  });
  const railRoot = byId("mission-control-dock");
  railPanels = createRailPanels({
    root: railRoot,
    request,
    runsEndpoint: API.runs,
    icon: (name) => lucideIcon(name, "icon lucide"),
    escapeHtml,
    getRunId: () => (state.sessionPreview ? null : selectedRun()?.id ?? null),
    getRun: () => (state.sessionPreview ? null : selectedRun()),
    openSystemBrowser: openExternalUrl,
    notify: toast,
  });
  railTools = createRailTools({
    root: railRoot,
    icon: (name) => lucideIcon(name, "icon lucide"),
    escapeHtml,
    // 只接 onActivate：open() 之后必然跟一次 activate，两处都接会让同一个页发两遍请求、互相 abort
    onActivate: (id) => railPanels?.activate(id),
    // 终端是底部抽屉、侧边对话是右栏浮层：两者都不占标签，只转发动作
    onExternal: (id) => {
      if (id === "terminal") byId("global-terminal-toggle")?.click();
      if (id === "side-chat") setMissionSideChat(byId("mission-side-chat")?.hidden !== false);
    },
  });
  missionControlDock = createMissionControlDock({
    root: byId("mission-control-dock"),
    loadSnapshot: (runId, signal) => request(`${API.runs}/${encodeURIComponent(runId)}/mission`, { signal }),
    loadWorkspace: (runId, path, signal) => request(
      `${API.runs}/${encodeURIComponent(runId)}/workspace?path=${encodeURIComponent(path ?? "")}`,
      { signal },
    ),
    onArtifactAction: (artifact, snapshot) => {
      if (artifact.kind === "diff") void toggleRunDiff(snapshot.runId);
    },
    environmentPanel: workbenchEnvironmentPanel,
    // 无选中 run 时仍展示异构 CLI 团队健康——514 特色空态，不是空白灰区
    loadIdleRoster: () => {
      const team = teamById(state.selectedTeamId) || state.teams.find((item) => item.builtin) || state.teams[0];
      const members = team?.members?.length
        ? team.members
        : ["claude-fable", "codex-technical", "grok-search", "grok-build", "kimi-frontend", "pi-resident"];
      const healthList = Array.isArray(state.health?.components)
        ? state.health.components
        : Array.isArray(state.components) ? state.components : [];
      const healthById = new Map(healthList.map((item) => [String(item.id ?? item.name ?? "").toLowerCase(), item]));
      return {
        teamName: team?.name || "514cc",
        coordinatorId: team?.coordinator || members[0],
        members: members.map((id) => {
          const cli = agentCli(id);
          const health = healthById.get(String(id).toLowerCase())
            || healthById.get(String(cli || "").toLowerCase())
            || null;
          const status = health?.status || health?.state || (health?.available === false ? "offline" : "unknown");
          return {
            id,
            label: agentLabel(id),
            role: id === (team?.coordinator || members[0]) ? "leader" : (AGENT_ROLE_BLURB[id] || "member"),
            cli: cliLabel(cli),
            status,
            detail: health?.detail || health?.message || null,
          };
        }),
      };
    },
  });
  await initializeAccessToken(); // 一次性 bootstrap 必须先兑换，后续 API 与 SSE 才能携带当前 tab 会话态
  workbenchEnvironmentPanel?.selectRun?.(null);
  mountCcSwitchPanel({ root: byId("ccswitch-workbench"), notify: toast, confirmAction, cliIconMarkup });
  restorePendingProjects(); // 必须早于 setView 触发的异步项目扫描，pending 深链才不会被误报不存在
  initializeTheme();
  try { state.composerCliOpen = localStorage.getItem(COMPOSER_CLI_OPEN_KEY) === "1"; } catch { state.composerCliOpen = false; }
  bindEvents();
  // 活跃轮走时：只改 time 节点文本，不重绘会话流；submitted 期间没有中间 checkpoint，
  // 这是用户判断"还在跑"还是"已经停了"的唯一依据。
  window.setInterval(tickLiveElapsed, 1000);

  memberLibrary = createMemberLibrary({
    state,
    request,
    apiPath: API.teamMembers,
    escapeHtml,
    toast,
    confirmAction,
    onCatalogChanged: async () => {
      await invalidateCapabilitiesCatalog();
      reconcileTeamFormCatalog("member-catalog-refresh");
      refreshTeamData();
      renderTeamPulse();
      runtimeSeatManager?.refreshBindings?.(); // 成员增删/改绑后，席位编辑器绑定区块同步
    },
    teamMemberState: (memberId) => {
      const input = [...(elements["team-members-list"]?.querySelectorAll('input[type="checkbox"]') || [])]
        .find((candidate) => candidate.value === memberId);
      const editing = teamById(state.editingTeamId);
      return {
        available: Boolean(teamFormInitialized && input && !teamFormBusy && !editing?.builtin),
        included: Boolean(input?.checked),
      };
    },
    onToggleTeamMember: async (memberId, include) => {
      const input = [...(elements["team-members-list"]?.querySelectorAll('input[type="checkbox"]') || [])]
        .find((candidate) => candidate.value === memberId);
      if (!input || input.disabled) {
        toast("当前团队草稿无法修改该成员", "warning");
        return;
      }
      input.checked = include;
      const card = input.closest(".team-member-option");
      const coordinator = card?.querySelector('input[name="team-coordinator"]');
      if (!include && coordinator?.checked) {
        coordinator.checked = false;
        elements["team-form"].dataset.coordinator = "";
        toast("已移除原主脑，请重新指定团队主脑", "warning", 4200);
      }
      markTeamFormDirty();
      updateTeamRosterSummary();
    },
    onOpenConfig: (target) => void openMemberConfigTarget(target),
    cliIconMarkup,
    onOpenTeam: (teamId) => {
      const team = teamById(teamId);
      if (team) void openTeamWorkspace(team);
      else toast("该团队已不存在", "warning");
    },
    onMemberSaved: (memberId) => {
      // 新建成员保存成功（目录已刷新、列表已重渲）→ 自动勾入当前团队草稿；内置只读团队不勾。
      if (!teamFormInitialized || teamById(state.editingTeamId)?.builtin) return;
      const input = [...(elements["team-members-list"]?.querySelectorAll('input[type="checkbox"]') || [])]
        .find((candidate) => candidate.value === memberId);
      if (!input || input.disabled || input.checked) return;
      input.checked = true;
      markTeamFormDirty();
      updateTeamRosterSummary();
      memberLibrary?.updateTeamToggle();
      toast("新成员已自动勾入当前团队草稿，保存团队后生效", "success", 4200);
    },
  });
  memberLibrary.init();

  runtimeSeatManager = createRuntimeSeatManager({
    state,
    request,
    api: API,
    escapeHtml,
    toast,
    confirmAction,
    getProviders: () => state.providersData?.providers ?? [],
    ensureProviders: async () => {
      await loadTeams();
      return loadProviders();
    },
    onCatalogChanged: async () => {
      await loadBootstrap();
      await loadTeams({ fresh: true });
      await invalidateCapabilitiesCatalog();
      reconcileTeamFormCatalog("runtime-seat-catalog-refresh");
      refreshTeamData();
      renderTeamPulse();
      memberLibrary?.updateTeamToggle();
      memberLibrary?.refreshUsage?.(); // 席位目录变化可能影响团队成员归属展示
      renderConfigTopology();
    },
    onModeChanged: () => renderConfigTopology(),
    cliIconMarkup,
    onOpenMember: (memberId) => {
      setView("team");
      void memberLibrary?.open(memberId);
    },
    onSelectionChanged: (runtimeProfileId) => {
      state.configRuntimeFocusId = runtimeProfileId || null;
      renderConfigTopology();
      if (state.view === "config" && state.configSurface === "sources" && state.runtimeWorkspaceMode === "seats") {
        history.replaceState(null, "", configRouteHash("sources", {
          memberId: state.configMemberFocusId,
          runtimeProfileId: state.configRuntimeFocusId,
        }));
      }
    },
  });
  runtimeSeatManager.init();

  // v4.0：命令面板 + 团队面板初始化
  initCmdPalette({
    extraItems: () => FORGE_PALETTE_EXTRA_ITEMS(),
    onNavigate: (viewId) => setView(viewId),
    onAction: (actionId) => {
      if (actionId === "refresh") void refreshAll();
      else if (actionId === "toggle-theme") toggleTheme();
      else if (actionId === "new-task") focusTaskInput();
      else if (actionId === "run-diagnostics") void runDiagnostics();
      else if (actionId === "reload-runtime") void reloadRuntime();
      else if (actionId.startsWith("select-agent:")) {
        const agentId = actionId.split(":")[1];
        // 切换到协作台并聚焦该 Agent
        setView("workbench");
      }
    },
  });

  // 团队面板（容器可能尚未落位；v4.0 团队协作视图的 section 也作为挂载兜底）
  const teamContainer = byId("team-panel-container") || byId("view-team");
  if (teamContainer) {
    initTeamPanel(teamContainer);
  }

  // DELTA 问责时间线
  const deltaContainer = byId("delta-timeline-container");
  if (deltaContainer) {
    initDeltaTimeline(deltaContainer);
    loadDeltaData();
  }

  // 项目启动器
  const bootstrapperContainer = byId("bootstrapper-container");
  if (bootstrapperContainer) {
    initProjectBootstrapper(bootstrapperContainer, {
      onCreate: (config, result) => {
        // v4.0：脚手架由 project-bootstrapper 模块内部执行（POST /api/bootstrap/scaffold），
        // onCreate 仅通知——旧版模块只回传 config 时不误报，安静等新版结果
        if (result == null) return;
        if (result.ok) {
          const files = Array.isArray(result.filesWritten) ? result.filesWritten.length
            : Array.isArray(result.filesPlanned) ? result.filesPlanned.length : 0;
          const where = result.targetDir ? ` → ${result.targetDir}` : "";
          toast(`项目脚手架完成：${config?.name || "项目"}（${files} 个文件）${where}`, "success", 5200);
        } else {
          toast(`项目脚手架失败：${result.error || "未知错误"}`, "error", 6000);
        }
      },
    });
  }
  const initialRoute = parseForgeRoute();
  const initialMemberTarget = initialRoute.view === "config" && (
    initialRoute.configSurface === "capabilities" && initialRoute.memberId
    || initialRoute.configSurface === "sources" && initialRoute.runtimeProfileId
  );
  if (initialMemberTarget) {
    state.configMemberFocusId = initialRoute.memberId;
    state.configRuntimeFocusId = initialRoute.runtimeProfileId;
  }
  setView(FORGE_VIEW_TITLES[initialRoute.view] ? initialRoute.view : "workbench", {
    updateHash: false,
    focus: false,
    configSurface: initialRoute.configSurface,
    preserveMemberTarget: Boolean(initialMemberTarget),
  });
  renderAll();
  connectEvents();
  await loadInitial();
  if (initialMemberTarget) {
    await openMemberConfigTarget({
      surface: initialRoute.configSurface === "capabilities" ? "capabilities" : "runtime",
      memberId: initialRoute.memberId,
      runtimeProfileId: initialRoute.runtimeProfileId,
    });
  }
  restoreTabs(); // runs 就绪后恢复页签（已清除 run 的页签如实丢弃）——刷新不丢工作现场
  renderTabs();
  renderRuns();
  if (state.selectedSourceId && !state.config) await loadSelectedConfig();
  window.setInterval(() => {
    void loadHealth().catch(() => {});
  }, 30_000);
}

void start().catch((error) => {
  console.error(error);
  if (elements["toast-region"]) toast(`控制台启动失败：${error.message}`, "error", 8000);
});
