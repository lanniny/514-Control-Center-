import { request as apiRequest } from "../api.js";
import { escapeHtml, formatDate } from "../utils.js";

const PROVIDER_STORAGE_APPS = Object.freeze(["claude", "claude-desktop", "codex", "gemini", "grokbuild", "kimi", "opencode", "openclaw", "hermes"]);
const PROVIDER_SCHEME_APPS = Object.freeze(PROVIDER_STORAGE_APPS.filter((app) => app !== "claude-desktop"));
// kimi 无官方全局 Prompt 文件（文档未声明 ~/.kimi-code 级提示词），Prompt/Skill 同步面不收录
const PROMPT_APPS = Object.freeze(PROVIDER_SCHEME_APPS.filter((app) => app !== "kimi"));
const APP_LABELS = Object.freeze({ claude: "Claude Code", "claude-desktop": "Claude Desktop", codex: "Codex", gemini: "Gemini", grokbuild: "Grok Build", kimi: "Kimi Code", opencode: "OpenCode", openclaw: "OpenClaw", hermes: "Hermes" });
const AUTH_LABELS = Object.freeze({ github_copilot: "GitHub Copilot", codex_oauth: "Codex OAuth", xai_oauth: "xAI OAuth" });
const CLI_ENV_STATUS = Object.freeze({
  "up-to-date": Object.freeze({ tone: "is-ok", label: "已就绪" }),
  "upgrade-available": Object.freeze({ tone: "is-warning", label: "可升级" }),
  "not-installed": Object.freeze({ tone: "is-neutral", label: "未安装" }),
  broken: Object.freeze({ tone: "is-error", label: "无法运行" }),
  installed: Object.freeze({ tone: "is-ok", label: "已安装" }),
});
const CLI_ENV_PLATFORM_BADGES = Object.freeze({ win32: "Win", darwin: "macOS", linux: "Linux" });
const icon = (name) => `<svg class="icon lucide" aria-hidden="true"><use href="#lucide-${name}"></use></svg>`;
const attr = (value) => escapeHtml(String(value ?? ""));
const checked = (value) => value ? " checked" : "";
const selected = (value, expected) => value === expected ? " selected" : "";
const money = (value) => `$${Number(value || 0).toFixed(4)}`;
const json = (value) => JSON.stringify(value ?? {}, null, 2);

function appChecks(prefix, enabled = {}, apps = PROVIDER_SCHEME_APPS) {
  return `<div class="ccs-app-grid">${apps.map((app) => `<label class="ccs-check"><input type="checkbox" name="${prefix}-${app}"${checked(enabled[app])}><span>${APP_LABELS[app]}</span></label>`).join("")}</div>`;
}

function formApps(form, prefix, apps = PROVIDER_SCHEME_APPS) {
  return Object.fromEntries(apps.map((app) => [app, Boolean(form.elements.namedItem(`${prefix}-${app}`)?.checked)]));
}

function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label}不是合法 JSON`); }
}

export function cliEnvFailureDetail(error) {
  const message = String(error?.message ?? error ?? "未知错误");
  const payload = error?.payload?.error ?? error?.payload;
  const outputTail = typeof payload?.outputTail === "string" ? payload.outputTail.trim() : "";
  if (!outputTail) return message;
  const lines = outputTail.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const diagnostic = lines.filter((line) => /(?:error|notsup|unsupported|eperm|eacces|ebadplatform|failed)/i.test(line));
  const detail = (diagnostic.length ? diagnostic.slice(-8) : lines.slice(-6)).join(" | ").slice(-1200);
  return detail && !message.includes(detail) ? `${message}；${detail}` : message;
}

export function mountCcSwitchPanel({ root, notify = null, request: requestClient = apiRequest, confirmAction = null, cliIconMarkup = null } = {}) {
  if (!root) return null;
  const request = requestClient;
  // 安装/升级确认弹窗与 CLI 品牌图标由主驾（app.js）注入；缺省降级 window.confirm / 通用图标，单测不受影响
  const confirmDialog = typeof confirmAction === "function"
    ? confirmAction
    : ({ title }) => Promise.resolve(window.confirm(title));
  const brandIcon = typeof cliIconMarkup === "function" ? cliIconMarkup : () => "";
  /**
   * 页内二次确认统一出口。原生 window.confirm 在桌面壳 webview 里可能被吞（返回 false 而不弹窗），
   * 表现就是「点了恢复/删除没反应」——所以破坏性动作一律走主驾注入的页内对话框。
   * confirmAction 不带 checkbox 时 resolve 布尔，带 checkbox 才 resolve 对象；这里永不传 checkbox。
   */
  const askConfirm = async (options) => {
    const verdict = await confirmDialog(options);
    return verdict === true || verdict?.confirmed === true;
  };
  const state = {
    tab: "proxy", resourceTab: "prompts", promptApp: "claude", domain: null, configPaths: {}, proxy: null,
    providers: null, proxySummary: null, proxyLogs: [], proxyHealth: [], pricing: {}, auth: null, authFlows: {},
    authResource: {}, deeplink: null, deeplinkLoading: false, streamResults: [], env: null, native: null, upstreamScan: [], busy: false,
    workspace: null, workspaceFile: "AGENTS.md", workspaceContent: "", dailyFilename: new Date().toISOString().slice(0, 10) + ".md",
    dailyContent: "", workspaceSearch: [], hermesKind: "memory", hermesContent: "",
    cliEnv: null, cliEnvError: null, cliEnvLoading: false, cliEnvBusy: {},
  };

  function message(text, tone = "success") {
    const output = root.querySelector("[data-ccs-status]");
    if (output) { output.textContent = text; output.dataset.tone = tone; }
    notify?.(text, tone === "error" ? "error" : tone === "warning" ? "warning" : "success");
  }

  let loadPromise = null;
  function load() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      const paths = [
        "/api/ccswitch/domain", "/api/ccswitch/proxy/status", "/api/providers",
        "/api/ccswitch/proxy/usage/summary?days=30", "/api/ccswitch/proxy/logs?limit=50",
        "/api/ccswitch/proxy/health", "/api/ccswitch/proxy/pricing", "/api/ccswitch/auth",
      ];
      const results = await Promise.allSettled(paths.map((path) => request(path)));
      const [domain, proxy, providers, summary, logs, health, pricing, auth] = results;
      if (domain.status === "fulfilled") { state.domain = domain.value.state; state.configPaths = domain.value.configPaths ?? {}; }
      if (proxy.status === "fulfilled") state.proxy = proxy.value.status;
      if (providers.status === "fulfilled") state.providers = providers.value;
      if (summary.status === "fulfilled") state.proxySummary = summary.value.summary;
      if (logs.status === "fulfilled") state.proxyLogs = logs.value.items ?? [];
      if (health.status === "fulfilled") state.proxyHealth = health.value.items ?? [];
      if (pricing.status === "fulfilled") state.pricing = pricing.value.pricing ?? {};
      if (auth.status === "fulfilled") state.auth = auth.value;
      const nativeError = await loadNative();
      render();
      const errors = results.flatMap((item, index) => item.status === "rejected" ? [{ path: paths[index], error: item.reason }] : []);
      if (nativeError) errors.push(nativeError);
      if (errors.length && !state.domain && !state.proxy) message(`运行与配置工作台加载失败：${errors[0].error?.message ?? errors[0].error}`, "error");
      return { __forgeLoadResult: true, ok: errors.length === 0, errors };
    })().finally(() => { loadPromise = null; });
    return loadPromise;
  }

  async function loadNative() {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== "function") { state.native = null; return null; }
    try {
      const [capabilities, autoLaunch, lightweight] = await Promise.all([
        invoke("get_native_capabilities"), invoke("get_auto_launch_status"), invoke("is_lightweight_mode"),
      ]);
      state.native = { capabilities, autoLaunch: Boolean(autoLaunch), lightweight: Boolean(lightweight) };
      return null;
    } catch (error) {
      state.native = { error: error?.message ?? String(error) };
      return { path: "tauri:native", error };
    }
  }

  function nativeMarkup() {
    if (!state.native) return "";
    if (state.native.error) return `<section class="ccs-tool ccs-native-bar"><strong>桌面原生</strong><span class="status-label is-error">${escapeHtml(state.native.error)}</span></section>`;
    const caps = state.native.capabilities ?? {};
    return `<section class="ccs-tool ccs-native-bar"><div><strong>桌面原生</strong><span>${caps.tray ? "托盘" : "无托盘"} · ${escapeHtml(caps.deepLinkScheme || "-")} · ${caps.portableMode ? "便携" : "安装"} · ${escapeHtml(caps.lightweightStrategy || "-")}</span></div><label class="ccs-check"><input type="checkbox" data-ccs-native-autolaunch${checked(state.native.autoLaunch)}><span>开机自启</span></label><button class="button secondary" type="button" data-ccs-action="native-lightweight">${icon(state.native.lightweight ? "monitor-up" : "monitor-down")}${state.native.lightweight ? "退出轻量" : "进入轻量"}</button><button class="icon-button" type="button" data-ccs-action="native-restart" title="重启桌面端" aria-label="重启桌面端">${icon("refresh-ccw")}</button><span class="status-label ${caps.updater?.enabled ? "is-ok" : "is-neutral"}">${caps.updater?.enabled ? "Updater 可用" : "Updater 禁用"}</span></section>`;
  }

  function shell() {
    // 页头只讲这块面板「是什么」：外部产品名与版本属实现来源，留在代码注释与 DESIGN-NOTES，不占用户界面
    return `<div class="ccs-heading"><div><p class="eyebrow">本机运行时</p><h2>运行与配置工作台</h2><p class="ccs-heading-sub">CLI 环境 · 本地代理 · 资源库 · 云同步 · OAuth 账户</p></div><div class="ccs-heading-actions"><span class="ccs-inline-status" data-ccs-status data-tone="neutral">就绪</span><button class="icon-button" type="button" data-ccs-action="refresh" title="刷新工作台" aria-label="刷新运行与配置工作台">${icon("refresh-cw")}</button></div></div>
      <div class="ccs-tabs" role="tablist" aria-label="运行与配置工作台视图">${[["env", "环境", "wrench"], ["proxy", "代理", "waypoints"], ["resources", "资源", "library"], ["sync", "同步", "cloud"], ["accounts", "账户", "key-round"]].map(([id, label, glyph]) => `<button type="button" role="tab" class="ccs-tab${state.tab === id ? " is-active" : ""}" data-ccs-tab="${id}" aria-selected="${state.tab === id}">${icon(glyph)}<span>${label}</span></button>`).join("")}</div><div class="ccs-panel-body" data-ccs-body></div>`;
  }

  function render() {
    if (!root.querySelector("[data-ccs-body]")) root.innerHTML = shell();
    root.querySelectorAll("[data-ccs-tab]").forEach((button) => { const active = button.dataset.ccsTab === state.tab; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
    root.querySelector("[data-ccs-body]").innerHTML = state.tab === "env" ? cliEnvMarkup() : state.tab === "proxy" ? proxyMarkup() : state.tab === "resources" ? resourcesMarkup() : state.tab === "sync" ? syncMarkup() : accountsMarkup();
  }

  function proxyMarkup() {
    const status = state.proxy ?? {};
    const summary = state.proxySummary ?? {};
    const names = new Map((state.providers?.providers ?? []).map((item) => [item.id, item.name]));
    const healthItems = state.proxyHealth.filter((item) => PROVIDER_SCHEME_APPS.includes(item.app));
    const logItems = state.proxyLogs.filter((item) => !item.app || PROVIDER_SCHEME_APPS.includes(item.app));
    return `<div class="ccs-metrics"><div><span>状态</span><strong class="${status.running ? "is-ok" : "is-muted"}">${status.running ? "运行中" : "已停止"}</strong></div><div><span>地址</span><strong class="mono">${escapeHtml(status.origin || `${status.listenAddress || "127.0.0.1"}:${status.listenPort || 15721}`)}</strong></div><div><span>请求</span><strong>${Number(summary.requests || 0).toLocaleString()}</strong></div><div><span>Token</span><strong>${Number(summary.inputTokens || 0).toLocaleString()} / ${Number(summary.outputTokens || 0).toLocaleString()}</strong></div><div><span>费用</span><strong>${money(summary.costUsd)}</strong></div></div>${nativeMarkup()}
      <div class="ccs-two-col"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>代理控制</h3><span class="status-label ${status.running ? "is-ok" : "is-neutral"}">${status.running ? status.tokenMasked || "已鉴权" : "停止"}</span></div><form data-ccs-form="proxy"><div class="ccs-form-grid"><label class="field"><span class="field-label">监听地址</span><input name="listenAddress" value="${attr(status.listenAddress || "127.0.0.1")}"${status.running ? " disabled" : ""}></label><label class="field"><span class="field-label">端口</span><input name="listenPort" type="number" min="0" max="65535" value="${Number(status.listenPort ?? 15721)}"${status.running ? " disabled" : ""}></label><label class="field"><span class="field-label">失败阈值</span><input name="failureThreshold" type="number" min="1" max="100" value="${Number(status.circuitBreaker?.failureThreshold ?? 3)}"></label><label class="field"><span class="field-label">冷却 ms</span><input name="cooldownMs" type="number" min="100" max="3600000" value="${Number(status.circuitBreaker?.cooldownMs ?? 30000)}"></label></div><div class="ccs-actions"><button class="button secondary" type="submit">${icon("save")}保存</button>${status.running ? `<button class="button danger" type="button" data-ccs-action="proxy-stop">${icon("square")}停止并恢复</button>` : `<button class="button primary" type="button" data-ccs-action="proxy-start">${icon("play")}启动</button>`}</div></form></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>应用接管</h3><span>${PROVIDER_SCHEME_APPS.filter((app) => status.takeover?.[app]).length}/${PROVIDER_SCHEME_APPS.length}</span></div><div class="ccs-toggle-list">${PROVIDER_SCHEME_APPS.map((app) => `<label><span>${APP_LABELS[app]}</span><input type="checkbox" role="switch" data-ccs-takeover="${app}"${checked(status.takeover?.[app])}${status.running ? "" : " disabled"}></label>`).join("")}</div></section></div>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>出站代理</h3><span class="status-label ${status.upstreamProxy?.enabled ? "is-ok" : "is-neutral"}">${status.upstreamProxy?.enabled ? escapeHtml(status.upstreamProxy.urlMasked) : "直连"}</span></div><form data-ccs-form="upstream-proxy"><div class="ccs-inline-form"><input name="url" type="url" placeholder="http://127.0.0.1:7890"><button class="button secondary" type="submit">${icon("save")}应用</button><button class="button secondary" type="button" data-ccs-action="upstream-test">${icon("plug-zap")}测试</button><button class="button secondary" type="button" data-ccs-action="upstream-scan">${icon("radar")}扫描</button><button class="button danger" type="button" data-ccs-action="upstream-clear"${status.upstreamProxy?.enabled ? "" : " disabled"}>${icon("unplug")}直连</button></div></form>${state.upstreamScan.length ? `<div class="ccs-list compact">${state.upstreamScan.map((item) => `<div><span><strong class="mono">${escapeHtml(item.url)}</strong><small>${escapeHtml(item.proxyType)}</small></span><button class="button compact secondary" type="button" data-ccs-upstream-pick="${attr(item.url)}"${item.proxyType === "http" ? "" : " disabled"}>${icon("corner-down-left")}填入</button></div>`).join("")}</div>` : ""}</section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>熔断器</h3><span>${healthItems.length}</span></div><div class="table-scroll"><table class="data-table ccs-table"><thead><tr><th>应用</th><th>供应商</th><th>状态</th><th>失败</th><th></th></tr></thead><tbody>${healthItems.length ? healthItems.map((item) => `<tr><td>${escapeHtml(APP_LABELS[item.app] || item.app)}</td><td>${escapeHtml(names.get(item.providerId) || item.providerId)}</td><td><span class="status-label ${item.state === "closed" ? "is-ok" : item.state === "open" ? "is-error" : "is-warning"}">${escapeHtml(item.state)}</span></td><td>${Number(item.failures || item.consecutiveFailures || 0)}</td><td><button class="icon-button" type="button" data-ccs-reset-breaker="${attr(item.app)}|${attr(item.providerId)}" title="重置熔断器" aria-label="重置熔断器">${icon("rotate-ccw")}</button></td></tr>`).join("") : `<tr><td colspan="5" class="subtle">暂无熔断状态</td></tr>`}</tbody></table></div></section>
      <div class="ccs-two-col"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>模型定价</h3><span>${Object.keys(state.pricing).length}</span></div><form data-ccs-form="pricing" class="ccs-inline-form"><input name="model" placeholder="model-id" required><input name="inputPerMillion" type="number" step="0.0001" min="0" placeholder="输入 / 1M"><input name="outputPerMillion" type="number" step="0.0001" min="0" placeholder="输出 / 1M"><button class="button secondary" type="submit">${icon("plus")}写入</button></form><div class="ccs-list compact">${Object.entries(state.pricing).map(([model, price]) => `<div><span><strong>${escapeHtml(model)}</strong><small>${money(price.inputPerMillion)} / ${money(price.outputPerMillion)}</small></span><button class="icon-button" type="button" data-ccs-price-delete="${attr(model)}" title="删除定价" aria-label="删除 ${attr(model)} 定价">${icon("trash-2")}</button></div>`).join("") || `<p class="subtle">暂无自定义定价</p>`}</div></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>请求日志</h3><span>${logItems.length}</span></div><div class="ccs-log-list">${logItems.slice(0, 12).map((item) => `<div><span class="status-dot ${item.success ? "is-ok" : "is-error"}"></span><strong>${escapeHtml(APP_LABELS[item.app] || item.app || "-")}</strong><span>${escapeHtml(names.get(item.providerId) || item.providerId || "-")}</span><span>${escapeHtml(item.model || "-")}</span><span>${Number(item.durationMs || 0)}ms</span><span>${money(item.costUsd)}</span></div>`).join("") || `<p class="subtle">暂无请求</p>`}</div></section></div>`;
  }

  function resourceTabs() {
    return `<div class="ccs-subtabs" role="tablist">${[["prompts", "Prompt"], ["mcps", "MCP"], ["skills", "Skill"], ["profiles", "Profile"], ["workspace", "Workspace"], ["backups", "备份"], ["deeplink", "深链"]].map(([id, label]) => `<button type="button" class="${state.resourceTab === id ? "is-active" : ""}" data-ccs-resource-tab="${id}" role="tab" aria-selected="${state.resourceTab === id}">${label}</button>`).join("")}</div>`;
  }

  function resourcesMarkup() {
    const content = state.resourceTab === "prompts" ? promptsMarkup() : state.resourceTab === "mcps" ? mcpsMarkup() : state.resourceTab === "skills" ? skillsMarkup() : state.resourceTab === "profiles" ? profilesMarkup() : state.resourceTab === "workspace" ? workspaceMarkup() : state.resourceTab === "backups" ? backupsMarkup() : deeplinkMarkup();
    return `${resourceTabs()}${content}`;
  }

  function promptsMarkup() {
    const items = Object.values(state.domain?.prompts?.[state.promptApp] ?? {}).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return `<div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>Prompt</h3><select data-ccs-prompt-app>${PROMPT_APPS.map((app) => `<option value="${app}"${selected(app, state.promptApp)}>${APP_LABELS[app]}</option>`).join("")}</select></div><div class="ccs-list">${items.map((item) => `<div class="${item.enabled ? "is-selected" : ""}"><span><strong>${escapeHtml(item.name)}</strong><small>${item.enabled ? "已启用" : formatDate(item.updatedAt)}</small></span><span class="ccs-row-actions">${item.enabled ? `<button class="icon-button" type="button" data-ccs-prompt-disable="${attr(item.id)}" title="停用" aria-label="停用 ${attr(item.name)}">${icon("circle-pause")}</button>` : `<button class="icon-button" type="button" data-ccs-prompt-enable="${attr(item.id)}" title="启用" aria-label="启用 ${attr(item.name)}">${icon("circle-play")}</button>`}<button class="icon-button" type="button" data-ccs-prompt-edit="${attr(item.id)}" title="编辑" aria-label="编辑 ${attr(item.name)}">${icon("pencil")}</button><button class="icon-button" type="button" data-ccs-prompt-delete="${attr(item.id)}" title="删除" aria-label="删除 ${attr(item.name)}"${item.enabled ? " disabled" : ""}>${icon("trash-2")}</button></span></div>`).join("") || `<p class="subtle">暂无 Prompt</p>`}</div><button class="button secondary" type="button" data-ccs-action="prompt-import">${icon("file-input")}导入 live 文件</button></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>编辑 Prompt</h3><button class="icon-button" type="button" data-ccs-action="prompt-clear" title="新建" aria-label="新建 Prompt">${icon("file-plus-2")}</button></div><form data-ccs-form="prompt"><input type="hidden" name="id"><label class="field"><span class="field-label">名称</span><input name="name" maxlength="120" required></label><label class="field"><span class="field-label">说明</span><input name="description" maxlength="1000"></label><label class="field"><span class="field-label">内容</span><textarea name="content" rows="12" spellcheck="false"></textarea></label><label class="ccs-check inline"><input name="enabled" type="checkbox"><span>保存后启用</span></label><div class="ccs-actions"><button class="button primary" type="submit">${icon("save")}保存</button></div></form></section></div>`;
  }

  function mcpsMarkup() {
    const items = Object.values(state.domain?.mcps ?? {});
    return `<div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>MCP Server</h3><span>${items.length}</span></div><div class="ccs-list">${items.map((item) => `<div><span><strong>${escapeHtml(item.name)}</strong><small class="mono">${escapeHtml(item.config?.command || item.config?.url || item.id)}</small></span><span class="ccs-row-actions"><button class="icon-button" type="button" data-ccs-mcp-edit="${attr(item.id)}" title="编辑" aria-label="编辑 ${attr(item.name)}">${icon("pencil")}</button><button class="icon-button" type="button" data-ccs-mcp-delete="${attr(item.id)}" title="删除" aria-label="删除 ${attr(item.name)}">${icon("trash-2")}</button></span><div class="ccs-mini-apps">${PROVIDER_SCHEME_APPS.map((app) => `<label title="${APP_LABELS[app]}"><input type="checkbox" data-ccs-mcp-toggle="${attr(item.id)}|${app}"${checked(item.apps?.[app])}><span>${APP_LABELS[app].slice(0, 2)}</span></label>`).join("")}</div></div>`).join("") || `<p class="subtle">暂无 MCP</p>`}</div></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>编辑 MCP</h3><button class="icon-button" type="button" data-ccs-action="mcp-clear" title="新建" aria-label="新建 MCP">${icon("plus")}</button></div><form data-ccs-form="mcp"><label class="field"><span class="field-label">ID</span><input name="id" maxlength="96" required></label><label class="field"><span class="field-label">名称</span><input name="name" maxlength="120" required></label><label class="field"><span class="field-label">配置 JSON</span><textarea name="config" rows="9" spellcheck="false">{\n  "command": "npx",\n  "args": []\n}</textarea></label>${appChecks("mcp")}<div class="ccs-actions"><button class="button primary" type="submit">${icon("save")}保存</button></div></form></section></div>`;
  }

  function skillsMarkup() {
    const items = Object.values(state.domain?.skills ?? {});
    return `<div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>Skill</h3><span>${items.length}</span></div><div class="ccs-list">${items.map((item) => `<div><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || item.source?.repo || item.source || "local")}</small></span><button class="icon-button" type="button" data-ccs-skill-delete="${attr(item.id)}" title="卸载" aria-label="卸载 ${attr(item.name)}">${icon("trash-2")}</button><div class="ccs-mini-apps">${PROMPT_APPS.map((app) => `<label title="${APP_LABELS[app]}"><input type="checkbox" data-ccs-skill-toggle="${attr(item.id)}|${app}"${checked(item.apps?.[app])}><span>${APP_LABELS[app].slice(0, 2)}</span></label>`).join("")}</div></div>`).join("") || `<p class="subtle">暂无 Skill</p>`}</div></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>安装本地 Skill</h3></div><form data-ccs-form="skill"><label class="field"><span class="field-label">名称</span><input name="name" maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._-]*" required></label><label class="field"><span class="field-label">说明</span><input name="description" maxlength="1000"></label><label class="field"><span class="field-label">SKILL.md</span><textarea name="skillMd" rows="12" spellcheck="false">---\nname: skill-name\ndescription: description\n---\n</textarea></label>${appChecks("skill", { claude: true, codex: true }, PROMPT_APPS)}<div class="ccs-actions"><button class="button primary" type="submit">${icon("package-plus")}安装</button></div></form></section></div>`;
  }

  function profilesMarkup() {
    const items = Object.values(state.domain?.profiles ?? {});
    return `<div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>Profile</h3><span>${items.length}</span></div><div class="ccs-list">${items.map((item) => `<div><span><strong>${escapeHtml(item.name)}</strong><small>${formatDate(item.updatedAt)}</small></span><span class="ccs-row-actions"><button class="button compact secondary" type="button" data-ccs-profile-apply="${attr(item.id)}">${icon("play")}应用</button><button class="icon-button" type="button" data-ccs-profile-delete="${attr(item.id)}" title="删除" aria-label="删除 ${attr(item.name)}">${icon("trash-2")}</button></span></div>`).join("") || `<p class="subtle">暂无 Profile</p>`}</div></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>拍摄当前状态</h3></div><form data-ccs-form="profile"><label class="field"><span class="field-label">名称</span><input name="name" maxlength="120" required></label><label class="field"><span class="field-label">说明</span><input name="description" maxlength="1000"></label>${appChecks("profile", Object.fromEntries(PROVIDER_SCHEME_APPS.map((app) => [app, true])))}<div class="ccs-actions"><button class="button primary" type="submit">${icon("camera")}创建快照</button></div></form></section></div>`;
  }

  function workspaceMarkup() {
    if (!state.workspace) return `<section class="ccs-tool"><p class="subtle">正在读取 Workspace…</p></section>`;
    const files = state.workspace.openclaw?.files ?? [];
    const daily = state.workspace.openclaw?.daily ?? [];
    const limits = state.workspace.hermes?.limits ?? {};
    const hermesEnabled = state.hermesKind === "memory" ? limits.memoryEnabled : limits.userEnabled;
    return `<div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>OpenClaw Workspace</h3><button class="icon-button" type="button" data-ccs-action="workspace-reveal" title="打开目录" aria-label="打开 OpenClaw Workspace">${icon("folder-open")}</button></div><form data-ccs-form="workspace-file"><label class="field"><span class="field-label">文件</span><select name="filename">${files.map((item) => `<option value="${attr(item.filename)}"${selected(item.filename, state.workspaceFile)}>${escapeHtml(item.filename)}${item.exists ? "" : " · 新建"}</option>`).join("")}</select></label><label class="field"><span class="field-label">内容</span><textarea name="content" rows="14" spellcheck="false">${escapeHtml(state.workspaceContent)}</textarea></label><div class="ccs-actions"><button class="button primary" type="submit">${icon("save")}保存</button></div></form></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>Hermes Memory</h3><span>${Number(limits[state.hermesKind] || 0).toLocaleString()} chars</span></div><form data-ccs-form="hermes-memory"><label class="field"><span class="field-label">类型</span><select name="kind"><option value="memory"${selected("memory", state.hermesKind)}>MEMORY.md</option><option value="user"${selected("user", state.hermesKind)}>USER.md</option></select></label><label class="ccs-check inline"><input name="enabled" type="checkbox"${checked(hermesEnabled)}><span>启用</span></label><label class="field"><span class="field-label">内容</span><textarea name="content" rows="14" spellcheck="false">${escapeHtml(state.hermesContent)}</textarea></label><div class="ccs-actions"><button class="button primary" type="submit">${icon("save")}保存</button></div></form></section></div>
      <div class="ccs-resource-layout"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>Daily Memory</h3><button class="icon-button" type="button" data-ccs-action="daily-new" title="新建今日记忆" aria-label="新建今日记忆">${icon("file-plus-2")}</button></div><form data-ccs-form="daily-memory"><label class="field"><span class="field-label">日期文件</span><input name="filename" pattern="\\d{4}-\\d{2}-\\d{2}\\.md" value="${attr(state.dailyFilename)}" required></label><label class="field"><span class="field-label">内容</span><textarea name="content" rows="10" spellcheck="false">${escapeHtml(state.dailyContent)}</textarea></label><div class="ccs-actions"><button class="button primary" type="submit">${icon("save")}保存</button></div></form></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>每日记忆索引</h3><span>${daily.length}</span></div><form data-ccs-form="daily-search" class="ccs-inline-form"><input name="query" type="search" maxlength="200" placeholder="搜索 Daily Memory" required><button class="button secondary" type="submit">${icon("search")}搜索</button></form><div class="ccs-list compact">${(state.workspaceSearch.length ? state.workspaceSearch : daily).map((item) => `<div><span><strong>${escapeHtml(item.filename)}</strong><small>${escapeHtml(item.snippet || item.preview || `${item.size || 0} bytes`)}</small></span><span class="ccs-row-actions"><button class="icon-button" type="button" data-ccs-daily-edit="${attr(item.filename)}" title="编辑" aria-label="编辑 ${attr(item.filename)}">${icon("pencil")}</button><button class="icon-button" type="button" data-ccs-daily-delete="${attr(item.filename)}" title="删除" aria-label="删除 ${attr(item.filename)}">${icon("trash-2")}</button></span></div>`).join("") || `<p class="subtle">暂无 Daily Memory</p>`}</div></section></div>`;
  }

  function backupsMarkup() {
    return `<section class="ccs-tool"><div class="ccs-tool-heading"><h3>完整备份</h3><form data-ccs-form="backup" class="ccs-inline-form"><input name="name" maxlength="80" placeholder="备份名称"><button class="button primary" type="submit">${icon("archive")}创建</button></form></div><div class="ccs-list" data-ccs-backup-list><p class="subtle">正在读取备份…</p></div></section>`;
  }

  function deeplinkMarkup() {
    const preview = state.deeplink;
    return `<section class="ccs-tool"><div class="ccs-tool-heading"><h3>统一深链</h3><span>${preview?.resource ? escapeHtml(preview.resource) : "未解析"}</span></div><form data-ccs-form="deeplink"><label class="field"><span class="field-label">ccswitch://v1/import</span><textarea name="url" rows="5" spellcheck="false" required>${escapeHtml(preview?.url || "")}</textarea></label><div class="ccs-code-preview">${preview?.preview ? `<pre>${escapeHtml(json(preview.preview))}</pre>` : `<span class="subtle">等待预览</span>`}</div><div class="ccs-actions"><button class="button secondary" type="button" data-ccs-action="deeplink-preview"${state.deeplinkLoading ? " disabled aria-busy=\"true\"" : ""}>${icon("scan-search")}${state.deeplinkLoading ? "解析中" : "预览"}</button><button class="button primary" type="submit"${preview?.preview ? "" : " disabled"}>${icon("download")}导入</button></div></form></section>`;
  }

  async function previewDeeplink(url) {
    const normalizedUrl = String(url ?? "").trim();
    state.deeplink = { url: normalizedUrl, resource: null, preview: null };
    state.deeplinkLoading = true;
    render();
    try {
      const parsed = await request("/api/ccswitch/domain/deeplink/parse", { method: "POST", body: { url: normalizedUrl } });
      state.deeplink = { url: normalizedUrl, resource: parsed.resource, preview: parsed.preview };
      message("深链预览已生成");
      return state.deeplink;
    } catch (error) {
      message(error?.message ?? String(error), "error");
      throw error;
    } finally {
      state.deeplinkLoading = false;
      render();
    }
  }

  function syncMarkup() {
    const domain = state.domain ?? {};
    const webdav = domain.settings?.webdav ?? {};
    const s3 = domain.settings?.s3 ?? {};
    const stream = domain.settings?.streamCheck ?? {};
    return `<div class="ccs-two-col"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>WebDAV</h3><span class="status-label ${webdav.status?.lastError ? "is-error" : webdav.status?.lastSuccessAt ? "is-ok" : "is-neutral"}">${webdav.status?.lastError ? "错误" : webdav.status?.lastSuccessAt ? "已同步" : "未同步"}</span></div><form data-ccs-form="webdav"><label class="ccs-check inline"><input name="enabled" type="checkbox"${checked(webdav.enabled)}><span>启用</span></label><label class="field"><span class="field-label">Base URL</span><input name="baseUrl" type="url" value="${attr(webdav.baseUrl)}" required></label><div class="ccs-form-grid"><label class="field"><span class="field-label">用户名</span><input name="username" value="${attr(webdav.username)}"></label><label class="field"><span class="field-label">密码</span><input name="password" type="password" placeholder="${attr(webdav.passwordMasked || "留空保持")}"></label></div><label class="field"><span class="field-label">远端路径</span><input name="remotePath" value="${attr(webdav.remotePath || "ccswitch/backup.json")}" required></label><div class="ccs-actions"><button class="button secondary" type="submit">${icon("save")}保存</button><button class="button secondary" type="button" data-ccs-sync="webdav|test">${icon("plug-zap")}测试</button><button class="button secondary" type="button" data-ccs-sync="webdav|upload">${icon("cloud-upload")}上传</button><button class="button secondary" type="button" data-ccs-sync="webdav|download">${icon("cloud-download")}下载</button></div></form></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>S3</h3><span class="status-label ${s3.status?.lastError ? "is-error" : s3.status?.lastSuccessAt ? "is-ok" : "is-neutral"}">${s3.status?.lastError ? "错误" : s3.status?.lastSuccessAt ? "已同步" : "未同步"}</span></div><form data-ccs-form="s3"><label class="ccs-check inline"><input name="enabled" type="checkbox"${checked(s3.enabled)}><span>启用</span></label><label class="field"><span class="field-label">Endpoint</span><input name="endpoint" type="url" value="${attr(s3.endpoint)}" placeholder="AWS 默认可留空"></label><div class="ccs-form-grid"><label class="field"><span class="field-label">Region</span><input name="region" value="${attr(s3.region || "us-east-1")}" required></label><label class="field"><span class="field-label">Bucket</span><input name="bucket" value="${attr(s3.bucket)}" required></label><label class="field"><span class="field-label">Access Key ID</span><input name="accessKeyId" value="${attr(s3.accessKeyId)}" required></label><label class="field"><span class="field-label">Secret Access Key</span><input name="secretAccessKey" type="password" placeholder="${attr(s3.secretAccessKeyMasked || "留空保持")}"></label></div><label class="field"><span class="field-label">Object Key</span><input name="key" value="${attr(s3.key || "ccswitch/backup.json")}" required></label><label class="ccs-check inline"><input name="forcePathStyle" type="checkbox"${checked(s3.forcePathStyle)}><span>Path-style</span></label><div class="ccs-actions"><button class="button secondary" type="submit">${icon("save")}保存</button><button class="button secondary" type="button" data-ccs-sync="s3|test">${icon("plug-zap")}测试</button><button class="button secondary" type="button" data-ccs-sync="s3|upload">${icon("cloud-upload")}上传</button><button class="button secondary" type="button" data-ccs-sync="s3|download">${icon("cloud-download")}下载</button></div></form></section></div>
      <div class="ccs-two-col"><section class="ccs-tool"><div class="ccs-tool-heading"><h3>Stream Check</h3><span>${state.streamResults.length}</span></div><form data-ccs-form="stream" class="ccs-stream-form"><label class="field"><span class="field-label">超时 ms</span><input name="timeoutMs" type="number" min="500" max="120000" value="${Number(stream.timeoutMs || 10000)}"></label><label class="field"><span class="field-label">降级阈值 ms</span><input name="degradedMs" type="number" min="1" max="120000" value="${Number(stream.degradedMs || 3000)}"></label><label class="field"><span class="field-label">并发数</span><input name="concurrency" type="number" min="1" max="16" value="${Number(stream.concurrency || 4)}"></label><div class="ccs-stream-actions"><button class="button secondary" type="submit">${icon("save")}保存</button><button class="button primary" type="button" data-ccs-action="stream-check">${icon("activity")}检查全部</button></div></form><div class="ccs-list compact">${state.streamResults.map((item) => `<div><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.message || `${item.responseTimeMs || 0}ms`)}</small></span><span class="status-label ${item.status === "healthy" ? "is-ok" : item.status === "degraded" ? "is-warning" : "is-error"}">${escapeHtml(item.status)}</span></div>`).join("") || `<p class="subtle">暂无结果</p>`}</div></section>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>环境冲突</h3><button class="button compact secondary" type="button" data-ccs-action="env-check">${icon("shield-check")}检查</button></div><div class="ccs-list compact">${(state.env?.conflicts ?? []).map((item) => `<label class="ccs-env-row"><input type="checkbox" data-env-name="${attr(item.name || item.key)}" data-env-scope="${attr(item.scope || "Process")}"><span><strong>${escapeHtml(item.name || item.key)}</strong><small>${escapeHtml(`${APP_LABELS[item.app] || item.app || ""} · ${item.scope || "Process"}`)}</small></span><code>${escapeHtml(item.valueMasked || "••••")}</code></label>`).join("") || `<p class="subtle">未发现冲突</p>`}</div><button class="button danger" type="button" data-ccs-action="env-delete"${state.env?.conflicts?.length ? "" : " disabled"}>${icon("trash-2")}删除所选并备份</button></section></div>
      <section class="ccs-tool"><div class="ccs-tool-heading"><h3>配置目录</h3><button class="button compact secondary" type="button" data-ccs-action="sync-live">${icon("refresh-cw")}重写 live</button></div><div class="ccs-path-grid">${PROVIDER_SCHEME_APPS.map((app) => `<form data-ccs-config-dir="${app}"><label><span>${APP_LABELS[app]}</span><input name="path" value="${attr(domain.settings?.configDirs?.[app] || "")}" placeholder="${attr(state.configPaths[app] || "默认路径")}"></label><button class="icon-button" type="submit" title="保存目录" aria-label="保存 ${APP_LABELS[app]} 配置目录">${icon("save")}</button></form>`).join("")}</div></section>`;
  }

  function accountsMarkup() {
    const providers = state.auth?.providers ?? [];
    return `<div class="ccs-account-grid">${providers.map((entry) => { const flow = state.authFlows[entry.provider]; const resource = state.authResource[entry.provider]; return `<section class="ccs-tool"><div class="ccs-tool-heading"><h3>${AUTH_LABELS[entry.provider]}</h3><span class="status-label ${entry.authenticated ? "is-ok" : "is-neutral"}">${entry.authenticated ? `${entry.accounts.length} 个账户` : "未登录"}</span></div>${flow ? `<div class="ccs-device-flow"><strong class="mono">${escapeHtml(flow.userCode)}</strong><a class="button secondary" href="${attr(flow.verificationUri)}" target="_blank" rel="noopener">${icon("external-link")}打开验证页</a><button class="button primary" type="button" data-ccs-auth-poll="${entry.provider}">${icon("refresh-cw")}检查授权</button></div>` : `<button class="button primary" type="button" data-ccs-auth-start="${entry.provider}">${icon("log-in")}开始设备登录</button>`}<div class="ccs-list compact">${entry.accounts.map((account) => `<div><span><strong>${escapeHtml(account.login)}</strong><small>${account.isDefault ? "默认" : formatDate(account.authenticatedAt)}</small></span><span class="ccs-row-actions">${account.isDefault ? "" : `<button class="icon-button" type="button" data-ccs-auth-default="${entry.provider}|${attr(account.id)}" title="设为默认" aria-label="设为默认账户">${icon("star")}</button>`}<button class="icon-button" type="button" data-ccs-auth-remove="${entry.provider}|${attr(account.id)}" title="移除账户" aria-label="移除账户">${icon("user-minus")}</button></span></div>`).join("") || `<p class="subtle">暂无账户</p>`}</div><div class="ccs-actions"><button class="button secondary" type="button" data-ccs-auth-resource="${entry.provider}|models"${entry.authenticated ? "" : " disabled"}>${icon("boxes")}模型</button><button class="button secondary" type="button" data-ccs-auth-resource="${entry.provider}|quota"${entry.authenticated ? "" : " disabled"}>${icon("gauge")}额度</button><button class="button danger" type="button" data-ccs-auth-logout="${entry.provider}"${entry.authenticated ? "" : " disabled"}>${icon("log-out")}注销</button></div>${resource ? `<pre class="ccs-resource-output">${escapeHtml(json(resource))}</pre>` : ""}</section>`; }).join("") || `<section class="ccs-tool"><p class="subtle">账户服务不可用</p></section>`}</div>`;
  }

  async function refreshWorkspace() {
    const [workspace, file, hermes] = await Promise.all([
      request("/api/ccswitch/domain/workspace").then((item) => item.workspace),
      request(`/api/ccswitch/domain/workspace/openclaw/files/${encodeURIComponent(state.workspaceFile)}`).then((item) => item.item),
      request(`/api/ccswitch/domain/workspace/hermes/${state.hermesKind}`).then((item) => item.item),
    ]);
    state.workspace = workspace;
    state.workspaceContent = file.content ?? "";
    state.hermesContent = hermes.content ?? "";
    render();
  }

  async function refreshBackups() {
    const response = await request("/api/ccswitch/domain/backups");
    const list = root.querySelector("[data-ccs-backup-list]");
    if (list) list.innerHTML = response.items.map((item) => `<div><span><strong>${escapeHtml(item.filename)}</strong><small>${formatDate(item.modifiedAt)} · ${Math.ceil(item.size / 1024)} KiB</small></span><span class="ccs-row-actions"><button class="button compact secondary" type="button" data-ccs-backup-restore="${attr(item.filename)}">${icon("rotate-ccw")}恢复</button><button class="icon-button" type="button" data-ccs-backup-delete="${attr(item.filename)}" title="删除备份" aria-label="删除 ${attr(item.filename)}">${icon("trash-2")}</button></span></div>`).join("") || `<p class="subtle">暂无备份</p>`;
  }

  function fillPrompt(id) {
    const item = state.domain?.prompts?.[state.promptApp]?.[id]; const form = root.querySelector('[data-ccs-form="prompt"]'); if (!item || !form) return;
    form.elements.id.value = item.id; form.elements.name.value = item.name; form.elements.description.value = item.description || ""; form.elements.content.value = item.content || ""; form.elements.enabled.checked = Boolean(item.enabled); form.elements.name.focus();
  }
  function fillMcp(id) {
    const item = state.domain?.mcps?.[id]; const form = root.querySelector('[data-ccs-form="mcp"]'); if (!item || !form) return;
    form.elements.id.value = item.id; form.elements.name.value = item.name; form.elements.config.value = json(item.config); for (const app of PROVIDER_SCHEME_APPS) form.elements.namedItem(`mcp-${app}`).checked = Boolean(item.apps?.[app]); form.elements.name.focus();
  }

  async function act(task, success) {
    if (state.busy) return null; state.busy = true;
    try { const result = await task(); if (success) message(success); await load(); return result; }
    catch (error) { message(error.message || String(error), "error"); throw error; }
    finally { state.busy = false; }
  }

  // ---- 本地 CLI 环境（「环境」tab：CC Switch 式版本对照 + 确认制安装/升级）----
  function cliEnvPlatformBadge() {
    const platform = state.cliEnv?.platform;
    return CLI_ENV_PLATFORM_BADGES[platform] ?? (platform ? String(platform) : "本机");
  }

  function cliEnvLogo(tool) {
    const branded = tool.brand ? brandIcon(tool.brand, "cli-logo ccs-cli-logo-svg") : "";
    // opencode/openclaw/hermes 无官方 sprite（LO 铁律不臆造品牌），统一落 lucide terminal
    return branded || icon("terminal");
  }

  function cliEnvCardMarkup(tool) {
    const meta = CLI_ENV_STATUS[tool.status] ?? CLI_ENV_STATUS.installed;
    const busy = Boolean(state.cliEnvBusy[tool.id]);
    const errors = [tool.probeError, tool.latestError ? `最新版本查询失败：${tool.latestError}` : null].filter(Boolean);
    const needsInstall = tool.status === "not-installed" || tool.status === "upgrade-available" || tool.status === "broken";
    const action = busy
      ? `<button class="button secondary ccs-cli-busy" type="button" disabled>${icon("loader-circle")}<span>处理中</span><span class="ccs-cli-busy-dots" aria-hidden="true"><i></i><i></i><i></i></span></button>`
      : needsInstall && !tool.install
        // 平台无官方一键安装路径（Cursor on win32）：如实呈现说明，不出假按钮
        ? `<span class="subtle ccs-cli-note">${escapeHtml(tool.installNote ?? "本平台暂不支持一键安装")}</span>`
        : tool.status === "not-installed"
          ? `<button class="button primary" type="button" data-ccs-cli-install="${attr(tool.id)}">${icon("download")}安装</button>`
          : tool.status === "upgrade-available"
            ? `<button class="button primary" type="button" data-ccs-cli-install="${attr(tool.id)}">${icon("upload")}升级</button>`
            : tool.status === "broken"
              ? `<button class="button secondary" type="button" data-ccs-cli-install="${attr(tool.id)}">${icon("wrench")}重装修复</button>`
              : `<span class="subtle">${tool.status === "up-to-date" ? "已就绪" : "已安装"}</span>`;
    return `<section class="ccs-cli-card" data-ccs-cli-card="${attr(tool.id)}"><div class="ccs-cli-card-head"><span class="ccs-cli-logo">${cliEnvLogo(tool)}</span><div class="ccs-cli-title"><strong>${escapeHtml(tool.label)}</strong><span class="ccs-cli-platform">${escapeHtml(cliEnvPlatformBadge())}</span></div><span class="status-label ${meta.tone}">${meta.label}</span></div><dl class="ccs-cli-versions"><div><dt>当前版本</dt><dd class="mono">${escapeHtml(tool.currentVersion ?? "未安装")}</dd></div><div><dt>最新版本</dt><dd class="mono">${escapeHtml(tool.latestVersion ?? "—")}</dd></div></dl>${errors.length ? `<p class="ccs-cli-error">${escapeHtml(errors.join("；"))}</p>` : ""}<div class="ccs-cli-card-foot"><code class="ccs-cli-pkg" title="${attr(tool.install?.display ?? tool.installNote ?? tool.packageName)}">${escapeHtml(tool.packageName)}</code>${action}</div></section>`;
  }

  function cliEnvMarkup() {
    const tools = state.cliEnv?.tools ?? [];
    const upgradable = tools.filter((tool) => tool.status === "upgrade-available" && tool.install);
    const busyAny = Object.keys(state.cliEnvBusy).length > 0;
    const head = `<div class="ccs-cli-head"><div><h3>本地 CLI 环境</h3><p class="subtle">对照 registry 检查本机 CLI 后端版本，可一键安装/升级。${state.cliEnv?.generatedAt ? `上次检查 ${formatDate(state.cliEnv.generatedAt)}` : ""}</p></div><div class="ccs-cli-head-actions"><button class="button secondary${state.cliEnvLoading ? " ccs-cli-busy" : ""}" type="button" data-ccs-action="clienv-refresh"${state.cliEnvLoading ? " disabled" : ""}>${icon(state.cliEnvLoading ? "loader-circle" : "refresh-cw")}${state.cliEnvLoading ? "检查中…" : "刷新"}</button><button class="button primary${busyAny ? " ccs-cli-busy" : ""}" type="button" data-ccs-action="clienv-upgrade-all"${upgradable.length && !busyAny ? "" : " disabled"}>${icon(busyAny ? "loader-circle" : "upload")}全部升级${upgradable.length ? ` (${upgradable.length})` : ""}</button></div></div>`;
    if (state.cliEnvError && !tools.length) return `${head}<section class="ccs-tool"><p class="subtle">环境检查失败：${escapeHtml(state.cliEnvError)}</p></section>`;
    if (!tools.length) return `${head}<section class="ccs-tool"><p class="subtle">${state.cliEnvLoading ? "正在探测本机 CLI 与 registry 最新版本…" : "点击「刷新」开始环境检查。"}</p></section>`;
    const cards = `<div class="ccs-cli-grid">${tools.map((tool) => cliEnvCardMarkup(tool)).join("")}</div>`;
    const manual = `<details class="ccs-cli-manual"><summary>${icon("terminal")}<span>手动安装命令</span></summary><div class="ccs-cli-manual-body">${tools.map((tool) => `<div class="ccs-cli-cmd"><span># ${escapeHtml(tool.label)}</span><code>${escapeHtml(tool.install?.display ?? tool.installNote ?? "—")}</code>${tool.install ? `<button class="icon-button" type="button" data-ccs-cli-copy="${attr(tool.id)}" title="复制 ${attr(tool.label)} 安装命令" aria-label="复制 ${attr(tool.label)} 安装命令">${icon("copy")}</button>` : ""}</div>`).join("")}</div></details>`;
    return `${head}${cards}${manual}`;
  }

  async function loadCliEnv(refresh = false) {
    if (state.cliEnvLoading) return null;
    state.cliEnvLoading = true;
    if (state.tab === "env") render();
    try {
      state.cliEnv = await request(`/api/cli-environment${refresh ? "?refresh=1" : ""}`);
      state.cliEnvError = null;
    } catch (error) {
      state.cliEnvError = error?.message ?? String(error);
    } finally {
      state.cliEnvLoading = false;
      if (state.tab === "env") render();
    }
    return state.cliEnv;
  }

  function mergeCliEnvTool(view) {
    if (!view || !state.cliEnv) return;
    state.cliEnv = {
      ...state.cliEnv,
      tools: state.cliEnv.tools.map((item) => (item.id === view.id ? view : item)),
      generatedAt: new Date().toISOString(),
    };
  }

  async function installCliTool(id) {
    const tool = (state.cliEnv?.tools ?? []).find((item) => item.id === id);
    if (!tool || !tool.install || state.cliEnvBusy[id]) return;
    const isInstall = tool.status === "not-installed";
    const confirmed = await confirmDialog({
      eyebrow: isInstall ? "安装 CLI" : tool.status === "broken" ? "修复 CLI" : "升级 CLI",
      title: `${tool.label} → ${tool.latestVersion ?? "最新版本"}`,
      rows: [["命令", tool.install.display], ["来源", tool.installSource ?? (tool.registry === "pypi" ? "PyPI" : tool.registry === "script" ? "官方安装脚本" : "npm registry")]],
      warning: "将执行上方命令并写入本机 CLI 安装目录或全局环境，可能需要数分钟。",
      confirmLabel: isInstall ? "安装" : "升级",
      danger: true,
    });
    if (!confirmed) return;
    state.cliEnvBusy = { ...state.cliEnvBusy, [id]: true };
    render();
    try {
      const result = await request("/api/cli-environment/install", { method: "POST", body: { id, confirmed: true } });
      mergeCliEnvTool(result?.tool);
      message(`${tool.label} 已更新${result?.tool?.currentVersion ? `到 ${result.tool.currentVersion}` : "完成"}`);
    } catch (error) {
      message(`${tool.label} 操作失败：${cliEnvFailureDetail(error)}`, "error");
    } finally {
      const nextBusy = { ...state.cliEnvBusy };
      delete nextBusy[id];
      state.cliEnvBusy = nextBusy;
      render();
    }
  }

  async function upgradeAllCliTools() {
    const tools = (state.cliEnv?.tools ?? []).filter((item) => item.status === "upgrade-available" && item.install);
    if (!tools.length || Object.keys(state.cliEnvBusy).length) return;
    const confirmed = await confirmDialog({
      eyebrow: "批量升级 CLI",
      title: `升级 ${tools.length} 个 CLI 到最新版本`,
      rows: tools.map((tool) => [tool.label, tool.install.display]),
      warning: "将依次执行以上命令并写入本机 CLI 安装目录或全局环境，全程可能需要较长时间。",
      confirmLabel: "全部升级",
      danger: true,
    });
    if (!confirmed) return;
    const failures = [];
    for (const tool of tools) {
      state.cliEnvBusy = { ...state.cliEnvBusy, [tool.id]: true };
      render();
      try {
        const result = await request("/api/cli-environment/install", { method: "POST", body: { id: tool.id, confirmed: true } });
        mergeCliEnvTool(result?.tool);
      } catch (error) {
        failures.push(`${tool.label}（${cliEnvFailureDetail(error)}）`);
      } finally {
        const nextBusy = { ...state.cliEnvBusy };
        delete nextBusy[tool.id];
        state.cliEnvBusy = nextBusy;
        render();
      }
    }
    message(failures.length ? `批量升级完成，失败：${failures.join("、")}` : `全部升级完成（${tools.length} 个）`, failures.length ? "warning" : "success");
  }

  async function handleSubmit(event) {
    const form = event.target.closest("form"); if (!form || !root.contains(form)) return; event.preventDefault(); const kind = form.dataset.ccsForm;
    try {
      if (kind === "proxy") await act(() => request("/api/ccswitch/proxy/config", { method: "PUT", body: { listenAddress: form.elements.listenAddress.value, listenPort: Number(form.elements.listenPort.value), circuitBreaker: { failureThreshold: Number(form.elements.failureThreshold.value), cooldownMs: Number(form.elements.cooldownMs.value) } } }), "代理配置已保存");
      else if (kind === "upstream-proxy") await act(() => request("/api/ccswitch/proxy/upstream", { method: "PUT", body: { url: form.elements.url.value } }), "出站代理已应用");
      else if (kind === "pricing") { const model = form.elements.model.value.trim(); await act(() => request(`/api/ccswitch/proxy/pricing/${encodeURIComponent(model)}`, { method: "PUT", body: { inputPerMillion: Number(form.elements.inputPerMillion.value), outputPerMillion: Number(form.elements.outputPerMillion.value) } }), "定价已保存"); }
      else if (kind === "prompt") await act(() => request("/api/ccswitch/domain/prompts", { method: "POST", body: { app: state.promptApp, id: form.elements.id.value || undefined, name: form.elements.name.value, description: form.elements.description.value, content: form.elements.content.value, enabled: form.elements.enabled.checked } }), "Prompt 已保存");
      else if (kind === "mcp") await act(() => request("/api/ccswitch/domain/mcps", { method: "POST", body: { id: form.elements.id.value, name: form.elements.name.value, config: parseJson(form.elements.config.value, "MCP 配置"), apps: formApps(form, "mcp") } }), "MCP 已保存");
      else if (kind === "skill") { const name = form.elements.name.value.trim(); await act(() => request("/api/ccswitch/domain/skills", { method: "POST", body: { name, description: form.elements.description.value, files: { "SKILL.md": form.elements.skillMd.value }, apps: formApps(form, "skill", PROMPT_APPS) } }), "Skill 已安装"); }
      else if (kind === "profile") await act(() => request("/api/ccswitch/domain/profiles", { method: "POST", body: { name: form.elements.name.value, description: form.elements.description.value, apps: Object.entries(formApps(form, "profile")).filter(([, enabled]) => enabled).map(([app]) => app) } }), "Profile 已创建");
      else if (kind === "workspace-file") { state.workspaceFile = form.elements.filename.value; state.workspaceContent = form.elements.content.value; await act(() => request(`/api/ccswitch/domain/workspace/openclaw/files/${encodeURIComponent(state.workspaceFile)}`, { method: "PUT", body: { content: state.workspaceContent } }), "Workspace 文件已保存"); await refreshWorkspace(); }
      else if (kind === "daily-memory") { state.dailyFilename = form.elements.filename.value; state.dailyContent = form.elements.content.value; await act(() => request(`/api/ccswitch/domain/workspace/openclaw/daily/${encodeURIComponent(state.dailyFilename)}`, { method: "PUT", body: { content: state.dailyContent } }), "Daily Memory 已保存"); state.workspaceSearch = []; await refreshWorkspace(); }
      else if (kind === "daily-search") { state.workspaceSearch = await request("/api/ccswitch/domain/workspace/openclaw/daily/search", { method: "POST", body: { query: form.elements.query.value } }).then((item) => item.items ?? []); render(); message(`找到 ${state.workspaceSearch.length} 条 Daily Memory`); }
      else if (kind === "hermes-memory") { state.hermesKind = form.elements.kind.value; state.hermesContent = form.elements.content.value; await act(async () => { await request(`/api/ccswitch/domain/workspace/hermes/${state.hermesKind}`, { method: "PUT", body: { content: state.hermesContent } }); return request(`/api/ccswitch/domain/workspace/hermes/${state.hermesKind}/enabled`, { method: "PUT", body: { enabled: form.elements.enabled.checked } }); }, "Hermes Memory 已保存"); await refreshWorkspace(); }
      else if (kind === "backup") await act(() => request("/api/ccswitch/domain/backups", { method: "POST", body: { name: form.elements.name.value } }), "备份已创建");
      else if (kind === "deeplink") { const url = form.elements.url.value.trim(); if (!state.deeplink?.preview || state.deeplink.url !== url) throw new Error("链接已变化，请重新预览"); const confirmed = state.deeplink.resource === "skill" ? await askConfirm({ eyebrow: "深链接导入", title: "从远程仓库安装这个 Skill？", rows: [["来源", url]], warning: "远程 Skill 会写入本机 Skill 目录并投影到各应用 live 副本——只安装可信来源。", confirmLabel: "安装", danger: true }) : true; if (confirmed) { await act(() => request("/api/ccswitch/domain/deeplink/import", { method: "POST", body: { url, confirmed } }), `${state.deeplink.resource} 已导入`); state.deeplink = null; } }
      else if (kind === "webdav") await act(() => request("/api/ccswitch/domain/sync/webdav/settings", { method: "PUT", body: { enabled: form.elements.enabled.checked, baseUrl: form.elements.baseUrl.value, username: form.elements.username.value, password: form.elements.password.value, passwordTouched: Boolean(form.elements.password.value), remotePath: form.elements.remotePath.value } }), "WebDAV 已保存");
      else if (kind === "s3") await act(() => request("/api/ccswitch/domain/sync/s3/settings", { method: "PUT", body: { enabled: form.elements.enabled.checked, endpoint: form.elements.endpoint.value, region: form.elements.region.value, bucket: form.elements.bucket.value, accessKeyId: form.elements.accessKeyId.value, secretAccessKey: form.elements.secretAccessKey.value, secretTouched: Boolean(form.elements.secretAccessKey.value), key: form.elements.key.value, forcePathStyle: form.elements.forcePathStyle.checked } }), "S3 已保存");
      else if (kind === "stream") await act(() => request("/api/ccswitch/domain/stream/config", { method: "PUT", body: { timeoutMs: Number(form.elements.timeoutMs.value), degradedMs: Number(form.elements.degradedMs.value), concurrency: Number(form.elements.concurrency.value) } }), "Stream Check 已保存");
      else if (form.dataset.ccsConfigDir) { const app = form.dataset.ccsConfigDir; await act(() => request(`/api/ccswitch/domain/config-dirs/${encodeURIComponent(app)}`, { method: "PUT", body: { path: form.elements.path.value } }), `${APP_LABELS[app]} 目录已保存`); }
    } catch (error) { if (!state.busy) message(error.message || String(error), "error"); }
  }

  async function handleChange(event) {
    const target = event.target;
    if (target.matches("[data-ccs-prompt-app]")) { state.promptApp = target.value; render(); return; }
    if (target.closest('[data-ccs-form="workspace-file"]') && target.name === "filename") { state.workspaceFile = target.value; try { state.workspaceContent = await request(`/api/ccswitch/domain/workspace/openclaw/files/${encodeURIComponent(state.workspaceFile)}`).then((item) => item.item.content ?? ""); render(); } catch (error) { message(error.message, "error"); } return; }
    if (target.closest('[data-ccs-form="hermes-memory"]') && target.name === "kind") { state.hermesKind = target.value; try { state.hermesContent = await request(`/api/ccswitch/domain/workspace/hermes/${state.hermesKind}`).then((item) => item.item.content ?? ""); render(); } catch (error) { message(error.message, "error"); } return; }
    if (target.matches("[data-ccs-native-autolaunch]")) {
      try { state.native.autoLaunch = Boolean(await window.__TAURI_INTERNALS__.invoke("set_auto_launch", { enabled: target.checked })); await window.__TAURI_INTERNALS__.invoke("update_tray_menu"); render(); message("开机自启状态已更新"); }
      catch (error) { target.checked = state.native.autoLaunch; message(error.message || String(error), "error"); }
      return;
    }
    if (target.matches("[data-ccs-takeover]")) { await act(() => request(`/api/ccswitch/proxy/takeover/${encodeURIComponent(target.dataset.ccsTakeover)}`, { method: "PUT", body: { enabled: target.checked } }), `${APP_LABELS[target.dataset.ccsTakeover]} 接管已更新`).catch(() => {}); return; }
    const toggle = target.dataset.ccsMcpToggle || target.dataset.ccsSkillToggle;
    if (toggle) { const kind = target.dataset.ccsMcpToggle ? "mcp" : "skill"; const [id, app] = toggle.split("|"); await act(() => request(`/api/ccswitch/domain/${kind}s/${encodeURIComponent(id)}/apps/${encodeURIComponent(app)}`, { method: "PUT", body: { enabled: target.checked } }), `${kind.toUpperCase()} 应用状态已更新`).catch(() => {}); }
  }

  async function handleClick(event) {
    const button = event.target.closest("button, a"); if (!button || !root.contains(button)) return;
    if (button.dataset.ccsTab) { state.tab = button.dataset.ccsTab; render(); if (state.tab === "env" && !state.cliEnv && !state.cliEnvLoading && !state.cliEnvError) void loadCliEnv(); return; }
    if (button.dataset.ccsResourceTab) { state.resourceTab = button.dataset.ccsResourceTab; render(); if (state.resourceTab === "backups") void refreshBackups(); if (state.resourceTab === "workspace") void refreshWorkspace().catch((error) => message(error.message, "error")); return; }
    const action = button.dataset.ccsAction;
    if (action === "refresh") { const result = await load(); message(result.ok ? "已刷新" : `刷新未完全成功：${result.errors.length} 项加载失败`, result.ok ? "success" : "warning"); return; }
    if (action === "clienv-refresh") { await loadCliEnv(true); message(state.cliEnvError ? `环境检查失败：${state.cliEnvError}` : "环境检查已完成", state.cliEnvError ? "error" : "success"); return; }
    if (action === "clienv-upgrade-all") { await upgradeAllCliTools(); return; }
    if (button.dataset.ccsCliInstall) { await installCliTool(button.dataset.ccsCliInstall); return; }
    if (button.dataset.ccsCliCopy) { const tool = (state.cliEnv?.tools ?? []).find((item) => item.id === button.dataset.ccsCliCopy); if (tool?.install) { try { await navigator.clipboard.writeText(tool.install.display); message(`${tool.label} 操作命令已复制`); } catch { message("剪贴板不可用，请手动复制", "warning"); } } return; }
    if (action === "proxy-start") { const form = root.querySelector('[data-ccs-form="proxy"]'); await act(() => request("/api/ccswitch/proxy/start", { method: "POST", body: { listenAddress: form.elements.listenAddress.value, listenPort: Number(form.elements.listenPort.value), circuitBreaker: { failureThreshold: Number(form.elements.failureThreshold.value), cooldownMs: Number(form.elements.cooldownMs.value) } } }), "本地代理已启动").catch(() => {}); return; }
    if (action === "proxy-stop") { await act(() => request("/api/ccswitch/proxy/stop", { method: "POST", body: { restore: true } }), "本地代理已停止，live 配置已恢复").catch(() => {}); return; }
    if (action === "upstream-test") { const url = root.querySelector('[data-ccs-form="upstream-proxy"]')?.elements.url.value.trim(); if (!url) { message("请输入要测试的出站代理 URL", "warning"); return; } try { const result = await request("/api/ccswitch/proxy/upstream/test", { method: "POST", body: { url } }).then((item) => item.result); message(result.success ? `代理可用 · ${result.latencyMs}ms · HTTP ${result.status}` : `代理不可用 · ${result.error}`, result.success ? "success" : "error"); } catch (error) { message(error.message, "error"); } return; }
    if (action === "upstream-scan") { try { state.upstreamScan = await request("/api/ccswitch/proxy/upstream/scan").then((item) => item.items ?? []); render(); message(`发现 ${state.upstreamScan.length} 个代理候选`); } catch (error) { message(error.message, "error"); } return; }
    if (action === "upstream-clear") { if (await askConfirm({ eyebrow: "出站代理", title: "清除全局出站代理并恢复直连？", rows: [["影响", "所有经本地代理的请求改为直连"]], warning: "清除后需要重新填写并测试才能恢复代理链路。", confirmLabel: "恢复直连" })) await act(() => request("/api/ccswitch/proxy/upstream", { method: "PUT", body: { clear: true } }), "已恢复直连").catch(() => {}); return; }
    if (button.dataset.ccsUpstreamPick) { const form = root.querySelector('[data-ccs-form="upstream-proxy"]'); if (form) { form.elements.url.value = button.dataset.ccsUpstreamPick; form.elements.url.focus(); } return; }
    if (action === "workspace-reveal") { try { await request("/api/system/reveal", { method: "POST", body: { path: state.workspace?.openclaw?.root } }); message("Workspace 已在资源管理器打开"); } catch (error) { message(error.message, "error"); } return; }
    if (action === "daily-new") { state.dailyFilename = new Date().toISOString().slice(0, 10) + ".md"; state.dailyContent = ""; state.workspaceSearch = []; render(); return; }
    if (button.dataset.ccsDailyEdit) { try { const item = await request(`/api/ccswitch/domain/workspace/openclaw/daily/${encodeURIComponent(button.dataset.ccsDailyEdit)}`).then((response) => response.item); state.dailyFilename = item.filename; state.dailyContent = item.content ?? ""; render(); root.querySelector('[data-ccs-form="daily-memory"] textarea')?.focus(); } catch (error) { message(error.message, "error"); } return; }
    if (button.dataset.ccsDailyDelete) { if (await askConfirm({ eyebrow: "Daily Memory", title: `删除 ${button.dataset.ccsDailyDelete}？`, rows: [["影响", "文件移出 workspace，服务端保留一份备份"]], confirmLabel: "删除", danger: true })) { await act(() => request(`/api/ccswitch/domain/workspace/openclaw/daily/${encodeURIComponent(button.dataset.ccsDailyDelete)}`, { method: "DELETE", body: { confirmed: true } }), "Daily Memory 已删除").catch(() => {}); state.dailyContent = ""; state.workspaceSearch = []; await refreshWorkspace().catch(() => {}); } return; }
    if (action === "native-lightweight") {
      try { state.native.lightweight = Boolean(await window.__TAURI_INTERNALS__.invoke(state.native.lightweight ? "exit_lightweight_mode" : "enter_lightweight_mode")); render(); message(state.native.lightweight ? "已进入轻量模式" : "已退出轻量模式"); }
      catch (error) { message(error.message || String(error), "error"); }
      return;
    }
    if (action === "native-restart") { if (await askConfirm({ eyebrow: "桌面端", title: "重启 514cc Console？", rows: [["影响", "窗口会关闭并重新拉起内核；进行中的会话按恢复流程接续"]], confirmLabel: "重启", danger: true })) { try { await window.__TAURI_INTERNALS__.invoke("restart_app"); message("正在重启桌面端"); } catch (error) { message(error.message || String(error), "error"); } } return; }
    if (button.dataset.ccsResetBreaker) { const [app, id] = button.dataset.ccsResetBreaker.split("|"); await act(() => request(`/api/ccswitch/proxy/breaker/${encodeURIComponent(app)}/${encodeURIComponent(id)}/reset`, { method: "POST", body: {} }), "熔断器已重置").catch(() => {}); return; }
    if (button.dataset.ccsPriceDelete) { await act(() => request(`/api/ccswitch/proxy/pricing/${encodeURIComponent(button.dataset.ccsPriceDelete)}`, { method: "DELETE" }), "定价已删除").catch(() => {}); return; }
    if (button.dataset.ccsPromptEdit) { fillPrompt(button.dataset.ccsPromptEdit); return; }
    if (action === "prompt-clear") { root.querySelector('[data-ccs-form="prompt"]').reset(); return; }
    if (button.dataset.ccsPromptEnable || button.dataset.ccsPromptDisable) { const id = button.dataset.ccsPromptEnable || button.dataset.ccsPromptDisable; const verb = button.dataset.ccsPromptEnable ? "enable" : "disable"; await act(() => request(`/api/ccswitch/domain/prompts/${state.promptApp}/${encodeURIComponent(id)}/${verb}`, { method: "POST", body: {} }), `Prompt 已${verb === "enable" ? "启用" : "停用"}`).catch(() => {}); return; }
    if (button.dataset.ccsPromptDelete) { if (await askConfirm({ eyebrow: "Prompt", title: "删除这条 Prompt？", rows: [["范围", APP_LABELS[state.promptApp] ?? state.promptApp]], warning: "删除后无法恢复。", confirmLabel: "删除", danger: true })) await act(() => request(`/api/ccswitch/domain/prompts/${state.promptApp}/${encodeURIComponent(button.dataset.ccsPromptDelete)}`, { method: "DELETE" }), "Prompt 已删除").catch(() => {}); return; }
    if (action === "prompt-import") { await act(() => request("/api/ccswitch/domain/prompts/import", { method: "POST", body: { app: state.promptApp } }), "live Prompt 已导入").catch(() => {}); return; }
    if (button.dataset.ccsMcpEdit) { fillMcp(button.dataset.ccsMcpEdit); return; }
    if (action === "mcp-clear") { root.querySelector('[data-ccs-form="mcp"]').reset(); return; }
    if (button.dataset.ccsMcpDelete) { if (await askConfirm({ eyebrow: "MCP", title: "删除这个 MCP 声明？", rows: [["影响", "各应用的 live 配置将同步移除该 server"]], warning: "删除后无法恢复。", confirmLabel: "删除", danger: true })) await act(() => request(`/api/ccswitch/domain/mcps/${encodeURIComponent(button.dataset.ccsMcpDelete)}`, { method: "DELETE" }), "MCP 已删除").catch(() => {}); return; }
    if (button.dataset.ccsSkillDelete) { if (await askConfirm({ eyebrow: "Skill", title: "卸载这个 Skill？", rows: [["影响", "登记记录与各应用目录下的 live 副本一并移除"]], warning: "卸载后无法恢复。", confirmLabel: "卸载", danger: true })) await act(() => request(`/api/ccswitch/domain/skills/${encodeURIComponent(button.dataset.ccsSkillDelete)}`, { method: "DELETE", body: { confirmed: true } }), "Skill 已卸载").catch(() => {}); return; }
    if (button.dataset.ccsProfileApply) { await act(() => request(`/api/ccswitch/domain/profiles/${encodeURIComponent(button.dataset.ccsProfileApply)}/apply`, { method: "POST", body: { apps: PROVIDER_SCHEME_APPS } }), "Profile 已应用").catch(() => {}); return; }
    if (button.dataset.ccsProfileDelete) { if (await askConfirm({ eyebrow: "Profile", title: "删除这个 Profile？", rows: [["影响", "只删方案本体，已应用到 live 的内容不回滚"]], confirmLabel: "删除", danger: true })) await act(() => request(`/api/ccswitch/domain/profiles/${encodeURIComponent(button.dataset.ccsProfileDelete)}`, { method: "DELETE" }), "Profile 已删除").catch(() => {}); return; }
    if (button.dataset.ccsBackupRestore) { if (await askConfirm({ eyebrow: "完整备份", title: `用备份「${button.dataset.ccsBackupRestore}」覆盖当前配置？`, rows: [["范围", "供应商档案、Prompt、MCP、Skill、Profile 等整套配置"], ["随后动作", "同步重写各应用 live 配置（syncLive）"]], warning: "当前配置将被这份备份整体覆盖；建议先创建一份新备份再恢复。", confirmLabel: "恢复", danger: true })) await act(() => request(`/api/ccswitch/domain/backups/${encodeURIComponent(button.dataset.ccsBackupRestore)}/restore`, { method: "POST", body: { syncLive: true, apps: PROVIDER_SCHEME_APPS } }), "备份已恢复").catch(() => {}); return; }
    if (button.dataset.ccsBackupDelete) { if (await askConfirm({ eyebrow: "完整备份", title: `删除备份「${button.dataset.ccsBackupDelete}」？`, rows: [["影响", "该时间点的整套配置将不再可恢复"]], warning: "备份删除后无法恢复。", confirmLabel: "删除", danger: true })) await act(() => request(`/api/ccswitch/domain/backups/${encodeURIComponent(button.dataset.ccsBackupDelete)}`, { method: "DELETE", body: { confirmed: true } }), "备份已删除").catch(() => {}); return; }
    if (action === "deeplink-preview") { const form = root.querySelector('[data-ccs-form="deeplink"]'); await previewDeeplink(form.elements.url.value).catch(() => {}); return; }
    if (button.dataset.ccsSync) { const [kind, verb] = button.dataset.ccsSync.split("|"); if (verb === "download" && !(await askConfirm({ eyebrow: `${kind.toUpperCase()} 同步`, title: `用远端快照覆盖本地配置？`, rows: [["方向", "远端 → 本机"], ["随后动作", "同步重写各应用 live 配置（syncLive）"]], warning: "本地未上传的改动会被远端快照覆盖。", confirmLabel: "下载并覆盖", danger: true }))) return; await act(() => request(`/api/ccswitch/domain/sync/${kind}/${verb}`, { method: "POST", body: verb === "download" ? { syncLive: true, apps: PROVIDER_SCHEME_APPS } : {} }), `${kind.toUpperCase()} ${verb === "test" ? "连接正常" : verb === "upload" ? "上传完成" : "下载恢复完成"}`).catch(() => {}); return; }
    if (action === "stream-check") { try { const response = await request("/api/ccswitch/domain/stream/check", { method: "POST", body: {} }); state.streamResults = Array.isArray(response.result) ? response.result : [response.result]; render(); message("Stream Check 已完成"); } catch (error) { message(error.message, "error"); } return; }
    if (action === "env-check") { try { state.env = await request("/api/ccswitch/domain/env/conflicts"); render(); message("环境检查已完成"); } catch (error) { message(error.message, "error"); } return; }
    if (action === "env-delete") { const items = [...root.querySelectorAll(".ccs-env-row input:checked")].map((input) => ({ name: input.dataset.envName, scope: input.dataset.envScope })); if (items.length && await askConfirm({ eyebrow: "环境变量", title: `删除 ${items.length} 个冲突环境变量？`, rows: [["变量", items.map((item) => item.name).join("、")], ["备份", "删除前自动创建备份"]], warning: "系统环境变量会覆盖 live 配置；删除后需重启终端或应用才生效。", confirmLabel: "删除并备份", danger: true })) await act(() => request("/api/ccswitch/domain/env/delete", { method: "POST", body: { items, confirmed: true } }), "环境变量已删除并备份").catch(() => {}); return; }
    if (action === "sync-live") { await act(() => request("/api/ccswitch/domain/sync-live", { method: "POST", body: { apps: PROVIDER_SCHEME_APPS } }), "所有 live 配置已重写").catch(() => {}); return; }
    if (button.dataset.ccsAuthStart) { const provider = button.dataset.ccsAuthStart; try { state.authFlows[provider] = await request(`/api/ccswitch/auth/${provider}/start`, { method: "POST", body: {} }).then((r) => r.result); render(); message("设备登录已启动"); } catch (error) { message(error.message, "error"); } return; }
    if (button.dataset.ccsAuthPoll) { const provider = button.dataset.ccsAuthPoll; const flow = state.authFlows[provider]; if (!flow) return; try { const result = await request(`/api/ccswitch/auth/${provider}/poll`, { method: "POST", body: { deviceCode: flow.deviceCode } }).then((r) => r.result); if (result.status === "authenticated") { delete state.authFlows[provider]; await load(); message("账户已登录"); } else message(`等待授权，${Math.ceil(Number(result.retryAfterMs || 0) / 1000)} 秒后可重试`, "warning"); } catch (error) { message(error.message, "error"); } return; }
    if (button.dataset.ccsAuthDefault) { const [provider, id] = button.dataset.ccsAuthDefault.split("|"); await act(() => request(`/api/ccswitch/auth/${provider}/default/${encodeURIComponent(id)}`, { method: "PUT", body: {} }), "默认账户已更新").catch(() => {}); return; }
    if (button.dataset.ccsAuthRemove) { if (!(await askConfirm({ eyebrow: "OAuth 账户", title: "移除这个账户？", rows: [["影响", "本机保存的该账户凭据将被清除"]], confirmLabel: "移除", danger: true }))) return; const [provider, id] = button.dataset.ccsAuthRemove.split("|"); await act(() => request(`/api/ccswitch/auth/${provider}/accounts/${encodeURIComponent(id)}`, { method: "DELETE", body: { confirmed: true } }), "账户已移除").catch(() => {}); return; }
    if (button.dataset.ccsAuthLogout) { const provider = button.dataset.ccsAuthLogout; if (await askConfirm({ eyebrow: "OAuth 账户", title: `注销 ${AUTH_LABELS[provider]} 的全部账户？`, rows: [["影响", "该服务下所有已登录账户的凭据一并清除"]], warning: "注销后需要重新走设备登录流程。", confirmLabel: "全部注销", danger: true })) await act(() => request(`/api/ccswitch/auth/${provider}/logout`, { method: "POST", body: { confirmed: true } }), "账户已注销").catch(() => {}); return; }
    if (button.dataset.ccsAuthResource) { const [provider, kind] = button.dataset.ccsAuthResource.split("|"); try { state.authResource[provider] = await request(`/api/ccswitch/auth/${provider}/${kind}`).then((r) => r.result.payload); render(); message(`${AUTH_LABELS[provider]} ${kind === "models" ? "模型" : "额度"}已读取`); } catch (error) { message(error.message, "error"); } }
  }

  root.addEventListener("submit", (event) => void handleSubmit(event));
  root.addEventListener("change", (event) => void handleChange(event));
  root.addEventListener("click", (event) => void handleClick(event));
  const api = {
    async openDeeplink(url) { state.tab = "resources"; state.resourceTab = "deeplink"; render(); root.scrollIntoView({ behavior: "smooth", block: "start" }); return previewDeeplink(url); },
    /** 外部深链接到某个页签（供页头动作复用同一份实现，避免第二套弱化副本）。 */
    async openTab(tab, { resourceTab = null, run = null } = {}) {
      if (!["env", "proxy", "resources", "sync", "accounts"].includes(tab)) return false;
      state.tab = tab;
      if (resourceTab) state.resourceTab = resourceTab;
      render();
      root.scrollIntoView({ behavior: "smooth", block: "start" });
      if (tab === "env" && !state.cliEnv && !state.cliEnvLoading) void loadCliEnv();
      if (run === "env-check") {
        try { state.env = await request("/api/ccswitch/domain/env/conflicts"); render(); message(`环境检查已完成——${(state.env?.conflicts ?? []).length} 处冲突`); }
        catch (error) { message(error.message, "error"); }
      }
      if (run === "backups") await refreshBackups().catch((error) => message(error.message, "error"));
      return true;
    },
    refresh: load,
    state,
  };
  window.__forgeCcSwitchPanel = api;
  root.innerHTML = shell();
  void load();
  return api;
}
