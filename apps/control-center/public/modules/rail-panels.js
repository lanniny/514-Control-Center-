/**
 * rail-panels.js — 右栏三个工具页的内容渲染（审阅 / 浏览器 / 文件）。
 *
 * 审阅：把 /api/runs/:id/diff 的 unified diff 解析成带新旧行号的着色块（参考图形态），
 *       统计从 git 的 stat 尾行提取，不自己重算。
 * 浏览器：只做地址栏与历史，打开走系统浏览器——协作台不内嵌网页视图，
 *         也不把浏览器权限交给 CLI（沿用既有安全边界）。
 * 文件：复用受控 workspace explorer 的目录/预览投影，左预览右目录树 + 筛选。
 */

const DIFF_FILE_LIMIT = 40;
const DIFF_LINE_LIMIT = 600;

function fallbackEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** unified diff → [{ path, additions, deletions, lines: [{ kind, old, new, text }] }] */
export function parseUnifiedDiff(raw) {
  const files = [];
  let current = null;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const rawLines = String(raw ?? "").split("\n");
  if (rawLines.at(-1) === "") rawLines.pop(); // 末尾换行不是一行上下文，否则会多出空行并让行号错位
  const appendLine = (value) => {
    if (current.lines.length < DIFF_LINE_LIMIT) current.lines.push(value);
    else current.truncated = true;
  };
  for (const line of rawLines) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2], additions: 0, deletions: 0, lines: [], truncated: false };
      inHunk = false;
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (/^(?:index |new file |deleted file |similarity |rename |old mode |new mode )/.test(line)) continue;
    if (!inHunk && /^(?:--- |\+\+\+ )/.test(line)) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      inHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      appendLine({ kind: "hunk", old: null, new: null, text: line });
      continue;
    }
    if (line.startsWith("+")) {
      current.additions += 1;
      appendLine({ kind: "add", old: null, new: newLine++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      current.deletions += 1;
      appendLine({ kind: "del", old: oldLine++, new: null, text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      appendLine({ kind: "meta", old: null, new: null, text: line });
    } else {
      appendLine({ kind: "ctx", old: oldLine++, new: newLine++, text: line.slice(1) });
    }
  }
  return files;
}

/** git --stat 尾行 → { files, additions, deletions }；解析不出就回落到逐文件累加。 */
export function summarizeDiffStat(stat, files = []) {
  const summary = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(String(stat ?? ""));
  if (summary) {
    return { files: Number(summary[1]), additions: Number(summary[2] ?? 0), deletions: Number(summary[3] ?? 0) };
  }
  return {
    files: files.length,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function createRailPanels({
  root,
  request,
  runsEndpoint,
  icon = () => "",
  escapeHtml = fallbackEscape,
  getRunId = () => null,
  getRun = () => null,
  openSystemBrowser = null,
  notify = () => {},
} = {}) {
  if (!root || typeof request !== "function") {
    return { activate() {}, reset() {}, destroy() {} };
  }

  const reviewBody = root.querySelector("#rail-review-body");
  const reviewStat = root.querySelector("#rail-review-stat");
  const reviewRange = root.querySelector("#rail-review-range");
  const browserForm = root.querySelector("#rail-browser-form");
  const browserUrl = root.querySelector("#rail-browser-url");
  const browserEmpty = root.querySelector("#rail-browser-empty");
  const browserHistory = root.querySelector("#rail-browser-history");
  const filesPath = root.querySelector("#rail-files-path");
  const filesList = root.querySelector("#rail-files-list");
  const filesPreview = root.querySelector("#rail-files-preview");
  const filesFilter = root.querySelector("#rail-files-filter");

  const loaded = { review: null, files: null };
  let filesEntries = [];
  let filesCurrentPath = "";
  let filesDirectoryTruncation = null;
  let history = [];
  let reviewController = null;
  let reviewGeneration = 0;
  let filesController = null;
  let filesGeneration = 0;

  function emptyMarkup(iconName, title, hint) {
    return `<div class="rail-tool-empty">${icon(iconName)}<strong>${escapeHtml(title)}</strong><span>${escapeHtml(hint)}</span></div>`;
  }

  /* ── 审阅 ───────────────────────────────────────────── */

  function renderReview(data) {
    const parsedFiles = parseUnifiedDiff(data.diff);
    const files = parsedFiles.slice(0, DIFF_FILE_LIMIT);
    const total = summarizeDiffStat(data.stat, parsedFiles);
    const notes = [
      parsedFiles.length > files.length
        ? `<p class="rail-tool-note">差异包含 ${parsedFiles.length} 个文件，仅显示前 ${DIFF_FILE_LIMIT} 个；总统计仍按完整差异计算。</p>`
        : "",
      data.truncated
        ? '<p class="rail-tool-note">diff 超出上限已被后端截断，完整内容请在工作树内查看。</p>'
        : "",
    ].join("");
    if (reviewStat) reviewStat.innerHTML = `<b>+${total.additions.toLocaleString("zh-CN")}</b><i>-${total.deletions.toLocaleString("zh-CN")}</i>`;
    if (reviewRange) {
      // 两端都只显示末段目录名：完整临时路径会占掉两行，把统计和文件列表挤下去
      const worktree = String(data.worktree ?? "").split(/[\\/]/).pop() || "工作树";
      const base = String(data.base ?? "").split(/[\\/]/).pop() || "主仓库 HEAD";
      reviewRange.innerHTML = `<span title="${escapeHtml(String(data.worktree ?? ""))}">${escapeHtml(worktree)}</span>${icon("arrow-right")}<span title="${escapeHtml(String(data.base ?? ""))}">${escapeHtml(base)} · HEAD</span>`;
    }
    if (!files.length) {
      const statusText = String(data.status ?? "").trim();
      reviewBody.innerHTML = statusText
        ? `<pre class="rail-review-status">${escapeHtml(statusText)}</pre>`
        : emptyMarkup("git-branch", "没有待审阅的改动", "工作树相对主仓库 HEAD 无差异");
      reviewBody.innerHTML += notes;
      return;
    }
    reviewBody.innerHTML = files.map((file) => `
      <section class="rail-diff-file">
        <header>
          ${icon("file-text")}
          <strong title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</strong>
          <span class="rail-diff-count"><b>+${file.additions}</b><i>-${file.deletions}</i></span>
        </header>
        <div class="rail-diff-lines">
          ${file.lines.map((line) => `<div class="rail-diff-line is-${line.kind}"><span class="rail-diff-no">${line.old ?? ""}</span><span class="rail-diff-no">${line.new ?? ""}</span><code>${escapeHtml(line.text)}</code></div>`).join("")}
        </div>
        ${file.truncated ? `<p class="rail-tool-note">该文件差异过长，仅显示前 ${DIFF_LINE_LIMIT} 行；文件增删统计仍按完整差异计算。</p>` : ""}
      </section>`).join("")
      + notes;
  }

  async function loadReview({ force = false } = {}) {
    const runId = getRunId();
    if (!reviewBody) return;
    if (!runId) {
      reviewGeneration += 1;
      reviewController?.abort();
      reviewController = null;
      loaded.review = null;
      reviewBody.innerHTML = emptyMarkup("clipboard-list", "先选择一个任务", "审阅读取该任务隔离工作树与主仓库 HEAD 的差异");
      if (reviewStat) reviewStat.innerHTML = "<b>+0</b><i>-0</i>";
      if (reviewRange) reviewRange.textContent = "";
      return;
    }
    // 没有隔离工作树的任务请求 diff 必然 422：与其把校验失败当"读取失败"展示，不如直接说清
    if (getRun()?.worktreePath === undefined || getRun()?.worktreePath === null || getRun()?.worktreePath === "") {
      reviewGeneration += 1;
      reviewController?.abort();
      reviewController = null;
      loaded.review = runId;
      reviewBody.innerHTML = emptyMarkup("clipboard-list", "该任务没有隔离工作树", "审阅只比对隔离 worktree 与主仓库 HEAD 的差异");
      if (reviewStat) reviewStat.innerHTML = "<b>+0</b><i>-0</i>";
      if (reviewRange) reviewRange.textContent = "";
      return;
    }
    if (loaded.review === runId && !force) return;
    reviewBody.innerHTML = `<div class="rail-tool-loading">${icon("loader-circle")}<span>正在读取工作树差异</span></div>`;
    const generation = ++reviewGeneration;
    reviewController?.abort();
    const ownedController = new AbortController();
    reviewController = ownedController;
    try {
      const data = await request(`${runsEndpoint}/${encodeURIComponent(runId)}/diff`, { signal: ownedController.signal });
      if (ownedController.signal.aborted || generation !== reviewGeneration || getRunId() !== runId) return;
      loaded.review = runId;
      renderReview(data);
    } catch (error) {
      if (ownedController.signal.aborted || generation !== reviewGeneration || getRunId() !== runId) return;
      loaded.review = null;
      reviewBody.innerHTML = emptyMarkup("triangle-alert", "差异读取失败", error?.message || "未知错误");
    } finally {
      if (reviewController === ownedController) reviewController = null;
    }
  }

  /* ── 浏览器 ─────────────────────────────────────────── */

  function renderHistory() {
    if (!browserHistory) return;
    browserHistory.innerHTML = history.map((url) => `<li><button type="button" data-rail-browser-open="${escapeHtml(url)}" title="${escapeHtml(url)}">${icon("external-link")}<span>${escapeHtml(url)}</span></button></li>`).join("");
    if (browserEmpty) browserEmpty.hidden = history.length > 0;
  }

  function submitBrowser(event) {
    event?.preventDefault();
    const raw = String(browserUrl?.value ?? "").trim();
    if (!raw) return;
    let parsed;
    try {
      parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    } catch {
      notify("请输入合法的 HTTP(S) 地址", "warning");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      notify("只允许打开 HTTP(S) 地址", "warning");
      return;
    }
    const url = parsed.toString();
    history = [url, ...history.filter((item) => item !== url)].slice(0, 8);
    if (browserUrl) browserUrl.value = url;
    renderHistory();
    openSystemBrowser?.(url);
  }

  /* ── 文件 ───────────────────────────────────────────── */

  function renderFilesTree() {
    if (!filesList) return;
    const keyword = String(filesFilter?.value ?? "").trim().toLowerCase();
    const visible = keyword ? filesEntries.filter((entry) => entry.name.toLowerCase().includes(keyword)) : filesEntries;
    const content = !visible.length
      ? `<p class="rail-tool-note">${keyword ? "没有匹配的条目" : "目录为空"}</p>`
      : `${filesCurrentPath
        ? `<button class="rail-files-entry is-parent" type="button" data-rail-files-path="${escapeHtml(filesCurrentPath.split("/").slice(0, -1).join("/"))}">${icon("arrow-up")}<span>上级目录</span></button>`
        : ""}${visible.map((entry) => `
        <button class="rail-files-entry" type="button" data-rail-files-path="${escapeHtml(entry.path)}" data-entry-type="${escapeHtml(entry.type)}"${entry.openable === false ? " disabled" : ""} title="${escapeHtml(entry.path)}">
          ${icon(entry.type === "directory" ? "chevron-right" : "file-text")}<span>${escapeHtml(entry.name)}</span>
        </button>`).join("")}`;
    const truncated = filesDirectoryTruncation
      ? `<p class="rail-tool-note">目录结果已截断${filesDirectoryTruncation.limit ? `，仅返回前 ${filesDirectoryTruncation.limit} 个可见条目` : ""}；请进入子目录或使用筛选缩小范围。</p>`
      : "";
    filesList.innerHTML = content + truncated;
  }

  function renderFilePreview(value) {
    if (!filesPreview) return;
    const file = value.file ?? {};
    if (file.binary) {
      filesPreview.innerHTML = emptyMarkup("file-text", value.path?.split("/").pop() || "二进制文件", "二进制文件仅显示元数据，不在控制面内解码");
      return;
    }
    filesPreview.innerHTML = `
      <header class="rail-files-preview-head">
        <strong title="${escapeHtml(value.path ?? "")}">${escapeHtml(String(value.path ?? "").split("/").pop() || "文件")}</strong>
        <span>${escapeHtml(file.language || "text")}${file.redacted ? " · 敏感内容已脱敏" : ""}${file.truncated ? " · 预览已截断" : ""}</span>
      </header>
      <pre class="rail-files-preview-body" tabindex="0"><code>${escapeHtml(file.content ?? "")}</code></pre>`;
  }

  async function loadFiles(path = "", { force = false } = {}) {
    const runId = getRunId();
    if (!filesList) return;
    if (!runId) {
      filesGeneration += 1;
      filesController?.abort();
      filesController = null;
      loaded.files = null;
      filesEntries = [];
      filesDirectoryTruncation = null;
      filesList.innerHTML = "";
      if (filesPath) filesPath.textContent = "/";
      if (filesPreview) filesPreview.innerHTML = emptyMarkup("folder-open", "先选择一个任务", "文件页只读取该任务的受控项目目录");
      return;
    }
    if (loaded.files === `${runId}:${path}` && !force) return;
    filesList.innerHTML = `<div class="rail-tool-loading">${icon("loader-circle")}<span>正在读取目录</span></div>`;
    const generation = ++filesGeneration;
    filesController?.abort();
    const ownedController = new AbortController();
    filesController = ownedController;
    try {
      const value = await request(`${runsEndpoint}/${encodeURIComponent(runId)}/workspace?path=${encodeURIComponent(path)}`, {
        signal: ownedController.signal,
      });
      if (ownedController.signal.aborted || generation !== filesGeneration || getRunId() !== runId) return;
      loaded.files = `${runId}:${path}`;
      if (value.type === "directory") {
        filesCurrentPath = value.path ?? "";
        filesEntries = Array.isArray(value.entries) ? value.entries : [];
        const entryLimit = Number(value.bounds?.entries);
        filesDirectoryTruncation = value.truncated
          ? { limit: Number.isFinite(entryLimit) && entryLimit > 0 ? entryLimit : null }
          : null;
        if (filesPath) filesPath.textContent = `/${filesCurrentPath}`;
        renderFilesTree();
        return;
      }
      renderFilePreview(value);
    } catch (error) {
      if (ownedController.signal.aborted || generation !== filesGeneration || getRunId() !== runId) return;
      loaded.files = null;
      filesList.innerHTML = `<p class="rail-tool-note">${escapeHtml(error?.message || "目录读取失败")}</p>`;
    } finally {
      if (filesController === ownedController) filesController = null;
    }
  }

  const handleClick = (event) => {
    const open = event.target.closest("[data-rail-browser-open]");
    if (open) {
      event.preventDefault();
      openSystemBrowser?.(open.dataset.railBrowserOpen);
      return;
    }
    const entry = event.target.closest("[data-rail-files-path]");
    if (entry && !entry.disabled) {
      event.preventDefault();
      void loadFiles(entry.dataset.railFilesPath, { force: true });
      return;
    }
    if (event.target.closest("#rail-files-root")) {
      event.preventDefault();
      void loadFiles("", { force: true });
      return;
    }
    if (event.target.closest("#rail-browser-back") || event.target.closest("#rail-browser-forward")) return;
    if (event.target.closest("#rail-browser-reload")) {
      event.preventDefault();
      submitBrowser();
    }
  };

  const handleFilter = () => renderFilesTree();

  root.addEventListener("click", handleClick);
  browserForm?.addEventListener("submit", submitBrowser);
  filesFilter?.addEventListener("input", handleFilter);
  renderHistory();

  let lastRunId = getRunId();

  return {
    activate(id) {
      // 换任务后旧目录路径在新任务里未必存在，且旧差异不能冒充新任务的内容——激活时先自检
      const runId = getRunId();
      if (runId !== lastRunId) {
        reviewGeneration += 1;
        filesGeneration += 1;
        reviewController?.abort();
        filesController?.abort();
        reviewController = null;
        filesController = null;
        lastRunId = runId;
        loaded.review = null;
        loaded.files = null;
        filesEntries = [];
        filesCurrentPath = "";
        filesDirectoryTruncation = null;
      }
      if (id === "review") void loadReview();
      if (id === "files") void loadFiles(filesCurrentPath);
      if (id === "browser") browserUrl?.focus();
    },
    // 换 run 后旧任务的差异与目录不能留在屏幕上冒充新任务的内容
    reset() {
      reviewGeneration += 1;
      filesGeneration += 1;
      reviewController?.abort();
      filesController?.abort();
      reviewController = null;
      filesController = null;
      loaded.review = null;
      loaded.files = null;
      filesEntries = [];
      filesCurrentPath = "";
      filesDirectoryTruncation = null;
    },
    destroy() {
      reviewGeneration += 1;
      filesGeneration += 1;
      reviewController?.abort();
      filesController?.abort();
      root.removeEventListener("click", handleClick);
      browserForm?.removeEventListener("submit", submitBrowser);
      filesFilter?.removeEventListener("input", handleFilter);
    },
  };
}
