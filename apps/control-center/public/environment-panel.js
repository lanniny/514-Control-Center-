const ENVIRONMENT_SCHEMA = "514cc.workbench.environment/v1";
// 头像堆叠上限（超出显示 +N），来源折叠预览条数：都是视觉密度约束，不是数据截断——
// 完整数据仍在展开列表里，避免"看起来全了其实被砍了"。
const AVATAR_LIMIT = 4;
const SOURCE_PREVIEW = 3;

function fallbackEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function basename(path) {
  return String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || String(path ?? "");
}

function relativeTime(value) {
  const ms = Date.parse(String(value ?? ""));
  if (!Number.isFinite(ms)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86_400)} 天前`;
}

export function validateWorkbenchEnvironment(value) {
  if (!value || typeof value !== "object" || value.schema !== ENVIRONMENT_SCHEMA) {
    throw new Error("环境信息协议不受支持");
  }
  if (!value.workspace || !value.git || !value.agents || !value.processes) {
    throw new Error("环境信息缺少必要投影");
  }
  return value;
}

export function createWorkbenchEnvironmentPanel({
  root,
  toolsRoot = null,
  loadEnvironment,
  onAction = null,
  getAttachments = () => [],
  icon = () => "",
  escapeHtml = fallbackEscape,
  renderAgentAvatar = null,
  agentLabel = (id) => String(id ?? ""),
} = {}) {
  if (!root || typeof loadEnvironment !== "function") {
    return { selectRun() {}, refresh() {}, refreshLocal() {}, observeEvent() {}, destroy() {} };
  }

  let selectedRunId = null;
  let environment = null;
  let controller = null;
  let requestPending = false;
  let generation = 0;
  let refreshTimer = 0;
  let refreshing = false;
  // 展开态是纯视图状态：跨刷新保留，否则每次 SSE 触发的重绘都会把用户手动展开的行弹回去。
  const expandedRows = new Set(["first-run"]);
  let sourcesExpanded = false;

  function actionButton(action, label, iconName, disabled = false, title = "") {
    return `<button class="environment-action" type="button" data-environment-action="${escapeHtml(action)}"${disabled ? " disabled" : ""}${title ? ` title="${escapeHtml(title)}"` : ""}>${icon(iconName)}<span>${escapeHtml(label)}</span></button>`;
  }

  function expandRow(key, title, subtitle, iconName, details, state = "") {
    const open = expandedRows.has(key);
    const rows = details.filter((item) => item && item[1]);
    const stateDot = state
      ? `<span class="environment-state is-${escapeHtml(state)}" aria-hidden="true"></span>`
      : "";
    return `
      <button class="environment-row is-action is-expandable${open ? " is-open" : ""}" type="button" data-environment-expand="${escapeHtml(key)}" aria-expanded="${open ? "true" : "false"}">
        <span class="environment-row-icon">${icon(iconName)}${stateDot}</span>
        <span class="environment-row-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small></span>
        <span class="environment-chevron">${icon("chevron-down")}</span>
      </button>
      ${open && rows.length
        ? `<dl class="environment-detail">${rows.map(([term, value]) => `<dt>${escapeHtml(term)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd>`).join("")}</dl>`
        : ""}`;
  }

  function renderLoading() {
    root.setAttribute("aria-busy", "true");
    root.innerHTML = `<div class="environment-loading">${icon("loader-circle")}<span>正在核对工作目录、Git 与运行进程</span></div>`;
  }

  function renderError(error) {
    root.setAttribute("aria-busy", "false");
    root.innerHTML = `<div class="environment-error"><strong>环境信息不可用</strong><span>${escapeHtml(error?.message || "未知错误")}</span>${actionButton("refresh", "重试", "refresh-cw")}</div>`;
  }

  function render() {
    if (!environment) return;
    root.setAttribute("aria-busy", refreshing ? "true" : "false");
    const git = environment.git || {};
    const changes = git.changes || {};
    const pr = environment.pullRequest || {};
    const agents = environment.agents || { items: [] };
    const processes = environment.processes || { items: [] };
    const pendingAttachments = [...new Set((getAttachments() || []).map(String).filter(Boolean))];
    const recordedSources = Array.isArray(environment.sources?.items) ? environment.sources.items : [];
    const branch = git.available
      ? git.detached ? `detached · ${git.head || "HEAD"}` : git.branch || "未命名分支"
      : git.reason === "not-a-repository" ? "非 Git 目录" : "Git 不可用";
    const divergence = git.upstream
      ? [git.ahead ? `↑${git.ahead}` : null, git.behind ? `↓${git.behind}` : null].filter(Boolean).join(" ") || "已同步"
      : git.available ? "无上游" : "";
    const prLabel = pr.status === "found"
      ? `#${pr.number || "?"} · ${pr.draft ? "草稿" : pr.state || "open"}`
      : pr.status === "none" ? "当前分支无 PR" : pr.status === "cli-unavailable" ? "gh CLI 不可用" : "无法获取 PR 状态";
    const processItems = (processes.items || []).slice(0, 6);
    const agentItems = (agents.items || []).slice(-6).reverse();
    const commitAction = git.actions?.commit || {
      enabled: Boolean(git.available && !git.detached && changes.staged),
      reason: changes.staged ? "仅提交已暂存内容" : "没有已暂存内容",
    };
    const pushAction = git.actions?.push || {
      enabled: Boolean(git.available && !git.detached && git.upstream && git.ahead),
      reason: git.upstream ? "只推送当前分支到既有 upstream" : "没有既有 upstream",
    };
    const workspaceLabel = environment.workspace?.source === "worktree"
      ? "当前任务隔离工作树"
      : environment.workspace?.source === "run" ? "当前任务目录" : "514cc 控制面目录";
    const workspaceIcon = environment.workspace?.source === "worktree" ? "folder-git-2" : "server";
    // 全部来源 = 已登记来源 + 待发送附件；折叠时只预览前 N 条，「查看全部」展开其余。
    const allSources = [
      ...recordedSources.map((source) => ({ name: String(source.name ?? ""), hint: "任务来源", title: String(source.name ?? "") })),
      ...pendingAttachments.map((path) => ({ name: basename(path), hint: "待发送附件", title: path })),
    ];
    const visibleSources = sourcesExpanded ? allSources : allSources.slice(0, SOURCE_PREVIEW);
    // 头像条只代表"此刻在跑的"：没有运行中就不渲染，避免出现「0 个运行中」却挂着一排头像
    const avatarPool = agentItems.filter((item) => item.status === "running").slice(0, AVATAR_LIMIT);

    root.innerHTML = `
      <div class="environment-primary">
        <div class="environment-row environment-changes-row">
          <span class="environment-row-icon">${icon("file-text")}</span>
          <span class="environment-row-main"><strong>${formatCount(changes.total)} 个变更</strong><small>${formatCount(changes.staged)} 暂存 · ${formatCount(changes.unstaged)} 未暂存 · ${formatCount(changes.untracked)} 未跟踪</small></span>
          <span class="environment-row-trail">
            ${refreshing
              ? `<span class="environment-inline-spinner" role="status" aria-label="正在刷新环境信息">${icon("loader-circle")}</span>`
              : `<button class="environment-diff-count" type="button" data-environment-action="changes"${changes.total ? "" : " disabled"} title="打开当前任务的变更审阅"><b>+${formatCount(changes.additions)}</b><i>-${formatCount(changes.deletions)}</i></button>`}
            <button class="icon-button environment-refresh" type="button" data-environment-action="refresh" title="刷新环境信息" aria-label="刷新环境信息">${icon("refresh-cw")}</button>
          </span>
        </div>
        ${expandRow("workspace", "本地", workspaceLabel, workspaceIcon, [
          ["目录", environment.workspace?.name || git.name || ""],
          ["仓库根", git.root || ""],
          ["Git", git.available ? "可用" : (git.reason || "不可用")],
        ])}
        ${environment.projectBridge ? expandRow(
          "project-bridge",
          `项目桥 ${environment.projectBridge.consistency || "unknown"}`,
          environment.projectBridge.diagnosis || "四面未齐，不能称为项目已接通",
          "waypoints",
          [
            ["一致性", environment.projectBridge.consistency || "unknown"],
            ["锚点", environment.projectBridge.anchorId || "unknown"],
            ["项目", environment.projectBridge.projectId || "unknown"],
            ["源码", environment.projectBridge.faces?.source?.status || "unknown"],
            ["运行时", environment.projectBridge.faces?.runtime?.status || "unknown"],
            ["进程", environment.projectBridge.faces?.process?.status || "unknown"],
            ["证据", environment.projectBridge.faces?.evidence?.status || "unknown"],
            ["分支", environment.projectBridge.faces?.source?.branch || ""],
            ["HEAD", environment.projectBridge.faces?.source?.headDigest || ""],
          ],
          environment.projectBridge.consistency || "unknown",
        ) : ""}
        ${environment.releaseTruth ? expandRow(
          "release-truth",
          `运行态 ${environment.releaseTruth.consistency || "unknown"}`,
          environment.releaseTruth.activation?.text || "没有当轮 readback，不能称为已激活",
          "shield-check",
          [
            ["一致性", environment.releaseTruth.consistency || "unknown"],
            ["源提交", environment.releaseTruth.sourceCommit || "unknown"],
            ["差异摘要", environment.releaseTruth.diffDigest || "unknown"],
            ["运行代际", environment.releaseTruth.runtimeGeneration == null ? "unknown" : String(environment.releaseTruth.runtimeGeneration)],
            ["PID", environment.releaseTruth.pid == null ? "unknown" : String(environment.releaseTruth.pid)],
            ["工作目录", environment.releaseTruth.cwd || "unknown"],
            ["启动时间", environment.releaseTruth.startedAt || "unknown"],
            ["验证", environment.releaseTruth.validationEvidence?.status || "unknown"],
          ],
          environment.releaseTruth.consistency || "unknown",
        ) : ""}
        ${environment.releaseRecord ? expandRow(
          "release-record",
          `交付门 ${environment.releaseRecord.verdict || "unknown"}${environment.releaseRecord.publishable ? " · 可发布" : ""}`,
          environment.releaseRecord.nextAction?.text
            || (environment.releaseRecord.autoGit?.add === false ? "不自动 git add/commit/push" : "发布记录不完整"),
          "clipboard-list",
          [
            ["裁决", environment.releaseRecord.verdict || "unknown"],
            ["可发布", environment.releaseRecord.publishable ? "yes" : "no"],
            ["正式升格", environment.releaseRecord.formalRelease ? "yes" : "no"],
            ["源提交", environment.releaseRecord.sourceCommit || "unknown"],
            ["差异摘要", environment.releaseRecord.diffDigest || "unknown"],
            ["未声明源码", String((environment.releaseRecord.delivery?.undeclaredSourceOrTests || []).length)],
            ["缺失源码", String((environment.releaseRecord.delivery?.missingSourceOrTests || []).length)],
            ["命令证据", (environment.releaseRecord.commands || []).map((item) => `${item.id}:${item.status}`).join(" · ") || "none"],
            ["未完成", (environment.releaseRecord.unfinished || []).slice(0, 4).map((item) => item.id).join(" · ") || "none"],
            ["自动 git", "add/commit/push=off"],
            ["运行代际", environment.releaseRecord.runtime?.generation == null ? "unknown" : String(environment.releaseRecord.runtime.generation)],
            ["已对账激活", (environment.releaseRecord.runtime?.activated ?? environment.releaseRecord.runtime?.reloaded) ? "yes" : "no"],
            ["命令证据性质", "attested（申报，非本接口执行 QA）"],
          ],
          environment.releaseRecord.verdict || "unknown",
        ) : ""}
        ${environment.settlement ? expandRow(
          "run-settlement",
          `准备交付 ${environment.settlement.verdict || "unknown"}`,
          environment.settlement.nextAction?.reason
            || environment.settlement.nextAction?.text
            || (environment.settlement.autoLanding?.merge === false ? "不自动 merge" : "结算记录不完整"),
          "git-branch",
          [
            ["裁决", environment.settlement.verdict || "unknown"],
            ["隔离", environment.settlement.isolation || "unknown"],
            ["工作区", environment.settlement.workspace?.kind || "unknown"],
            ["差异", environment.settlement.diff?.dirty ? "dirty" : environment.settlement.diff?.available ? "clean" : "unprobed"],
            ["恢复", environment.settlement.recovery?.canContinue ? "needs-ack" : "idle"],
            ["自动落地", "merge/rebase/commit/push=off"],
            ["下一拍", environment.settlement.nextAction?.reason || environment.settlement.nextAction?.text || ""],
          ],
          environment.settlement.verdict || "unknown",
        ) : ""}
        ${environment.readiness ? expandRow(
          "first-run",
          environment.readiness.ready ? "首次就绪 ready" : environment.readiness.degraded ? "首次就绪读取失败" : "首次就绪未齐",
          environment.readiness.nextAction?.text || "先确认项目、团队、席位和一次非付费验证",
          "list-checks",
          (environment.readiness.steps || []).map((item) => [item.title, item.status]),
          environment.readiness.ready ? "ok" : environment.readiness.degraded ? "attention" : "unknown",
        ) : ""}
        ${expandRow("branch", branch, divergence, "git-branch", [
          ["HEAD", git.head || ""],
          ["上游", git.upstream || "无"],
          ["领先 / 落后", git.available ? `${formatCount(git.ahead)} / ${formatCount(git.behind)}` : ""],
          ["冲突", changes.conflicts ? formatCount(changes.conflicts) : ""],
          ["远端", git.remoteProvider || ""],
        ])}
        <div class="environment-row environment-commit-row">
          <span class="environment-row-icon">${icon("git-commit-horizontal")}</span>
          <span class="environment-row-main"><strong>提交或推送</strong><small>${escapeHtml(commitAction.enabled ? commitAction.reason : (pushAction.enabled ? pushAction.reason : commitAction.reason))}</small></span>
          <span class="environment-commit-actions">
            ${actionButton("commit", "提交", "git-commit-horizontal", !commitAction.enabled, commitAction.reason)}
            ${actionButton("push", "推送", "upload", !pushAction.enabled, pushAction.reason)}
          </span>
        </div>
        <button class="environment-row is-action" type="button" data-environment-action="pull-request"${pr.url ? ` data-url="${escapeHtml(pr.url)}"` : ""}${pr.status !== "found" ? " disabled" : ""}>
          <span class="environment-row-icon">${icon("git-branch")}</span>
          <span class="environment-row-main"><strong>Pull Request</strong><small>${escapeHtml(prLabel)}</small></span>
          <span class="environment-row-trail">${icon("chevron-right")}</span>
        </button>
      </div>
      <details class="environment-group" open>
        <summary><span>智能体活动</span><small>${formatCount(agents.running)} 运行中 · ${formatCount(agents.delegated)} 个委派</small></summary>
        ${avatarPool.length
          ? `<div class="environment-avatar-strip">
              <span class="environment-avatars">${avatarPool.map((item) => `<span class="environment-avatar" title="${escapeHtml(agentLabel(item.agentId) || item.agentId)}">${renderAgentAvatar?.(item.agentId) || `<i>${escapeHtml(String(item.agentId).slice(0, 2))}</i>`}</span>`).join("")}${agents.running > avatarPool.length ? `<span class="environment-avatar is-more"><i>+${formatCount(agents.running - avatarPool.length)}</i></span>` : ""}</span>
              <strong>${formatCount(agents.running)} 个运行中</strong>
            </div>`
          : ""}
        <div class="environment-compact-list">
          ${agentItems.length ? agentItems.map((item) => `<div><span class="environment-state is-${escapeHtml(item.status)}"></span><strong>${escapeHtml(agentLabel(item.agentId) || item.agentId)}</strong><small>${item.delegated ? "委派 · " : ""}${escapeHtml(item.phase)}</small></div>`).join("") : "<p>当前没有智能体活动</p>"}
        </div>
      </details>
      <details class="environment-group" open>
        <summary><span>后台进程</span><small>${formatCount(processes.running)} 个</small></summary>
        <div class="environment-compact-list is-mono">
          ${processItems.length
            ? processItems.map((item) => `<div title="PID ${formatCount(item.pid)}"><span class="environment-row-icon">${icon("square-terminal")}</span><strong>${escapeHtml(item.image)}</strong><small>PID ${formatCount(item.pid)}${item.startedAt ? ` · ${relativeTime(item.startedAt)}` : ""}</small></div>`).join("")
            : "<p>当前没有托管后台进程</p>"}
          ${processes.running > processItems.length ? `<p>另有 ${formatCount(processes.running - processItems.length)} 个托管进程</p>` : ""}
        </div>
      </details>
      <details class="environment-group" open>
        <summary>
          <span>来源</span>
          <small>${formatCount(allSources.length)} 个</small>
          <button class="icon-button environment-source-add" type="button" data-environment-action="sources-add" title="添加来源附件" aria-label="添加来源附件">${icon("plus")}</button>
        </summary>
        <div class="environment-compact-list">
          ${visibleSources.map((source) => `<div title="${escapeHtml(source.title)}"><span class="environment-row-icon">${icon("file-text")}</span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.hint)}</small></div>`).join("")}
          ${allSources.length ? "" : "<p>当前任务没有登记来源</p>"}
          ${allSources.length > SOURCE_PREVIEW
            ? `<button class="environment-more" type="button" data-environment-expand="sources">${icon(sourcesExpanded ? "chevron-down" : "chevron-right")}<span>${sourcesExpanded ? "收起" : `查看全部（${formatCount(allSources.length)}）`}</span></button>`
            : ""}
        </div>
      </details>`;
  }

  async function fetchEnvironment() {
    controller?.abort();
    const ownedGeneration = ++generation;
    const ownedRunId = selectedRunId;
    const ownedController = new AbortController();
    controller = ownedController;
    requestPending = true;
    // 已有内容时不整屏替换成 loading：只在变更行内联转圈，避免每次 SSE 抖动导致面板闪烁与滚动位置丢失。
    if (environment) {
      refreshing = true;
      render();
    } else {
      renderLoading();
    }
    try {
      const value = validateWorkbenchEnvironment(await loadEnvironment(ownedRunId, ownedController.signal));
      if (ownedController.signal.aborted || ownedGeneration !== generation || selectedRunId !== ownedRunId) return;
      environment = value;
      refreshing = false;
      render();
    } catch (error) {
      if (ownedController.signal.aborted || ownedGeneration !== generation || selectedRunId !== ownedRunId) return;
      environment = null;
      refreshing = false;
      renderError(error);
    } finally {
      if (controller === ownedController) {
        controller = null;
        requestPending = false;
      }
    }
  }

  function selectRun(runId) {
    const next = runId ? String(runId) : null;
    if (selectedRunId === next && (environment || requestPending)) return;
    selectedRunId = next;
    expandedRows.clear();
    expandedRows.add("first-run");
    sourcesExpanded = false;
    void fetchEnvironment();
  }

  function refresh() {
    void fetchEnvironment();
  }

  function refreshLocal() {
    if (environment) render();
  }

  function observeEvent(event) {
    if (selectedRunId && event?.runId !== selectedRunId) return;
    if (!/^(?:agent\.|run\.|control\.)/.test(String(event?.type ?? ""))) return;
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 280);
  }

  const handleAction = (event) => {
    const expander = event.target.closest("[data-environment-expand]");
    if (expander && root.contains(expander)) {
      // summary 内/外的展开按钮都不能让 <details> 或表单接管默认行为。
      event.preventDefault();
      const key = expander.dataset.environmentExpand;
      if (key === "sources") sourcesExpanded = !sourcesExpanded;
      else if (expandedRows.has(key)) expandedRows.delete(key);
      else expandedRows.add(key);
      render();
      return;
    }
    const button = event.target.closest("[data-environment-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.environmentAction;
    // 来源分组的 ➕ 位于 <summary> 内：不拦默认行为就会顺带折叠整组。
    if (button.closest("summary")) event.preventDefault();
    if (action === "refresh") return refresh();
    onAction?.(action, {
      runId: selectedRunId,
      url: button.dataset.url || null,
      environment,
    });
  };
  root.addEventListener("click", handleAction);
  toolsRoot?.addEventListener("click", handleAction);

  return {
    selectRun,
    refresh,
    refreshLocal,
    observeEvent,
    destroy() {
      controller?.abort();
      window.clearTimeout(refreshTimer);
      root.removeEventListener("click", handleAction);
      toolsRoot?.removeEventListener("click", handleAction);
    },
  };
}
