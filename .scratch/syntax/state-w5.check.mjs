/**
 * state.js — 514cc Console 全局状态管理
 *
 * 从 app.js 抽取的全局状态。
 * v4.0 app.js 组件化第三步：状态管理独立模块。
 */

// 活跃运行状态
export const ACTIVE_RUN_STATES = new Set([
  "queued", "waiting_agent", "waiting_approval", "planning",
  "waiting_for_approval", "executing", "integrating", "verifying",
  "active", "running", "recovery_required",
]);

// 终态运行状态
export const TERMINAL_RUN_STATES = new Set([
  "complete", "completed", "succeeded", "failed", "blocked", "cancelled", "canceled",
]);

export const MAX_REQUESTED_AGENTS = 4;

export function addRequestedAgentId(current, agentId) {
  const ids = [...new Set((current || []).map(String).filter(Boolean))];
  const normalized = String(agentId || "").trim();
  if (!normalized || ids.includes(normalized) || ids.length >= MAX_REQUESTED_AGENTS) return ids;
  return [...ids, normalized];
}

export function pruneRequestedAgentIds(current, text, labelForAgent) {
  const source = String(text || "");
  return [...new Set((current || []).map(String).filter(Boolean))]
    .filter((id) => source.includes(`@${labelForAgent(id)}`))
    .slice(0, MAX_REQUESTED_AGENTS);
}

export function removeRequestedAgentMention(text, label) {
  const source = String(text || "");
  const escaped = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return source;
  return source
    .replace(new RegExp(`@${escaped}(?=\\s|$|[，。！？、,.;:])`, "gu"), "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

// 视图标题映射
export const VIEW_TITLES = Object.freeze({
  overview: "系统总览",
  workbench: "协作台",
  team: "团队协作",
  channels: "渠道",
  config: "配置图谱",
  router: "模型路由",
  security: "安全诊断",
  observability: "体系观测",
  sessions: "会话聚合",
  bootstrapper: "项目启动器",
  office: "文档工坊",
  terminal: "终端",
  market: "市场",
  hosts: "远程主机",
  hero: "协作星图",
});

// 默认组件
export const DEFAULT_COMPONENTS = Object.freeze([
  { id: "control-api", name: "Control API", detail: "/api/bootstrap", status: "pending" },
  { id: "claude", name: "Claude Fable", detail: "规划与统一编排", status: "unknown" },
  { id: "codex", name: "Codex 技术", detail: "实现、评审与验证", status: "unknown" },
  { id: "event-bus", name: "事件总线", detail: "SSE /api/events", status: "pending" },
]);

// 默认模型
export const DEFAULT_MODELS = Object.freeze([
  { role: "规划编排", adapter: "Claude CLI", model: "运行时选择", strengths: ["规划", "编排", "综合"], status: "unknown" },
  { role: "技术", adapter: "Codex CLI", model: "运行时选择", strengths: ["实现", "代码评审", "验证"], status: "unknown" },
  { role: "搜索", adapter: "Grok Search", model: "运行时选择", strengths: ["当前资料", "快速检索"], status: "unknown" },
  { role: "快执行", adapter: "Grok Build", model: "grok-4.5", strengths: ["快执行", "快综合"], status: "unknown" },
  { role: "扩展", adapter: "Pi", model: "运行时选择", strengths: ["RPC", "工具编排"], status: "unknown" },
]);

// 默认策略
export const DEFAULT_POLICIES = Object.freeze([
  { name: "Plan / Review", detail: "只读模式", value: "禁止写入", status: "ok" },
  { name: "Build", detail: "授权工作区内写入", value: "按动作审批", status: "ok" },
  { name: "危险操作", detail: "删除、部署、密钥与系统配置", value: "二次确认", status: "warning" },
  { name: "保护路径", detail: ".env、凭据、.git 与系统目录", value: "默认拒绝", status: "ok" },
]);

// 默认密钥
export const DEFAULT_SECRETS = Object.freeze([
  { name: "Claude Provider", reference: "secret reference", configured: null },
  { name: "Grok Search", reference: "secret reference", configured: null },
  { name: "MCP Connectors", reference: "environment references", configured: null },
]);

/**
 * 全局状态对象
 * 注意：这是可变对象，各模块共享引用。
 * 修改时直接赋值属性，不需要 setter。
 */
export const state = {
  view: "workbench",
  bootstrap: {},
  health: null,
  components: [...DEFAULT_COMPONENTS],
  sources: [],
  sourceFilter: "",
  selectedSourceId: null,
  config: null,
  configSurface: "providers",
  // 配置目标（v41 波四）：null=本机图谱；否则=SSH 台账主机 id，配置面切为远程配置面板
  configHostId: null,
  configHosts: null, // SSH 台账缓存（null=未拉取）
  configHostsError: null,
  configHostProbes: new Map(), // hostId → {status:"loading"|"ok"|"error", data?, error?}
  configHostResult: null, // {hostId, html} 远程面板内联结果（面板重渲后由 render 回填，不被吞）
  configHostGraph: new Map(), // hostId → {status:"loading"|"ok"|"error", data?, error?}（远程三面图谱）
  configHostSourceOpen: null, // {hostId, fileId} 当前展开的真源文件
  configHostSourceCache: new Map(), // `${hostId}:${fileId}` → {status, data?, error?}
  configMemberFocusId: null,
  configRuntimeFocusId: null,
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
  leases: [],
  diagnostics: [],
  diagnosticLog: [],
  diagnosticLogFilter: "all",
  capabilitiesData: null,
  capabilitiesError: null,
  capabilitiesLoading: false,
  providersData: null,
  providersLoading: false,
  editingProviderId: null,
  // 供应商列表当前聚焦的 app（CC Switch 形态：一次只看一个 app）；app.js 启动时从 localStorage 回填
  providerActiveApp: "claude",
  // cc-switch 二波会话缓存：健康检查/用量/测速结果（不落盘，刷新即重查）
  providerHealth: {}, // id → {status, responseTimeMs, message, testedAt}
  providerUsage: {}, // id → {success, data, error, queriedAt}
  providerLatency: {}, // url → {latency, status, error}
  usageTemplates: null, // GET /api/providers/usage-templates 一次性拉取
  providerPresets: null, // GET /api/providers/presets 一次性拉取（cc-switch 3.18 目录）
  providerPresetQuery: "",
  providerPresetSelected: null, // 预设带入的附加 meta（apiFormat/extraEnv/extraSettings/codexTop/codexProviderExtra/modelCatalog/icon/iconColor）
  providerDeeplinkPreview: null,
  providerDialogTab: "basic",
  providerDialogEndpoints: [], // 对话框内 customEndpoints 编辑暂存
  providerSortMode: false,
  teamChipsPending: null,
  sourceGroupsExpanded: new Set(), // 配置图谱真源树：会话级折叠态（含选中源的组永远自动展开，不入此集）
  runDiffView: null,
  tabs: [],
  activeTabKey: null,
  composerTargetAgentId: null,
  pendingProjects: [],
  agentPickerOpen: false,
  apiState: "pending",
  eventState: "pending",
  eventController: null,
  lastEventSequence: 0,
  streamEpoch: null,
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
  collapsedRunGroups: new Set(), // 协作会话组默认展开；收起态只存内存（刷新归展开，不持久化噪音偏好）
  collapsedCliGroups: new Set(), // CLI 分组（Claude/Codex…）同纪律：键 `${projectId}:${cli}`，内存态不持久化
  teamTreeCollapsed: false, // Codex 式「项目 ▾」分区头折叠态，内存不持久化
  selectionClearedByUser: false, // 显式切新任务模式（selectedRunId=null）的记账：loadRuns 自动选择不得回盖用户意图（LO 2026-08-11）
  showAllSessions: new Set(), // Codex 式「展开显示」：项目 id 集合——在列的项目会话列表不受 TREE_SESSIONS_CAP 截断
  projectSummaries: false,
  showSubagents: false,
  recentOnly: true,
  sessionPreview: null,
  attachments: [],
  projectPrefs: { revision: 0, projects: {}, sessions: {} },
  projectPrefsStatus: "idle",
  projectPrefsError: null,
  runEvents: Object.create(null),
  deepLinkRunId: null,
  deepLinkSession: null,
  deepLinkProjectId: null,
  expandedPinnedProjects: new Set(),
  expandedTeams: new Set(),
  expandedTeamsInitialized: false,
  archivedExpanded: false,
  previewSeq: 0,
  projectsSeq: 0,
  teams: [],
  teamStoreStatus: null,
  selectedTeamId: "team-514cc",
  editingTeamId: null,
  teamSurface: "orchestration",
  memberCatalog: [],
  runtimeCatalog: [],
  adapterTemplatesData: null,
  runtimeSeatsData: null,
  runtimeSeatsLoading: false,
  selectedRuntimeSeatId: null,
  runtimeWorkspaceMode: "seats",
  selectedMemberId: null,
  recoveryAckRunId: null,
  automations: [],
  automationStatus: { state: "loading", writable: false, failClosed: false, code: null, message: null },
  commandPaletteQuery: "",
  commandPaletteActions: [],
  commandPaletteIndex: -1,
  mentionActive: false,
  mentionCandidates: [],
  mentionIndex: -1,
  mentionRange: null,
  requestedAgentIds: [],
  slashActive: false,
  slashCandidates: [],
  slashIndex: -1,
  slashRange: null,
  agentControlCatalog: null,
  composerCliOpen: false,
  composerCliTab: "commands",
  composerControlDrafts: new Map(),
  composerCliActionStates: new Map(),
  welcomeCategory: "all",
  remoteGates: [],
};
