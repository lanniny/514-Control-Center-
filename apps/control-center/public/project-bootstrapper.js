/**
 * project-bootstrapper.js — 项目启动器
 *
 * 可视化配置新项目：选择框架、样式、主题、图标库、字体，实时预览，
 * 并通过后端脚手架（POST /api/bootstrap/scaffold）真实落盘创建。
 *
 * 流程：配置 -> dryRun 计划 -> 确认 -> 创建 -> 成功/失败面板。
 * 后端不可用（404/网络错误）时回退为 onCreate(config, null) 通知（工作台预填）。
 *
 * 约定：
 *   - 图标一律走 lucide.js 的 lucideIcon()，UI 无 emoji。
 *   - 颜色一律走 forge tokens（var(--primary) 等），无内联样式。
 *   - onCreate(config, result) 仅作通知：真实创建成功后调用；
 *     后端不可用时以 (config, null) 调用。
 */

import { lucideIcon } from "./lucide.js";
import { request } from "./api.js";

const FRAMEWORKS = [
  { id: "nextjs", name: "Next.js", desc: "全栈 React 框架，SSR/SSG 支持", icon: "zap", popular: true },
  { id: "vite", name: "Vite + React", desc: "极速构建，轻量级 SPA", icon: "flame", popular: true },
  { id: "react-router", name: "React Router", desc: "客户端路由，SPA 首选", icon: "compass" },
  { id: "astro", name: "Astro", desc: "内容优先，零 JS 默认", icon: "rocket" },
  { id: "laravel", name: "Laravel", desc: "PHP 全栈框架", icon: "package" },
  { id: "none", name: "纯 Node.js", desc: "无框架，纯脚本", icon: "terminal" },
];

const STYLES = [
  { id: "tailwind", name: "Tailwind CSS", desc: "原子化 CSS，快速开发", icon: "palette", popular: true },
  { id: "css-modules", name: "CSS Modules", desc: "局部作用域 CSS", icon: "puzzle" },
  { id: "styled-components", name: "Styled Components", desc: "CSS-in-JS", icon: "brush" },
  { id: "vanilla", name: "原生 CSS", desc: "无依赖，完全控制", icon: "file-text" },
];

const THEMES = [
  { id: "light", name: "亮色", swatch: "is-light" },
  { id: "dark", name: "暗色", swatch: "is-dark" },
  { id: "auto", name: "跟随系统", swatch: "is-auto" },
];

const ICON_LIBS = [
  { id: "lucide", name: "Lucide", desc: "轻量级图标集", icon: "sparkles" },
  { id: "heroicons", name: "Heroicons", desc: "Tailwind 官方图标", icon: "shield-check" },
  { id: "phosphor", name: "Phosphor", desc: "灵活的图标系统", icon: "puzzle" },
  { id: "none", name: "无图标库", desc: "不使用图标", icon: "x" },
];

const FONTS = [
  { id: "inter", name: "Inter", desc: "现代无衬线，UI 首选", icon: "type", sample: "The quick brown fox" },
  { id: "system", name: "系统字体", desc: "使用系统默认字体", icon: "type", sample: "The quick brown fox" },
  { id: "mono", name: "等宽字体", desc: "代码编辑器风格", icon: "terminal", sample: "const x = 42;" },
];

const SCAFFOLD_API = "/api/bootstrap/scaffold";
const DEFAULTS = Object.freeze({
  framework: "vite",
  style: "tailwind",
  theme: "auto",
  icons: "lucide",
  font: "inter",
  name: "",
  dir: "",
  description: "",
});

let _containerEl = null;
let _config = { ...DEFAULTS };
let _onCreate = null;
// 脚手架阶段：idle | planning | plan | creating | done | error | fallback
let _stage = "idle";
let _plan = null; // dryRun 结果 { filesPlanned, targetDir, log }
let _result = null; // 真实创建结果 { filesWritten, targetDir, log }
let _error = ""; // 失败信息

// Codex 式两步向导（LO 2026-08-11）：第一步选项目类型（大卡片 + 单选圈），第二步填名称/目录/高级配置。
// 远程占位但禁用——远程主机接入是独立特性，不假装可用。
const PROJECT_TYPES = [
  { id: "local", name: "本地", desc: "在你的电脑上编辑、运行和测试文件", icon: "terminal" },
  { id: "remote", name: "远程", desc: "选择已连接计算机上的文件夹", icon: "globe", disabled: true, badge: "暂未接入" },
];
let _step = "type"; // type | config
let _type = "local";

/**
 * 初始化项目启动器
 * @param {HTMLElement} container - 容器（允许为 null，安全自守护）
 * @param {Object} opts
 * @param {Function} opts.onCreate - (config, result) => void，仅通知回调
 */
export function initProjectBootstrapper(container, opts = {}) {
  if (!container) {
    console.warn("project-bootstrapper: 挂载点不存在，跳过初始化");
    return;
  }
  _containerEl = container;
  _onCreate = typeof opts.onCreate === "function" ? opts.onCreate : () => {};
  render();
}

function render() {
  if (!_containerEl) return;
  const busy = _stage === "planning" || _stage === "creating";
  _containerEl.innerHTML = `
    <div class="bootstrapper">
      <div class="bootstrapper-header">
        <h3 class="bootstrapper-title">
          <span class="bootstrapper-icon">${lucideIcon("rocket", "icon lucide")}</span>
          项目启动器
        </h3>
        <p class="bootstrapper-desc">${_step === "type" ? "第一步 · 选择项目类型" : "第二步 · 配置项目信息，先生成创建计划，确认后落盘"}</p>
      </div>

      ${_step === "type" ? renderTypeStep(busy) : renderConfigStep(busy)}

      ${renderScaffoldPanel()}
    </div>
  `;

  bindEvents();
}

// 第一步（Codex「创建项目」形态）：项目类型大卡片——图标左上、单选圈右上、名称 + 一行说明
function renderTypeStep(busy) {
  const selectedType = PROJECT_TYPES.find((t) => t.id === _type);
  return `
    <div class="boot-wizard forge-enter">
      <div class="boot-step-label">项目类型</div>
      <div class="boot-type-grid">
        ${PROJECT_TYPES.map((t) => {
          const selected = t.id === _type;
          return `
            <button class="boot-type-card${selected ? " is-selected" : ""}" data-type-id="${t.id}" type="button"
              ${t.disabled ? "disabled" : ""} aria-pressed="${selected}">
              <span class="boot-type-icon">${lucideIcon(t.icon, "icon lucide")}</span>
              <span class="boot-type-radio${selected ? " is-on" : ""}" aria-hidden="true"></span>
              <span class="boot-type-name">${t.name}${t.badge ? `<span class="boot-type-badge">${t.badge}</span>` : ""}</span>
              <span class="boot-type-desc">${t.desc}</span>
            </button>
          `;
        }).join("")}
      </div>
      <div class="bootstrapper-footer">
        <button class="button primary" id="boot-next" type="button" ${busy || selectedType?.disabled ? "disabled" : ""}>
          <span>下一步</span>
          ${lucideIcon("arrow-right", "icon lucide")}
        </button>
      </div>
    </div>
  `;
}

// 第二步：项目信息（名称 + 目标目录选择区）+ 脚手架高级配置 + 实时预览
function renderConfigStep(busy) {
  return `
    <div class="boot-wizard forge-enter">
      <div class="bootstrapper-body">
        <div class="bootstrapper-config">
          <!-- 项目信息 -->
          <div class="boot-section">
            <label class="boot-label" for="boot-name">项目名称</label>
            <div class="boot-input-affix">
              ${lucideIcon("folder", "icon lucide")}
              <input class="boot-input" type="text" id="boot-name" placeholder="my-awesome-project" value="${escapeAttr(_config.name)}" />
            </div>
          </div>
          <div class="boot-section">
            <label class="boot-label">目标目录</label>
            <div class="boot-dirpick${_config.dir ? " has-dir" : ""}">
              <button class="boot-dirpick-main" id="boot-dirpick" type="button" title="选择项目落盘目录（原生目录选择框）">
                ${lucideIcon(_config.dir ? "folder" : "folder-open", "icon lucide")}
                ${_config.dir ? `<code>${escapeHtml(_config.dir)}</code>` : "<span>添加项目落盘目录</span>"}
              </button>
              ${_config.dir ? `<button class="boot-dirpick-clear" id="boot-dir-clear" type="button" title="清除目录，回到默认" aria-label="清除目录">${lucideIcon("x", "icon lucide")}</button>` : ""}
            </div>
            <span class="boot-hint" id="boot-dir-hint">${_config.dir ? "" : `留空则使用默认目录 ${escapeHtml(defaultDir())}`}</span>
          </div>
          <div class="boot-section">
            <label class="boot-label" for="boot-desc">项目描述</label>
            <input class="boot-input" type="text" id="boot-desc" placeholder="一个很棒的项目" value="${escapeAttr(_config.description)}" />
          </div>

          <!-- 框架选择 -->
          <div class="boot-section">
            <label class="boot-label">框架</label>
            <div class="boot-options">
              ${FRAMEWORKS.map((f) => optionCard("framework", f, _config.framework)).join("")}
            </div>
          </div>

          <!-- 样式选择 -->
          <div class="boot-section">
            <label class="boot-label">样式系统</label>
            <div class="boot-options">
              ${STYLES.map((s) => optionCard("style", s, _config.style)).join("")}
            </div>
          </div>

          <!-- 主题选择 -->
          <div class="boot-section">
            <label class="boot-label">主题</label>
            <div class="boot-themes">
              ${THEMES.map((t) => `
                <button class="boot-theme ${t.id === _config.theme ? "is-selected" : ""}" data-type="theme" data-value="${t.id}" type="button">
                  <span class="boot-theme-preview ${t.swatch}">
                    <span class="boot-theme-accent"></span>
                  </span>
                  <span class="boot-theme-name">${t.name}</span>
                </button>
              `).join("")}
            </div>
          </div>

          <!-- 图标库 -->
          <div class="boot-section">
            <label class="boot-label">图标库</label>
            <div class="boot-options boot-options-small">
              ${ICON_LIBS.map((i) => optionCard("icons", i, _config.icons, { compact: true })).join("")}
            </div>
          </div>

          <!-- 字体 -->
          <div class="boot-section">
            <label class="boot-label">字体</label>
            <div class="boot-options boot-options-small">
              ${FONTS.map((f) => optionCard("font", f, _config.font, { sample: f.sample })).join("")}
            </div>
          </div>
        </div>

        <!-- 实时预览 -->
        <div class="bootstrapper-preview">
          <div class="boot-preview-header">
            <span class="boot-preview-title">实时预览</span>
            <span class="boot-preview-badge">${getFrameworkName()} + ${getStyleName()}</span>
          </div>
          <div class="boot-preview-content" id="boot-preview">
            ${renderPreview()}
          </div>
        </div>
      </div>

      <div class="bootstrapper-footer">
        <button class="button secondary boot-prev" id="boot-prev" type="button" ${busy ? "disabled" : ""}>
          ${lucideIcon("chevron-right", "icon lucide boot-flip")}
          <span>上一步</span>
        </button>
        <button class="button secondary" id="boot-reset" type="button" ${busy ? "disabled" : ""}>
          ${lucideIcon("refresh-cw", "icon lucide")}
          <span>重置</span>
        </button>
        <button class="button primary" id="boot-create" type="button" ${busy ? "disabled" : ""}>
          <span>${busy ? "处理中" : "创建项目"}</span>
          ${lucideIcon(busy ? "loader-circle" : "arrow-right", busy ? "icon lucide boot-spin" : "icon lucide")}
        </button>
      </div>
    </div>
  `;
}

function optionCard(type, item, selectedId, opts = {}) {
  const selected = item.id === selectedId;
  return `
    <button class="boot-option forge-enter ${selected ? "is-selected" : ""} ${item.popular ? "is-popular" : ""}" data-type="${type}" data-value="${item.id}" type="button">
      <span class="boot-option-icon">${lucideIcon(item.icon, "icon lucide boot-glyph")}</span>
      <span class="boot-option-name">${item.name}</span>
      ${opts.compact ? "" : `<span class="boot-option-desc">${item.desc || ""}</span>`}
      ${opts.sample ? `<span class="boot-option-sample">${escapeHtml(opts.sample)}</span>` : ""}
      ${item.popular ? '<span class="boot-option-badge">推荐</span>' : ""}
    </button>
  `;
}

function bindEvents() {
  _containerEl.querySelectorAll(".boot-type-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      _type = btn.dataset.typeId;
      render();
    });
  });

  _containerEl.querySelector("#boot-next")?.addEventListener("click", () => {
    if (PROJECT_TYPES.find((t) => t.id === _type)?.disabled) return;
    _step = "config";
    render();
  });

  _containerEl.querySelector("#boot-prev")?.addEventListener("click", () => {
    _step = "type";
    render();
  });

  // 目标目录选择区：服务端原生目录选择框拿绝对路径（与会话对话框同一接口）
  _containerEl.querySelector("#boot-dirpick")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await request("/api/system/pick-directory", { method: "POST" });
      if (result?.path) {
        _config.dir = result.path;
        render();
      }
    } catch (error) {
      console.warn("目录选择失败：", error?.message || error); // 用户取消/后端缺失都如实留在控制台，不假装成功
    } finally {
      button.disabled = false;
    }
  });

  _containerEl.querySelector("#boot-dir-clear")?.addEventListener("click", () => {
    _config.dir = "";
    render();
  });

  _containerEl.querySelectorAll(".boot-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.type;
      const value = btn.dataset.value;
      if (!type || !value) return;
      _config[type] = value;
      render();
    });
  });

  _containerEl.querySelectorAll(".boot-theme").forEach((btn) => {
    btn.addEventListener("click", () => {
      _config.theme = btn.dataset.value;
      render();
    });
  });

  _containerEl.querySelector("#boot-name")?.addEventListener("input", (e) => {
    _config.name = e.target.value;
    const hint = _containerEl.querySelector("#boot-dir-hint");
    if (hint && !_config.dir) hint.textContent = `留空则使用默认目录 ${defaultDir()}`;
    updatePreview();
  });

  _containerEl.querySelector("#boot-desc")?.addEventListener("input", (e) => {
    _config.description = e.target.value;
    updatePreview();
  });

  _containerEl.querySelector("#boot-reset")?.addEventListener("click", () => {
    _config = { ...DEFAULTS };
    _type = "local";
    _step = "type"; // 重置=回到向导起点
    resetFlow();
    render();
  });

  _containerEl.querySelector("#boot-create")?.addEventListener("click", () => {
    void startPlan();
  });

  _containerEl.querySelector("#boot-confirm")?.addEventListener("click", () => {
    void confirmCreate();
  });

  _containerEl.querySelector("#boot-cancel")?.addEventListener("click", () => {
    resetFlow();
    render();
  });

  _containerEl.querySelector("#boot-dismiss")?.addEventListener("click", () => {
    resetFlow();
    render();
  });

  _containerEl.querySelector("#boot-retry")?.addEventListener("click", () => {
    resetFlow();
    void startPlan();
  });
}

function resetFlow() {
  _stage = "idle";
  _plan = null;
  _result = null;
  _error = "";
}

function projectName() {
  return _config.name.trim() || "my-project";
}

function defaultDir() {
  return `~/514-projects/${projectName()}`;
}

function targetDir() {
  return _config.dir.trim() || defaultDir();
}

function scaffoldPayload(dryRun) {
  return {
    framework: _config.framework,
    style: _config.style,
    theme: _config.theme,
    iconLibrary: _config.icons,
    font: _config.font,
    name: projectName(),
    dir: targetDir(),
    dryRun,
  };
}

/** 第一步：dryRun 生成创建计划 */
async function startPlan() {
  if (_stage === "planning" || _stage === "creating") return;
  _stage = "planning";
  _error = "";
  render();
  try {
    const data = await request(SCAFFOLD_API, { method: "POST", body: scaffoldPayload(true) });
    _plan = data && typeof data === "object" ? data : {};
    _stage = "plan";
  } catch (error) {
    handleApiFailure(error);
  }
  render();
}

/** 第二步：确认后真实创建 */
async function confirmCreate() {
  if (_stage !== "plan") return;
  _stage = "creating";
  _error = "";
  render();
  try {
    const data = await request(SCAFFOLD_API, { method: "POST", body: scaffoldPayload(false) });
    _result = data && typeof data === "object" ? data : {};
    _stage = "done";
    _onCreate({ ..._config }, _result);
  } catch (error) {
    handleApiFailure(error);
  }
  render();
}

/** 后端不可用（404/网络错误）-> 回退通知；其余错误 -> 错误面板 */
function handleApiFailure(error) {
  const status = Number(error?.status ?? -1);
  if (status === 404 || status === 0) {
    _stage = "fallback";
    _error = "";
    _onCreate({ ..._config }, null);
    return;
  }
  _stage = "error";
  _error = String(error?.message || error || "未知错误");
}

function renderScaffoldPanel() {
  if (_stage === "idle") return "";

  if (_stage === "planning" || _stage === "creating") {
    return `
      <div class="boot-scaffold forge-enter" id="boot-scaffold">
        <div class="boot-scaffold-status">
          ${lucideIcon("loader-circle", "icon lucide boot-spin")}
          <span>${_stage === "planning" ? "正在生成创建计划…" : "正在创建项目…"}</span>
        </div>
      </div>
    `;
  }

  if (_stage === "plan") {
    const files = normalizeList(_plan?.filesPlanned);
    const log = normalizeList(_plan?.log);
    const dir = String(_plan?.targetDir || targetDir());
    return `
      <div class="boot-scaffold forge-enter" id="boot-scaffold">
        <div class="boot-scaffold-head">
          ${lucideIcon("file-text", "icon lucide")}
          <span class="boot-scaffold-title">创建计划</span>
          <span class="boot-scaffold-count num">${files.length} 个文件</span>
        </div>
        <div class="boot-scaffold-dir">
          ${lucideIcon("folder", "icon lucide")}
          <code>${escapeHtml(dir)}</code>
        </div>
        ${files.length ? `<ul class="boot-file-list">${files.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : '<p class="boot-scaffold-empty">后端未返回文件清单</p>'}
        ${log.length ? `<div class="boot-log">${log.map((l) => `<div class="boot-log-line">${escapeHtml(l)}</div>`).join("")}</div>` : ""}
        <div class="boot-scaffold-actions">
          <button class="button secondary" id="boot-cancel" type="button">
            ${lucideIcon("x", "icon lucide")}
            <span>取消</span>
          </button>
          <button class="button primary" id="boot-confirm" type="button">
            <span>确认创建</span>
            ${lucideIcon("check", "icon lucide")}
          </button>
        </div>
      </div>
    `;
  }

  if (_stage === "done") {
    const files = normalizeList(_result?.filesWritten);
    const log = normalizeList(_result?.log);
    const dir = String(_result?.targetDir || targetDir());
    return `
      <div class="boot-scaffold is-done forge-enter" id="boot-scaffold">
        <div class="boot-scaffold-head">
          <span class="boot-scaffold-mark is-ok">${lucideIcon("circle-check", "icon lucide")}</span>
          <span class="boot-scaffold-title">项目已创建</span>
          <span class="boot-scaffold-count num">${files.length} 个文件</span>
        </div>
        <div class="boot-scaffold-dir">
          ${lucideIcon("folder", "icon lucide")}
          <code>${escapeHtml(dir)}</code>
        </div>
        <div class="boot-next">
          <div class="boot-next-title">${lucideIcon("lightbulb", "icon lucide")}<span>下一步</span></div>
          <ul class="boot-next-list">
            <li><code>cd ${escapeHtml(dir)}</code></li>
            <li><code>npm install</code> 安装依赖</li>
            <li><code>npm run dev</code> 启动开发服务器</li>
          </ul>
        </div>
        ${log.length ? `<div class="boot-log">${log.map((l) => `<div class="boot-log-line">${escapeHtml(l)}</div>`).join("")}</div>` : ""}
        <div class="boot-scaffold-actions">
          <button class="button secondary" id="boot-dismiss" type="button">
            <span>完成</span>
          </button>
        </div>
      </div>
    `;
  }

  if (_stage === "fallback") {
    return `
      <div class="boot-scaffold is-fallback forge-enter" id="boot-scaffold">
        <div class="boot-scaffold-head">
          <span class="boot-scaffold-mark is-info">${lucideIcon("info", "icon lucide")}</span>
          <span class="boot-scaffold-title">后端脚手架不可用</span>
        </div>
        <p class="boot-scaffold-note">未检测到 scaffold 接口，配置已发送到工作台，可由 Agent 手动创建。</p>
        <div class="boot-scaffold-actions">
          <button class="button secondary" id="boot-dismiss" type="button">
            <span>知道了</span>
          </button>
        </div>
      </div>
    `;
  }

  // error
  return `
    <div class="boot-scaffold is-error forge-enter" id="boot-scaffold">
      <div class="boot-scaffold-head">
        <span class="boot-scaffold-mark is-bad">${lucideIcon("circle-alert", "icon lucide")}</span>
        <span class="boot-scaffold-title">创建失败</span>
      </div>
      <p class="boot-scaffold-note">${escapeHtml(_error)}</p>
      <div class="boot-scaffold-actions">
        <button class="button secondary" id="boot-dismiss" type="button">
          <span>关闭</span>
        </button>
        <button class="button primary" id="boot-retry" type="button">
          <span>重试</span>
          ${lucideIcon("refresh-cw", "icon lucide")}
        </button>
      </div>
    </div>
  `;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function updatePreview() {
  const previewEl = _containerEl?.querySelector("#boot-preview");
  if (previewEl) previewEl.innerHTML = renderPreview();
}

function renderPreview() {
  const name = projectName();
  return `
    <div class="boot-preview-card boot-preview-anim" data-theme-preview="${escapeAttr(_config.theme)}">
      <div class="boot-preview-topbar">
        <div class="boot-preview-dots">
          <span class="dot-r"></span>
          <span class="dot-y"></span>
          <span class="dot-g"></span>
        </div>
        <span class="boot-preview-url">${escapeHtml(name)}.local:3000</span>
      </div>
      <div class="boot-preview-body">
        <div class="boot-preview-hero">
          <span class="boot-preview-hero-icon">${lucideIcon(currentOptionIcon(), "icon lucide")}</span>
          <h1 class="boot-preview-name">${escapeHtml(name)}</h1>
        </div>
        <p class="boot-preview-desc">${escapeHtml(_config.description || "欢迎使用 514cc 项目启动器")}</p>
        <div class="boot-preview-lines">
          <span class="boot-preview-line is-long"></span>
          <span class="boot-preview-line is-mid"></span>
          <span class="boot-preview-line is-short"></span>
        </div>
        <div class="boot-preview-stack">
          <span class="boot-preview-tag">${getFrameworkName()}</span>
          <span class="boot-preview-tag">${getStyleName()}</span>
          <span class="boot-preview-tag">${getIconName()}</span>
          <span class="boot-preview-tag">${getThemeName()}</span>
        </div>
      </div>
    </div>
  `;
}

function currentOptionIcon() {
  return FRAMEWORKS.find((f) => f.id === _config.framework)?.icon || "rocket";
}

function getFrameworkName() {
  return FRAMEWORKS.find((f) => f.id === _config.framework)?.name || _config.framework;
}

function getStyleName() {
  return STYLES.find((s) => s.id === _config.style)?.name || _config.style;
}

function getIconName() {
  return ICON_LIBS.find((i) => i.id === _config.icons)?.name || _config.icons;
}

function getThemeName() {
  return THEMES.find((t) => t.id === _config.theme)?.name || _config.theme;
}

function escapeHtml(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeAttr(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
