/**
 * market-panel.js — Wave G 市场视图（MCP 搜索 + Skills 安装，两段式审查确认）。
 */
import { request, apiReady } from "./api.js";
import { lucideIcon } from "./lucide.js";

const state = {
  mcp: { query: "", source: "official", items: [], searched: false },
  skills: [],
  installed: [],
  review: null, // { kind:"mcp"|"skill", stageId, review }
};

function esc(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

async function refresh(root) {
  try {
    const [skills, installed] = await Promise.all([
      request("/api/market/skills"),
      request("/api/market/installed"),
    ]);
    state.skills = skills?.skills ?? [];
    state.installed = installed?.items ?? [];
  } catch (error) {
    if (/REMOTE_GATE/.test(error.message || "")) {
      root.innerHTML = `
        <div class="forge-empty-waveg">
          ${lucideIcon("lock", "icon lucide icon-lg")}
          <h2>市场门闸未开放</h2>
          <p class="subtle">${esc(error.message)}</p>
        </div>`;
      return;
    }
  }
  render(root);
}

function render(root) {
  root.innerHTML = `
    <h2 class="waveg-section-title">${lucideIcon("puzzle", "icon lucide")} MCP 服务器目录</h2>
    <div class="waveg-form">
      <div class="waveg-form-row">
        <label>搜索<input class="input" id="mcp-query" type="text" value="${esc(state.mcp.query)}" placeholder="filesystem / github / sqlite…" /></label>
        <label>来源
          <select class="input" id="mcp-source">
            <option value="official" ${state.mcp.source === "official" ? "selected" : ""}>官方 Registry</option>
            <option value="smithery" ${state.mcp.source === "smithery" ? "selected" : ""}>Smithery</option>
          </select>
        </label>
      </div>
      <div class="waveg-card-actions">
        <button type="button" class="button button-primary" id="mcp-search">${lucideIcon("search", "icon lucide")} 搜索</button>
      </div>
      <p class="subtle" id="mcp-msg">${state.mcp.searched && !state.mcp.items.length ? "没有命中。" : ""}</p>
    </div>
    <div class="waveg-grid">
      ${state.mcp.items.map((item) => `
        <div class="waveg-card">
          <div class="waveg-card-head">${lucideIcon("puzzle", "icon lucide")}<h3>${esc(item.name || item.id)}</h3><span class="waveg-badge">${esc(item.source)}</span></div>
          <p class="subtle">${esc(item.description || "（无描述）")}</p>
          <div class="waveg-card-actions">
            <button type="button" class="button" data-mcp-stage="${esc(item.id)}" data-source="${esc(item.source)}">${lucideIcon("scan-search", "icon lucide")} 审查安装</button>
          </div>
        </div>`).join("")}
    </div>

    <h2 class="waveg-section-title">${lucideIcon("package", "icon lucide")} Skills 安装</h2>
    <div class="waveg-form">
      <div class="waveg-form-row">
        <label>Skill 压缩包 URL（GitHub 等白名单来源）<input class="input" id="skill-url" type="text" placeholder="https://github.com/org/repo/archive/refs/heads/main.zip" /></label>
      </div>
      <div class="waveg-card-actions">
        <button type="button" class="button button-primary" id="skill-stage">${lucideIcon("download-cloud", "icon lucide")} 下载并审查</button>
      </div>
      <p class="subtle" id="skill-msg"></p>
    </div>

    <div id="market-review"></div>

    <h2 class="waveg-section-title">${lucideIcon("archive", "icon lucide")} 已安装（${state.installed.length}）</h2>
    <div class="waveg-grid">
      ${state.skills.map((skill) => `
        <div class="waveg-card">
          <div class="waveg-card-head">${lucideIcon("package", "icon lucide")}<h3>${esc(skill.name)}</h3><span class="waveg-badge is-on">skill</span></div>
          <p class="subtle">${esc(skill.description || "")}</p>
          <div class="waveg-card-actions">
            <button type="button" class="button" data-skill-remove="${esc(skill.name)}">${lucideIcon("trash-2", "icon lucide")} 移除</button>
          </div>
        </div>`).join("")}
      ${state.installed.filter((item) => item.kind === "mcp").map((item) => `
        <div class="waveg-card">
          <div class="waveg-card-head">${lucideIcon("puzzle", "icon lucide")}<h3>${esc(item.review?.name || item.id)}</h3><span class="waveg-badge is-on">mcp</span></div>
          <dl class="waveg-kv">
            <dt>来源</dt><dd>${esc(item.source)}</dd>
            <dt>哈希</dt><dd>${esc(String(item.hash || "").slice(0, 16))}…</dd>
            <dt>安装于</dt><dd>${esc(item.installedAt)}</dd>
          </dl>
        </div>`).join("") || ""}
      ${!state.skills.length && !state.installed.length ? `<p class="subtle">还没有安装任何组件。</p>` : ""}
    </div>`;

  root.querySelector("#mcp-search")?.addEventListener("click", () => void mcpSearch(root));
  root.querySelector("#mcp-query")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") void mcpSearch(root);
  });
  root.querySelectorAll("[data-mcp-stage]").forEach((button) => {
    button.addEventListener("click", () => void mcpStage(root, button.dataset.source, button.dataset.mcpStage));
  });
  root.querySelector("#skill-stage")?.addEventListener("click", () => void skillStage(root));
  root.querySelectorAll("[data-skill-remove]").forEach((button) => {
    button.addEventListener("click", () => void skillRemove(root, button.dataset.skillRemove));
  });
  if (state.review) renderReview(root);
}

async function mcpSearch(root) {
  const query = root.querySelector("#mcp-query")?.value?.trim() || "";
  const source = root.querySelector("#mcp-source")?.value || "official";
  state.mcp = { query, source, items: [], searched: false };
  const msg = root.querySelector("#mcp-msg");
  if (msg) msg.textContent = "搜索中…";
  try {
    const result = await request(`/api/market/mcp/search?q=${encodeURIComponent(query)}&source=${encodeURIComponent(source)}`);
    state.mcp.items = result?.items ?? [];
  } catch (error) {
    state.mcp.items = [];
    if (msg) msg.textContent = `搜索失败：${error.message}`;
  }
  state.mcp.searched = true;
  render(root);
}

async function mcpStage(root, source, id) {
  try {
    const result = await request("/api/market/mcp/stage", { method: "POST", body: JSON.stringify({ source, id }) });
    state.review = { kind: "mcp", stageId: result.stageId, review: result.review };
  } catch (error) {
    state.review = { kind: "error", error: error.message };
  }
  render(root);
}

async function skillStage(root) {
  const url = root.querySelector("#skill-url")?.value?.trim() || "";
  const msg = root.querySelector("#skill-msg");
  if (msg) msg.textContent = "下载与校验中…";
  try {
    const result = await request("/api/market/skills/stage", { method: "POST", body: JSON.stringify({ url }) });
    state.review = { kind: "skill", stageId: result.stageId, review: result.review };
  } catch (error) {
    state.review = { kind: "error", error: error.message };
  }
  render(root);
}

function renderReview(root) {
  const box = root.querySelector("#market-review");
  if (!box || !state.review) return;
  if (state.review.kind === "error") {
    box.innerHTML = `<div class="waveg-review"><strong>${lucideIcon("triangle-alert", "icon lucide")} 审查失败</strong><p class="subtle">${esc(state.review.error)}</p></div>`;
    return;
  }
  const { kind, review } = state.review;
  const rows = kind === "mcp"
    ? `<dt>命令</dt><dd>${esc(review.command ?? "（远端未声明）")}</dd>
       <dt>参数</dt><dd>${esc((review.args ?? []).join(" "))}</dd>
       <dt>环境变量</dt><dd>${esc((review.envKeys ?? []).join("、") || "无")}</dd>`
    : `<dt>名称</dt><dd>${esc(review.name)}</dd>
       <dt>描述</dt><dd>${esc(review.description)}</dd>
       <dt>文件数</dt><dd>${review.files?.length ?? 0}</dd>`;
  const fileRows = kind !== "mcp" && Array.isArray(review.files) && review.files.length
    ? `<dt>文件清单</dt><dd>${review.files.map((file) => esc(typeof file === "string" ? file : file.path ?? file.name ?? "")).filter(Boolean).join("、")}</dd>`
    : "";
  box.innerHTML = `
    <div class="waveg-review">
      <strong>${lucideIcon("shield-check", "icon lucide")} 安装前审查（${kind === "mcp" ? "MCP" : "Skill"}）</strong>
      <dl class="waveg-kv">
        ${rows}
      </dl>
      <div class="forge-collapsible" data-state="closed">
        <button type="button" class="button waveg-detail-toggle" id="review-detail-toggle" aria-expanded="false">
          ${lucideIcon("chevron-right", "icon lucide")} 哈希与文件细节
        </button>
        <div class="forge-collapsible-content">
          <div class="forge-collapsible-inner">
            <dl class="waveg-kv">
              <dt>哈希</dt><dd>${esc(review.hash ?? review.sha256 ?? "")}</dd>
              ${fileRows}
            </dl>
          </div>
        </div>
      </div>
      <p class="subtle">确认即代表你审过上述命令/文件面并同意安装；台账将记录哈希与审查内容。</p>
      <div class="waveg-card-actions">
        <button type="button" class="button button-primary" id="review-confirm">${lucideIcon("check", "icon lucide")} 确认安装</button>
        <button type="button" class="button" id="review-cancel">放弃</button>
      </div>
    </div>`;
  box.querySelector("#review-confirm").addEventListener("click", () => void reviewConfirm(root));
  box.querySelector("#review-cancel").addEventListener("click", () => {
    state.review = null;
    render(root);
  });
  const toggle = box.querySelector("#review-detail-toggle");
  toggle.addEventListener("click", () => {
    const wrap = toggle.closest(".forge-collapsible");
    const open = wrap.dataset.state !== "open";
    wrap.dataset.state = open ? "open" : "closed";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-open", open);
  });
}

async function reviewConfirm(root) {
  if (!state.review || state.review.kind === "error") return;
  const { kind, stageId } = state.review;
  try {
    await request(`/api/market/${kind === "mcp" ? "mcp" : "skills"}/install`, {
      method: "POST",
      body: JSON.stringify({ stageId, confirmed: true }),
    });
    state.review = null;
    await refresh(root);
  } catch (error) {
    state.review = { kind: "error", error: error.message };
    render(root);
  }
}

async function skillRemove(root, name) {
  try {
    await request(`/api/market/skills/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch { /* 忽略 */ }
  await refresh(root);
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => void apiReady.then(() => {
    const root = document.getElementById("market-container");
    if (root) void refresh(root);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
