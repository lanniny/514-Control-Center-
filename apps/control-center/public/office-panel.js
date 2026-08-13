/**
 * office-panel.js — Wave G 文档工坊视图。
 * 三类生成器（docx/xlsx/pptx）+ 模板 + dryRun 计划→确认落盘 + 历史。
 */
import { request, apiReady } from "./api.js";
import { lucideIcon } from "./lucide.js";

const KIND_META = {
  docx: { icon: "file-text", label: "Word 文档", hint: "标题 + 章节段落 + 表格" },
  xlsx: { icon: "grid-2x2", label: "Excel 表格", hint: "多 sheet + 列定义 + 行数据" },
  pptx: { icon: "layout-dashboard", label: "PPT 演示", hint: "幻灯片 + 要点 + 备注" },
};

const state = { kind: "docx", templates: [], history: [], pendingPlan: null };

function esc(text) {
  return String(text ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function specFor(kind, title) {
  if (kind === "docx") {
    return { title, sections: [{ heading: "概述", paragraphs: ["由 514 Forge 文档工坊生成。"] }, { heading: "明细", table: { rows: [["项目", "说明"], ["来源", "控制面"]] } }] };
  }
  if (kind === "xlsx") {
    return { sheets: [{ name: "汇总", columns: [{ header: "项目" }, { header: "数值" }], rows: [["示例", 1]] }] };
  }
  return { slides: [{ title, bullets: ["要点一", "要点二"], notes: "由 514 Forge 生成" }] };
}

async function refresh(root) {
  let templates = [];
  let history = [];
  let gateError = null;
  try {
    templates = (await request("/api/office/templates"))?.templates ?? [];
    history = (await request("/api/office/history"))?.items ?? [];
  } catch (error) {
    gateError = error;
  }
  if (gateError && /REMOTE_GATE/.test(gateError.message || "")) {
    root.innerHTML = `
      <div class="forge-empty-waveg">
        ${lucideIcon("lock", "icon lucide icon-lg")}
        <h2>文档工坊门闸未开放</h2>
        <p class="subtle">${esc(gateError.message)}</p>
      </div>`;
    return;
  }
  Object.assign(state, { templates, history, pendingPlan: null });
  render(root);
}

function render(root) {
  const meta = KIND_META[state.kind];
  root.innerHTML = `
    <div class="waveg-form" id="office-composer">
      <div class="waveg-form-row" role="tablist" aria-label="文档类型">
        ${Object.entries(KIND_META).map(([kind, item]) => `
          <button type="button" class="terminal-tab ${state.kind === kind ? "is-active" : ""}" data-office-kind="${kind}" role="tab" aria-selected="${state.kind === kind}">
            ${lucideIcon(item.icon, "icon lucide")}<span>${item.label}</span>
          </button>`).join("")}
      </div>
      <div class="waveg-form-row">
        <label>标题<input class="input" id="office-title" type="text" value="未命名文档" /></label>
        <label>文件名<input class="input" id="office-filename" type="text" placeholder="留空自动按标题生成" /></label>
      </div>
      <p class="subtle">${meta.hint}。默认先出创建计划（dryRun），确认后才落盘到 output-docs/。</p>
      <div class="waveg-card-actions">
        <button type="button" class="button button-primary" id="office-plan">${lucideIcon("clipboard-list", "icon lucide")} 生成计划</button>
      </div>
      <div id="office-plan-result"></div>
    </div>

    <h2 class="waveg-section-title">${lucideIcon("book-open", "icon lucide")} 模板</h2>
    <div class="waveg-grid">
      ${state.templates.map((template) => `
        <div class="waveg-card">
          <div class="waveg-card-head">${lucideIcon(KIND_META[template.kind]?.icon ?? "file-text", "icon lucide")}<h3>${esc(template.title)}</h3><span class="waveg-badge">${template.kind}</span></div>
          <div class="waveg-card-actions">
            <button type="button" class="button" data-office-template="${template.id}">${lucideIcon("play", "icon lucide")} 用此模板</button>
          </div>
        </div>`).join("") || `<p class="subtle">模板读取失败或为空。</p>`}
    </div>

    <h2 class="waveg-section-title">${lucideIcon("history", "icon lucide")} 生成历史</h2>
    <div class="waveg-grid" id="office-history">
      ${state.history.map((item) => `
        <div class="waveg-card">
          <div class="waveg-card-head">${lucideIcon(KIND_META[item.kind]?.icon ?? "file-text", "icon lucide")}<h3>${esc(item.path?.split(/[\\/]/).pop() ?? item.kind)}</h3><span class="waveg-badge is-on">${(item.bytes / 1024).toFixed(1)} KB</span></div>
          <dl class="waveg-kv"><dt>路径</dt><dd>${esc(item.path)}</dd><dt>时间</dt><dd>${esc(item.at)}</dd></dl>
          <div class="waveg-card-actions">
            <button type="button" class="button" data-office-inspect="${esc(item.path)}">${lucideIcon("scan-search", "icon lucide")} 检查结构</button>
          </div>
        </div>`).join("") || `<p class="subtle">还没有生成记录。第一份文档从上方开始。</p>`}
    </div>
    <div id="office-inspect-result"></div>`;

  root.querySelectorAll("[data-office-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      state.kind = button.dataset.officeKind;
      render(root);
    });
  });
  root.querySelector("#office-plan")?.addEventListener("click", () => void planAndMaybeConfirm(root));
  root.querySelectorAll("[data-office-template]").forEach((button) => {
    button.addEventListener("click", () => void useTemplate(root, button.dataset.officeTemplate));
  });
  root.querySelectorAll("[data-office-inspect]").forEach((button) => {
    button.addEventListener("click", () => void inspectFile(root, button.dataset.officeInspect));
  });
}

async function planAndMaybeConfirm(root) {
  const title = root.querySelector("#office-title")?.value?.trim() || "未命名文档";
  const fileName = root.querySelector("#office-filename")?.value?.trim() || "";
  const resultBox = root.querySelector("#office-plan-result");
  resultBox.innerHTML = `<p class="subtle">正在生成计划…</p>`;
  try {
    const spec = specFor(state.kind, title);
    if (!state.pendingPlan) {
      const plan = await request("/api/office/generate", {
        method: "POST",
        body: JSON.stringify({ kind: state.kind, title, fileName, spec, dryRun: true }),
      });
      state.pendingPlan = { kind: state.kind, title, fileName, spec };
      resultBox.innerHTML = `
        <div class="waveg-review">
          <strong>${lucideIcon("clipboard-list", "icon lucide")} 创建计划（dryRun）</strong>
          <dl class="waveg-kv">
            <dt>类型</dt><dd>${plan.plan.kind}</dd>
            <dt>落点</dt><dd>${esc(plan.plan.path)}</dd>
          </dl>
          <div class="waveg-card-actions">
            <button type="button" class="button button-primary" id="office-confirm">${lucideIcon("check", "icon lucide")} 确认落盘</button>
            <button type="button" class="button" id="office-cancel">取消</button>
          </div>
        </div>`;
      resultBox.querySelector("#office-confirm").addEventListener("click", () => void planAndMaybeConfirm(root));
      resultBox.querySelector("#office-cancel").addEventListener("click", () => {
        state.pendingPlan = null;
        resultBox.innerHTML = "";
      });
      return;
    }
    const pending = state.pendingPlan;
    const done = await request("/api/office/generate", {
      method: "POST",
      body: JSON.stringify({ ...pending, dryRun: false }),
    });
    state.pendingPlan = null;
    resultBox.innerHTML = `
      <div class="waveg-review">
        <strong>${lucideIcon("circle-check", "icon lucide")} 已生成</strong>
        <dl class="waveg-kv"><dt>路径</dt><dd>${esc(done.plan.path)}</dd><dt>大小</dt><dd>${(done.plan.bytes / 1024).toFixed(1)} KB</dd></dl>
      </div>`;
    state.history = (await request("/api/office/history"))?.items ?? state.history;
    render(root);
  } catch (error) {
    resultBox.innerHTML = `<div class="waveg-review"><strong>${lucideIcon("triangle-alert", "icon lucide")} 失败</strong><p class="subtle">${esc(error.message)}</p></div>`;
  }
}

async function useTemplate(root, templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  state.kind = template.kind;
  render(root);
  root.querySelector("#office-title").value = template.title;
  root.querySelector("#office-title").focus();
}

async function inspectFile(root, path) {
  const box = root.querySelector("#office-inspect-result");
  box.innerHTML = `<p class="subtle">正在解析结构…</p>`;
  try {
    const { summary } = await request("/api/office/inspect", { method: "POST", body: JSON.stringify({ path }) });
    const detail = summary.kind === "xlsx"
      ? summary.sheets.map((sheet) => `${sheet.name}（${sheet.rows} 行 × ${sheet.columns} 列）`).join("、")
      : summary.kind === "docx"
        ? `${summary.paragraphs} 个段落 · ${summary.tables} 张表`
        : `${summary.slides} 页幻灯片`;
    box.innerHTML = `
      <div class="waveg-review">
        <strong>${lucideIcon("scan-search", "icon lucide")} 结构摘要</strong>
        <dl class="waveg-kv"><dt>类型</dt><dd>${summary.kind}</dd><dt>内容</dt><dd>${esc(detail)}</dd><dt>大小</dt><dd>${(summary.bytes / 1024).toFixed(1)} KB</dd></dl>
      </div>`;
  } catch (error) {
    box.innerHTML = `<div class="waveg-review"><strong>解析失败</strong><p class="subtle">${esc(error.message)}</p></div>`;
  }
}

function bootWhenReady() {
  if (typeof document === "undefined") return;
  const start = () => void apiReady.then(() => {
    const root = document.getElementById("office-container");
    if (root) void refresh(root);
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

bootWhenReady();
