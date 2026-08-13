/**
 * memory-browser.js — 记忆库浏览器（v4.0 Forge）
 *
 * 自初始化：挂载到观测视图 #memory-browser-root（容器不存在时静默跳过）。
 * 数据源（只读）：
 *   GET /api/memory           → { roots: [{ name, path, files: [{ name, size, mtime }] }] }
 *   GET /api/memory/search?q= → { results: [{ path, name, snippet, score }] }
 * 接口 404 / 网络失败 / 未授权时展示友好错误态，不影响页面其它模块。
 */

import { lucideIcon } from "./lucide.js";
import { escapeHtml, formatRelative } from "./utils.js";
import { request as apiRequest, apiReady } from "./api.js";

const SEARCH_DEBOUNCE_MS = 250;

let _root = null;
let _bodyEl = null;
let _inputEl = null;
let _refreshEl = null;

let _roots = null;        // null = 尚未加载/加载中
let _rootsError = "";
let _expanded = new Set(); // 展开的 root 名

let _searchState = "idle"; // idle | loading | done | error
let _searchResults = [];
let _searchTimer = 0;
let _searchSeq = 0;
let _searchAbort = null;
let _openResult = -1;      // 展开详情的搜索结果索引

/** 挂载并初始化（幂等）。容器不存在时返回 false。 */
export function initMemoryBrowser(container) {
  if (_root || !container) return Boolean(_root);
  _root = container;
  _root.innerHTML = `
    <section class="memory-browser" aria-label="记忆库">
      <header class="mb-head">
        <span class="mb-tile">${lucideIcon("brain", "icon lucide")}</span>
        <div class="mb-head-text">
          <h3 class="mb-title">记忆库</h3>
          <p class="mb-sub">跨会话记忆文件 · 只读浏览与检索</p>
        </div>
        <button type="button" class="mb-refresh" title="刷新记忆库" aria-label="刷新记忆库">
          ${lucideIcon("refresh-cw", "icon lucide")}
        </button>
      </header>
      <div class="mb-search">
        ${lucideIcon("search", "icon lucide mb-search-icon")}
        <input class="mb-input" type="search" placeholder="搜索记忆内容…" autocomplete="off"
          spellcheck="false" aria-label="搜索记忆内容" />
      </div>
      <div class="mb-body" role="region" aria-live="polite"></div>
    </section>
  `;
  _bodyEl = _root.querySelector(".mb-body");
  _inputEl = _root.querySelector(".mb-input");
  _refreshEl = _root.querySelector(".mb-refresh");

  _inputEl.addEventListener("input", onSearchInput);
  _refreshEl.addEventListener("click", () => void loadRoots(true));
  _bodyEl.addEventListener("click", onBodyClick);

  renderBody(); // 先出骨架屏
  void loadRoots();
  return true;
}

/* ---------------- 数据加载 ---------------- */

async function loadRoots(manual = false) {
  if (manual) {
    _roots = null;
    _rootsError = "";
    renderBody();
  }
  _refreshEl?.classList.add("is-loading");
  try {
    const data = await apiRequest("/api/memory");
    _roots = Array.isArray(data?.roots) ? data.roots : [];
    _rootsError = "";
  } catch (error) {
    if (error?.name === "AbortError") return;
    _roots = null;
    _rootsError = "记忆库暂不可用";
  } finally {
    _refreshEl?.classList.remove("is-loading");
  }
  renderBody();
}

function onSearchInput() {
  const q = _inputEl.value.trim();
  window.clearTimeout(_searchTimer);
  if (!q) {
    _searchSeq++;
    _searchAbort?.abort();
    _searchState = "idle";
    _searchResults = [];
    _openResult = -1;
    renderBody();
    return;
  }
  _searchTimer = window.setTimeout(() => void runSearch(q), SEARCH_DEBOUNCE_MS);
}

async function runSearch(query) {
  const seq = ++_searchSeq;
  _searchState = "loading";
  _openResult = -1;
  renderBody();
  _searchAbort?.abort();
  const controller = new AbortController();
  _searchAbort = controller;
  try {
    const data = await apiRequest(`/api/memory/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });
    if (seq !== _searchSeq) return;
    _searchResults = Array.isArray(data?.results) ? data.results : [];
    _searchState = "done";
  } catch (error) {
    if (error?.name === "AbortError" || seq !== _searchSeq) return;
    _searchResults = [];
    _searchState = "error";
  }
  if (seq === _searchSeq) renderBody();
}

/* ---------------- 交互 ---------------- */

function onBodyClick(event) {
  const rootRow = event.target.closest("[data-mb-root]");
  if (rootRow) {
    const name = rootRow.dataset.mbRoot;
    if (_expanded.has(name)) _expanded.delete(name);
    else _expanded.add(name);
    renderBody();
    return;
  }
  const resultRow = event.target.closest("[data-mb-result]");
  if (resultRow) {
    const idx = Number(resultRow.dataset.mbResult);
    _openResult = _openResult === idx ? -1 : idx;
    renderBody();
    return;
  }
  const retry = event.target.closest("[data-mb-retry]");
  if (retry) void loadRoots(true);
}

/* ---------------- 渲染 ---------------- */

function renderBody() {
  if (!_bodyEl) return;
  const q = _inputEl ? _inputEl.value.trim() : "";
  if (q) {
    _bodyEl.innerHTML = renderSearch(q);
    return;
  }
  if (_roots === null && !_rootsError) {
    _bodyEl.innerHTML = renderSkeleton();
    return;
  }
  if (_rootsError) {
    _bodyEl.innerHTML = `
      <div class="mb-state">
        ${lucideIcon("circle-alert", "icon lucide")}
        <span class="mb-state-title">${escapeHtml(_rootsError)}</span>
        <span class="mb-state-sub">接口未就绪或请求失败，稍后重试</span>
        <button type="button" class="mb-retry" data-mb-retry>重试</button>
      </div>`;
    return;
  }
  if (!_roots.length) {
    _bodyEl.innerHTML = `
      <div class="mb-state">
        ${lucideIcon("brain", "icon lucide")}
        <span class="mb-state-title">暂无记忆文件</span>
        <span class="mb-state-sub">Agent 产生持久记忆后会出现在这里</span>
      </div>`;
    return;
  }
  let html = `<ul class="mb-tree">`;
  for (const rootInfo of _roots) {
    const name = String(rootInfo?.name ?? "未命名");
    const files = Array.isArray(rootInfo?.files) ? rootInfo.files : [];
    const totalSize = files.reduce((sum, f) => sum + (Number(f?.size) || 0), 0);
    const open = _expanded.has(name);
    html += `
      <li class="mb-root ${open ? "is-open" : ""}">
        <button type="button" class="mb-root-row" data-mb-root="${escapeHtml(name)}"
          aria-expanded="${open ? "true" : "false"}">
          ${lucideIcon("chevron-right", "icon lucide mb-chevron")}
          ${lucideIcon("folder", "icon lucide mb-folder")}
          <span class="mb-root-name">${escapeHtml(name)}</span>
          <span class="mb-root-meta num">${files.length} 个文件 · ${formatSize(totalSize)}</span>
        </button>
        ${open ? renderFiles(files) : ""}
      </li>`;
  }
  html += `</ul>`;
  _bodyEl.innerHTML = html;
}

function renderFiles(files) {
  if (!files.length) {
    return `<div class="mb-files"><div class="mb-file-empty">目录为空</div></div>`;
  }
  let html = `<ul class="mb-files">`;
  for (const file of files) {
    const name = String(file?.name ?? "未命名");
    const mtime = file?.mtime ? formatRelative(file.mtime) : "";
    html += `
      <li class="mb-file" title="${escapeHtml(name)}">
        ${lucideIcon("file-text", "icon lucide")}
        <span class="mb-file-name">${escapeHtml(name)}</span>
        <span class="mb-file-meta num">${formatSize(file?.size)}${mtime ? ` · ${escapeHtml(mtime)}` : ""}</span>
      </li>`;
  }
  html += `</ul>`;
  return html;
}

function renderSearch(query) {
  if (_searchState === "loading") return renderSkeleton();
  if (_searchState === "error") {
    return `
      <div class="mb-state">
        ${lucideIcon("circle-alert", "icon lucide")}
        <span class="mb-state-title">记忆搜索暂不可用</span>
        <span class="mb-state-sub">清空关键词可返回文件浏览</span>
      </div>`;
  }
  if (_searchState === "done" && !_searchResults.length) {
    return `
      <div class="mb-state">
        ${lucideIcon("search", "icon lucide")}
        <span class="mb-state-title">无匹配记忆</span>
        <span class="mb-state-sub">换个关键词试试</span>
      </div>`;
  }
  if (!_searchResults.length) return renderSkeleton();
  let html = `<ul class="mb-results">`;
  _searchResults.forEach((item, idx) => {
    const name = String(item?.name ?? item?.path ?? "未命名");
    const path = String(item?.path ?? "");
    const snippet = String(item?.snippet ?? "");
    const open = _openResult === idx;
    html += `
      <li class="mb-result ${open ? "is-open" : ""}">
        <button type="button" class="mb-result-row" data-mb-result="${idx}"
          aria-expanded="${open ? "true" : "false"}">
          ${lucideIcon("file-text", "icon lucide")}
          <span class="mb-result-main">
            <span class="mb-result-name">${escapeHtml(name)}</span>
            ${snippet ? `<span class="mb-result-snippet">${highlight(snippet, query, open)}</span>` : ""}
            ${path ? `<span class="mb-result-path">${escapeHtml(path)}</span>` : ""}
          </span>
          ${lucideIcon("chevron-down", "icon lucide mb-chevron")}
        </button>
      </li>`;
  });
  html += `</ul>`;
  return html;
}

function renderSkeleton() {
  return `
    <div class="mb-skel" aria-hidden="true">
      <div class="mb-skel-row"></div>
      <div class="mb-skel-row"></div>
      <div class="mb-skel-row is-short"></div>
    </div>`;
}

/* ---------------- 工具 ---------------- */

/** 转义后把命中的 query 词包成 <mark>；折叠态最多取 160 字符 */
function highlight(text, query, full = false) {
  const clipped = full ? text : text.slice(0, 160);
  let safe = escapeHtml(clipped);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  for (const word of words) {
    const needle = escapeHtml(word);
    if (!needle) continue;
    safe = safe.replace(
      new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
      "<mark>$1</mark>",
    );
  }
  if (!full && text.length > 160) safe += "…";
  return safe;
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------- 自举 ---------------- */

function boot() {
  // 等待 app.js 完成 token 初始化（apiReady），自举请求不再竞态 401
  void apiReady.then(() => initMemoryBrowser(document.getElementById("memory-browser-root")));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
